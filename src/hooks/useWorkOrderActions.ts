import {
  doc,
  collection,
  writeBatch,
  runTransaction,
  serverTimestamp,
} from 'firebase/firestore';
import { db }           from '@/firebase/config';
import { useAuthStore } from '@/store/authStore';
import { createEmptySurveyReport } from '@/lib/boqMaster';
import {
  SURVEY_APPROVAL_STAGES,
  SURVEY_APPROVAL_STAGE_COUNT,
  deriveStageOwnerUids,
} from '@/lib/approvalStages';
import type { WorkOrderStage, ApprovalStageResult } from '@/types';

// ─── Input types ────────────────────────────────────────────────────────────────

/** One nominated stage owner, picked by an admin at creation time. */
export interface ApprovalStageOwnerInput {
  ownerUid:  string;
  ownerName: string;
}

export interface CreateWorkOrderInput {
  siteId:   string;
  siteCode: string;
  siteName: string;
  sapCode?:      string | null;
  zone?:         string | null;
  voltageClass?: string | null;
  /** Defaults to 'survey' — the only stage implemented today. */
  stage?: WorkOrderStage;
  assignedTo?:     string | null;
  assignedToName?: string | null;
  /**
   * One owner per SURVEY_APPROVAL_STAGES entry, in the same order. All are
   * required — a stage with no owner is a chain that can never complete, and
   * unlike siteTasks there is no admin fallback for surveys (see reviewSurvey).
   *
   * approverUid/approverName are NOT accepted here: they are derived from
   * stageOwners[0] so the live-stage pointer can never disagree with the chain
   * it is supposed to point into.
   */
  stageOwners: ApprovalStageOwnerInput[];
}

export interface ReassignWorkOrderInput {
  assignedTo:     string | null;
  assignedToName: string | null;
}

export interface ReassignApprovalStageOwnerInput {
  ownerUid:  string;
  ownerName: string;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Admin-only actions for the WorkOrder → SurveyReport pair.
 *
 * The blank survey is created up front by the admin (not by the field
 * engineer) so engineers only ever *update* an existing document — this is
 * what makes the offline-draft model work: the target document already
 * exists before the engineer ever goes offline. Firestore rules enforce
 * `create: if isAdmin()` on both collections; this hook is the only intended
 * caller of the create path.
 *
 * assignedTo/assignedToName/approverUid/approverName are denormalised onto
 * BOTH the WorkOrder and its paired SurveyReport (see the SurveyReport type
 * comment for why). Every write in this hook updates both documents
 * atomically (a transaction in createWorkOrder, a batch in the reassign/
 * approver setters) so they never drift.
 */
export function useWorkOrderActions() {
  const { currentUser } = useAuthStore();

  function assertAdmin() {
    if (!currentUser) throw new Error('Not authenticated');
    if (currentUser.role !== 'admin') throw new Error('Only admins can manage work orders');
  }

  /**
   * Creates a WorkOrder + its paired blank SurveyReport in a single
   * transaction, alongside reserving the work order code's sequence number.
   *
   * The sequence is per-site, per-stage (sites/{siteId}.workOrderCounters.
   * <stage>), NOT a global counter — "WO-<siteCode>-SURVEY-01" must mean "the
   * 1st survey at this site," which a global counter can't express and would
   * actively mislead on a document going for government vetting. Reading the
   * counter, computing the code, and creating both documents all happen
   * inside the SAME transaction so a failure never burns a sequence number
   * (a gap) and two concurrent creates for the same site+stage can never
   * collide on the same code.
   */
  async function createWorkOrder(
    input: CreateWorkOrderInput,
  ): Promise<{ workOrderId: string; surveyReportId: string; workOrderCode: string }> {
    assertAdmin();

    const stage = input.stage ?? 'survey';
    const assignedTo     = input.assignedTo     ?? null;
    const assignedToName = input.assignedToName ?? null;

    // ── Build the approval chain ───────────────────────────────────────────
    // Checked here rather than trusted from the caller: this is the only place
    // a chain is ever seeded, and firestore.rules refuses every stage
    // transition on a document whose chain is not exactly
    // SURVEY_APPROVAL_STAGE_COUNT long — a short chain would create a work
    // order that silently cannot be approved at all.
    if (input.stageOwners.length !== SURVEY_APPROVAL_STAGE_COUNT) {
      throw new Error(
        `Expected ${SURVEY_APPROVAL_STAGE_COUNT} approval stage owners, got ${input.stageOwners.length}`,
      );
    }
    if (input.stageOwners.some((o) => !o.ownerUid)) {
      throw new Error('Every approval stage needs a nominated owner');
    }

    const approvalStages: ApprovalStageResult[] = SURVEY_APPROVAL_STAGES.map((stageDef, i) => ({
      stageKey:      stageDef.key,
      // Denormalised so the document always renders with the wording it was
      // created under, even if the stage array is relabelled later.
      stageLabel:    stageDef.label,
      status:        'pending',
      ownerUid:      input.stageOwners[i].ownerUid,
      ownerName:     input.stageOwners[i].ownerName,
      reviewNotes:   null,
      attachmentUrl: null,
      actedAt:       null,
    }));
    const approvalStageOwnerUids = deriveStageOwnerUids(approvalStages);
    // The live-stage pointer, sourced from the array rather than passed in.
    const approverUid  = approvalStages[0].ownerUid;
    const approverName = approvalStages[0].ownerName;

    const siteRef          = doc(db, 'sites', input.siteId);
    const workOrderRef     = doc(collection(db, 'workOrders'));
    // Deterministic ID == the work order's own ID: exactly one survey exists
    // per work order, so the work order ID is a natural key. This lets
    // useSurveyReport read the survey with a single-doc get() instead of a
    // where('workOrderId','==',...) query — Firestore evaluates `list` rules
    // against the query itself (not the matched documents), and a query on
    // workOrderId can't be proven to satisfy the assignedTo/approverUid rule
    // condition, so it was rejected outright under the deployed rules.
    const surveyReportRef  = doc(db, 'surveyReports', workOrderRef.id);

    const workOrderCode = await runTransaction(db, async (tx) => {
      const siteSnap = await tx.get(siteRef);
      if (!siteSnap.exists()) {
        throw new Error(`Site ${input.siteId} not found`);
      }

      const counters = (siteSnap.data()['workOrderCounters'] as Partial<Record<WorkOrderStage, number>> | undefined) ?? {};
      const next = (counters[stage] ?? 0) + 1;
      const code = `WO-${input.siteCode}-${stage.toUpperCase()}-${String(next).padStart(2, '0')}`;

      // Built here (not before the transaction) because workOrderCode isn't
      // known until the counter read above — a pure function, safe to
      // recompute on a transaction retry.
      const emptySurvey = createEmptySurveyReport({
        workOrderId:   workOrderRef.id,
        workOrderCode: code,
        siteId:        input.siteId,
        siteCode:      input.siteCode,
        siteName:      input.siteName,
        sapCode:       input.sapCode      ?? null,
        zone:          input.zone         ?? null,
        voltageClass:  input.voltageClass ?? null,
        assignedTo,
        assignedToName,
        approverUid,
        approverName,
        approvalStages,
      });
      // Strip the client-only placeholders — Firestore assigns the real doc
      // ID, and createdAt/updatedAt must be serverTimestamp() at write time.
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, ...surveyData } = emptySurvey;

      // Dotted field path so sibling stage counters are never clobbered.
      tx.update(siteRef, { [`workOrderCounters.${stage}`]: next });

      tx.set(workOrderRef, {
        workOrderCode: code,
        siteId:   input.siteId,
        siteCode: input.siteCode,
        siteName: input.siteName,
        sapCode:  input.sapCode ?? null,
        zone:     input.zone    ?? null,
        stage,
        status:   'open',
        assignedTo,
        assignedToName,
        approverUid,
        approverName,
        // Mirrored onto the paired SurveyReport by createEmptySurveyReport
        // above, from the same three values, so the two can never disagree.
        approvalStages,
        currentStageIndex: 0,
        approvalStageOwnerUids,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        archived:  false,
      });

      tx.set(surveyReportRef, {
        ...surveyData,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      return code;
    });

    return { workOrderId: workOrderRef.id, surveyReportId: surveyReportRef.id, workOrderCode };
  }

  /**
   * Reassigns the field engineer on a WorkOrder + its paired SurveyReport in
   * one batch, so the denormalised assignedTo/assignedToName never drift.
   */
  async function reassignWorkOrder(
    workOrderId:    string,
    surveyReportId: string,
    data:           ReassignWorkOrderInput,
  ): Promise<void> {
    assertAdmin();

    const batch = writeBatch(db);

    batch.update(doc(db, 'workOrders', workOrderId), {
      assignedTo:     data.assignedTo,
      assignedToName: data.assignedToName,
      updatedAt:      serverTimestamp(),
    });
    batch.update(doc(db, 'surveyReports', surveyReportId), {
      assignedTo:     data.assignedTo,
      assignedToName: data.assignedToName,
      updatedAt:      serverTimestamp(),
    });

    await batch.commit();
  }

  /**
   * Changes ONE stage's nominated owner on a WorkOrder + its paired
   * SurveyReport. This is how "Final Approver" gets its real owner once
   * confirmed, and how a stage is re-pointed when its reviewer leaves — no
   * code change needed for either.
   *
   * Replaces the previous setWorkOrderApprover, which wrote approverUid alone.
   * That is no longer a safe operation: approverUid must equal
   * approvalStages[currentStageIndex].ownerUid (firestore.rules reads
   * stages[live + 1].ownerUid to decide the next legal handover), and the new
   * owner must appear in approvalStageOwnerUids or they cannot even READ the
   * document they are meant to review. All three move together here.
   *
   * A TRANSACTION, not a batch: Firestore cannot patch one array element, so
   * the whole approvalStages array is rewritten, and writing a stale copy
   * would erase any stage result that landed since the caller loaded the
   * document. The read and both writes are therefore atomic.
   */
  async function reassignApprovalStageOwner(
    workOrderId:    string,
    surveyReportId: string,
    stageKey:       string,
    data:           ReassignApprovalStageOwnerInput,
  ): Promise<void> {
    assertAdmin();
    if (!data.ownerUid) throw new Error('A stage owner is required');

    const workOrderRef    = doc(db, 'workOrders', workOrderId);
    const surveyReportRef  = doc(db, 'surveyReports', surveyReportId);

    await runTransaction(db, async (tx) => {
      const snap = await tx.get(workOrderRef);
      if (!snap.exists()) throw new Error(`Work order ${workOrderId} not found`);

      const current = (snap.data()['approvalStages'] as ApprovalStageResult[] | undefined) ?? [];
      const index   = current.findIndex((s) => s.stageKey === stageKey);
      if (index < 0) {
        throw new Error(`Work order ${workOrderId} has no approval stage "${stageKey}"`);
      }

      // An approved stage is a signed fact attributed to a named person —
      // re-pointing its owner would silently reattribute that approval. A
      // pending or changes_requested stage has not been certified by anyone
      // yet, so both stay reassignable (the latter is exactly the "reviewer
      // left mid-review" case this exists for).
      if (current[index].status === 'approved') {
        throw new Error(
          `"${current[index].stageLabel}" has already been approved and cannot be reassigned`,
        );
      }

      const approvalStages = current.map((stage, i) =>
        i === index
          ? { ...stage, ownerUid: data.ownerUid, ownerName: data.ownerName }
          : stage,
      );
      const approvalStageOwnerUids = deriveStageOwnerUids(approvalStages);

      // If the stage being repointed is the LIVE one, the document's
      // "who must act now" pointer has to follow it, or the work order stays
      // owned by someone who is no longer nominated to it.
      const liveIndex = (snap.data()['currentStageIndex'] as number | undefined) ?? 0;
      const livePointer = liveIndex === index
        ? { approverUid: data.ownerUid, approverName: data.ownerName }
        : {};

      const patch = {
        approvalStages,
        approvalStageOwnerUids,
        ...livePointer,
        updatedAt: serverTimestamp(),
      };

      tx.update(workOrderRef,   patch);
      tx.update(surveyReportRef, patch);
    });
  }

  /**
   * Moves a submitted survey's review straight to any stage, bypassing normal
   * progression — the admin override.
   *
   * Needs no rules change: the admin branch on both collections is a bare
   * isAdmin() with no field fence, so this shape is already permitted (proved
   * by the admin-jump assertions in tests/rules/chainV2.test.mjs, including
   * that a non-admin — even a nominated stage owner — is refused). assertAdmin
   * below is the client-side half of that, giving a clear error instead of a
   * bare permission-denied.
   *
   * Writes exactly: currentStageIndex = N, approverUid/Name -> stage N's
   * owner, approvalStages[N].status = 'pending', reviewDirection = 'forward'.
   * Resetting the target stage to pending is what makes the jump meaningful —
   * jumping to a stage that still reads 'approved' would leave the reviewer
   * looking at their own stale verdict.
   *
   * Only for a survey that has been submitted at least once: a status of
   * 'open' means nothing has been sent for review, so there is no review to
   * move.
   */
  async function jumpToApprovalStage(
    workOrderId:    string,
    surveyReportId: string,
    stageIndex:     number,
  ): Promise<void> {
    assertAdmin();

    const workOrderRef    = doc(db, 'workOrders', workOrderId);
    const surveyReportRef = doc(db, 'surveyReports', surveyReportId);

    await runTransaction(db, async (tx) => {
      const snap = await tx.get(workOrderRef);
      if (!snap.exists()) throw new Error(`Work order ${workOrderId} not found`);

      const data    = snap.data();
      const current = (data['approvalStages'] as ApprovalStageResult[] | undefined) ?? [];
      if (stageIndex < 0 || stageIndex >= current.length) {
        throw new Error('That approval stage does not exist on this survey.');
      }
      if (data['status'] === 'open') {
        throw new Error('This survey has not been submitted yet — there is no review to move.');
      }
      if (!current[stageIndex].ownerUid) {
        throw new Error(
          `"${current[stageIndex].stageLabel}" has no owner — assign one before jumping to it.`,
        );
      }

      const approvalStages = current.map((stage, i) =>
        i === stageIndex
          ? { ...stage, status: 'pending' as const, reviewNotes: null, attachmentUrl: null, actedAt: null }
          : stage,
      );

      const patch = {
        approvalStages,
        currentStageIndex: stageIndex,
        approverUid:       current[stageIndex].ownerUid,
        approverName:      current[stageIndex].ownerName,
        reviewDirection:   'forward' as const,
        status:            'pending_approval' as const,
        updatedAt:         serverTimestamp(),
      };

      tx.update(workOrderRef,    patch);
      tx.update(surveyReportRef, patch);
    });
  }

  return { createWorkOrder, reassignWorkOrder, reassignApprovalStageOwner, jumpToApprovalStage };
}
