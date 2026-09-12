import {
  doc,
  getDoc,
  collection,
  addDoc,
  writeBatch,
  serverTimestamp,
} from 'firebase/firestore';
import { db }           from '@/firebase/config';
import { useAuthStore } from '@/store/authStore';
import type {
  SurveyReport, WorkOrderStatus, ApprovalStageResult, ReviewDirection,
} from '@/types';

// ─── Field stripping ────────────────────────────────────────────────────────────
// Fields an engineer write must NEVER include: the deployed rules reject any
// write that changes assignedTo/approverUid (self-reassignment guard), and
// id/workOrderId/siteId/createdAt/updatedAt are identifiers/timestamps that
// are set once at creation or by serverTimestamp() here, never resent.
//
// The three approval-chain fields are stripped for a subtler reason. The rules'
// engineer branch pins them to their stored values, and the wizard holds a FULL
// survey object — so submitting would resend whatever chain the wizard loaded.
// If a stage owner acted while the engineer had the wizard open (entirely
// possible on a changes_requested round trip), that copy is stale and the
// equality pin would refuse the whole submission. Omitting the fields leaves
// them untouched server-side, which satisfies the pin no matter how old the
// engineer's snapshot is. An engineer owns the survey's content, never its
// approval record.

/** Audit-log wording, one entry per decision — see reviewSurvey. */
const REVIEW_DECISION_AUDIT_VERB: Record<ReviewDecision, string> = {
  approve:         'Approved',
  request_changes: 'Requested changes on',
  agree:           'Agreed with the flag raised above',
  disagree:        'Disagreed with the flag raised above, approving',
};

const UNWRITABLE_KEYS = [
  'id', 'workOrderId', 'siteId',
  'assignedTo', 'assignedToName', 'approverUid', 'approverName',
  'approvalStages', 'currentStageIndex', 'approvalStageOwnerUids', 'reviewDirection',
  'createdAt', 'updatedAt',
] as const;

function stripUnwritableFields(data: Partial<SurveyReport>): Partial<SurveyReport> {
  const copy: Partial<SurveyReport> = { ...data };
  for (const key of UNWRITABLE_KEYS) {
    delete copy[key];
  }
  return copy;
}

// ─── Input types ────────────────────────────────────────────────────────────────

export interface SaveProgressInput {
  workOrderId: string;
  /** Whatever survey fields the wizard currently holds — no validation, task 3 owns that. */
  data: Partial<SurveyReport>;
  /** survey.status BEFORE this save. */
  previousStatus: WorkOrderStatus;
}

export interface SubmitSurveyInput {
  workOrderId: string;
  data: Partial<SurveyReport>;
  /**
   * Captured explicitly by the caller rather than read from the live
   * session, so an offline submission drained later under a different
   * logged-in account still attributes correctly to whoever actually tapped
   * "Submit" — this is a jointly-signed record headed for government
   * vetting, so provenance matters more here than in ordinary task tracking.
   */
  submittedBy: string;
  submittedByName: string;
}

/**
 * What a reviewer can do, by the direction the chain is travelling.
 *
 *   forward  — 'approve' | 'request_changes'
 *   backward — 'agree'   | 'disagree'   (an escalation review: do you agree
 *              with the flag raised above you?)
 *
 * A decision that doesn't belong to the live direction is rejected before any
 * write, because firestore.rules would refuse it anyway and a clear error
 * beats a bare permission-denied.
 */
export type ReviewDecision = 'approve' | 'request_changes' | 'agree' | 'disagree';

export interface ReviewSurveyInput {
  decision: ReviewDecision;
  /** Required for 'request_changes' and 'agree' — both record a flag. */
  reviewNotes?: string;
  workOrderId: string;
  /**
   * The survey's current approverUid — passed in so the guard can be checked
   * without an extra read (same pattern as reviewSiteTask). Unlike
   * reviewSiteTask, there is no null-approver admin fallback: neither
   * workOrders nor surveyReports has legacy data predating mandatory
   * approver assignment, and the deployed rules' approver branch on both
   * collections has no such fallback either.
   */
  approverUid: string | null;
  /**
   * The LIVE approvalStages array, straight from the caller's snapshot.
   *
   * Must be the stored array, not one rebuilt from SURVEY_APPROVAL_STAGES:
   * firestore.rules requires every entry except the acting one to be
   * byte-identical to its stored value, and a rebuilt entry differs (a fresh
   * actedAt alone is enough) so the whole write is refused as tampering.
   */
  approvalStages: ApprovalStageResult[];
  /** The live stage index, straight from the caller's snapshot. */
  currentStageIndex: number;
  /**
   * The direction the chain was travelling BEFORE this write, straight from
   * the caller's snapshot. This is what selects the transition table below,
   * exactly as firestore.rules keys isValidStageTransition on the stored
   * value. Defaults to 'forward' for documents written before the field
   * existed.
   */
  reviewDirection: ReviewDirection;
  /** Optional at every stage — an already-uploaded https URL, or null. */
  attachmentUrl?: string | null;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useSurveyActions() {
  const { currentUser } = useAuthStore();

  /**
   * Writes wizard progress to Firestore (both surveyReports and the parent
   * workOrders doc, so they never disagree).
   *
   * Per the deployed rules, the engineer branch on both collections only
   * allows a resulting status of 'in_progress' or 'pending_approval' —
   * 'open' (the freshly-created default) and 'changes_requested' (after an
   * approver sends work back) are NOT in that set, so saving from either
   * state must flip to 'in_progress' or the write is rejected outright.
   * Resuming a changes_requested survey to work on it again IS starting a
   * new round of "in progress," so this is the correct transition, not just
   * a rules workaround.
   */
  async function saveProgress(
    surveyReportId: string,
    input: SaveProgressInput,
  ): Promise<void> {
    if (!currentUser) throw new Error('Not authenticated');

    const nextStatus: WorkOrderStatus =
      input.previousStatus === 'open' || input.previousStatus === 'changes_requested'
        ? 'in_progress'
        : input.previousStatus;

    const safeData = stripUnwritableFields(input.data);

    const batch = writeBatch(db);
    batch.update(doc(db, 'surveyReports', surveyReportId), {
      ...safeData,
      status:    nextStatus,
      updatedAt: serverTimestamp(),
    });
    batch.update(doc(db, 'workOrders', input.workOrderId), {
      status:    nextStatus,
      updatedAt: serverTimestamp(),
    });
    await batch.commit();
  }

  /**
   * Final submission for approval. Writes the full survey with
   * status: 'pending_approval' and updates the parent WorkOrder to the same
   * status in the SAME batch — the work order and its survey must never
   * disagree. Never writes assignedTo/approverUid (rules reject it).
   *
   * Also writes an immutable audit-trail snapshot to
   * surveyReports/{id}/updates in the same batch (action: 'submit', plus a
   * full copy of the payload as submitted) — the round-by-round history of
   * what was actually certified. This is the ONLY place submitSurvey is
   * called from (both the online path in SurveyWizardPage.tsx and the
   * offline-drain path in SurveyQueueProcessor.tsx call this same function),
   * so every real submission gets a snapshot with no duplicated call site.
   */
  async function submitSurvey(
    surveyReportId: string,
    input: SubmitSurveyInput,
  ): Promise<void> {
    if (!currentUser) throw new Error('Not authenticated');

    const safeData = stripUnwritableFields(input.data);

    // Which stage of the chain this submission is answering. Read from the
    // SUBMITTED payload, not from the live document, for exactly the reason
    // submittedBy is captured by the caller: an offline submission drained
    // hours later must record the round the engineer was actually responding
    // to. A resubmission after stage 2 sent work back is therefore tagged
    // stage 2, not stage 1.
    //
    // Read before stripUnwritableFields removes them — the chain fields are
    // stripped from the WRITE (an engineer never rewrites the approval
    // record) but are still valid provenance for the audit snapshot.
    // ── Restart the chain at Approver Level 1 ───────────────────────────────
    // firestore.rules' isChainRestart requires approvalStages PRESENT and
    // byte-identical, currentStageIndex 0, approverUid pinned to stage 0's
    // nominated owner, and direction 'forward'. Omitting approvalStages on the
    // theory that "unchanged means don't send it" fails the rule.
    //
    // The array is read from the LIVE document here, never from input.data:
    // the engineer's wizard copy can be hours stale (a stage owner may have
    // acted while they had it open, and an offline submission drains later
    // still), and the equality check is against what is stored right now.
    // Reading raw snapshot data — NOT mapSurveyReport — matters: the mapper
    // converts actedAt Timestamps to Dates, which would not compare equal.
    const liveSnap  = await getDoc(doc(db, 'surveyReports', surveyReportId));
    const liveData  = liveSnap.data() ?? {};
    const liveStages = (liveData['approvalStages'] ?? []) as { ownerUid?: string | null; ownerName?: string | null; stageKey?: string }[];

    // A survey created before the chain existed has no stages to restart —
    // leave its chain fields untouched rather than inventing one.
    const chainRestart = liveStages.length > 0
      ? {
          approvalStages:    liveData['approvalStages'],
          currentStageIndex: 0,
          approverUid:       liveStages[0].ownerUid  ?? null,
          approverName:      liveStages[0].ownerName ?? null,
          reviewDirection:   'forward' as ReviewDirection,
        }
      : {};

    // The submission answers the stage it is being handed to — Level 1, since
    // the chain restarts there. Null for a pre-chain survey, which genuinely
    // has no stage to name; guessing 0 would mislabel it on a document headed
    // for government vetting.
    const { stageKey, stageIndex } = liveStages.length > 0
      ? { stageKey: liveStages[0].stageKey ?? null, stageIndex: 0 as number | null }
      : { stageKey: null, stageIndex: null };

    const batch = writeBatch(db);
    batch.update(doc(db, 'surveyReports', surveyReportId), {
      ...safeData,
      ...chainRestart,
      status:          'pending_approval',
      submittedBy:     input.submittedBy,
      submittedByName: input.submittedByName,
      submittedAt:     serverTimestamp(),
      updatedAt:       serverTimestamp(),
    });
    batch.update(doc(db, 'workOrders', input.workOrderId), {
      ...chainRestart,
      status:    'pending_approval',
      updatedAt: serverTimestamp(),
    });

    const updateRef = doc(collection(db, 'surveyReports', surveyReportId, 'updates'));
    batch.set(updateRef, {
      action:    'submit',
      actorUid:  input.submittedBy,
      actorName: input.submittedByName,
      createdAt: serverTimestamp(),
      stageKey,
      stageIndex,
      payload:   safeData,
    });

    await batch.commit();
  }

  /**
   * One stage's decision on a pending_approval SurveyReport. Guarded strictly
   * to the LIVE stage owner (no admin fallback — see ReviewSurveyInput).
   * Online-only: no offline queue, matching reviewSiteTask.
   *
   * FOUR transition shapes, keyed on the direction the chain was travelling
   * BEFORE this write. This mirrors reviewPayloads() in
   * tests/rules/chainRoundTrip.test.mjs — that suite is the reference
   * implementation and the regression check for every shape below, so the two
   * must not drift.
   *
   *   forward + approve          -> advance one stage, or complete if last.
   *   forward + request_changes  -> Level 1 sends it to the field; ANY HIGHER
   *                                 stage starts the escalation cascade
   *                                 instead: one stage DOWN, direction
   *                                 'backward', and the top-level status stays
   *                                 'pending_approval' so the field sees
   *                                 nothing yet.
   *   backward + agree           -> this reviewer also flags it. At Level 1
   *                                 that finally reaches the field and resets
   *                                 the direction; above it, cascade one more
   *                                 stage down.
   *   backward + disagree        -> bounce the flag back UP one stage AND
   *                                 reset that stage to 'pending' so its owner
   *                                 must reconsider. Returns the direction to
   *                                 'forward', which is why the bounced-to
   *                                 stage's next action needs no special case.
   *
   * The stage array is derived from input.approvalStages (the caller's live
   * snapshot) with ONLY the acting index replaced — plus, on a disagree, the
   * one index above it reset. It is never rebuilt from SURVEY_APPROVAL_STAGES:
   * firestore.rules compares every other entry for byte equality against what
   * is stored and refuses the write otherwise.
   *
   * One writeBatch updates surveyReports + the parent workOrders doc to the
   * SAME status (they must never disagree), and writes an immutable audit-trail
   * snapshot to surveyReports/{id}/updates.
   */
  async function reviewSurvey(
    surveyReportId: string,
    input: ReviewSurveyInput,
  ): Promise<void> {
    if (!currentUser) throw new Error('Not authenticated');
    // A viewer is never authorised, even when approverUid still points at them
    // — that happens when an approver is demoted to viewer while surveys are
    // still in their queue. firestore.rules refuses the write too.
    if (currentUser.role === 'viewer' || currentUser.uid !== input.approverUid) {
      throw new Error('You are not authorized to review this survey.');
    }

    const direction = input.reviewDirection ?? 'forward';
    const isForwardDecision = input.decision === 'approve' || input.decision === 'request_changes';
    if ((direction === 'forward') !== isForwardDecision) {
      throw new Error(
        direction === 'backward'
          ? 'This survey is under escalation review — agree or disagree with the flag instead.'
          : 'This survey is not under escalation review.',
      );
    }

    // Both flagging decisions must say why. 'agree' is a flag too: the
    // reviewer is adding their own name to the objection travelling down.
    const trimmedNotes = input.reviewNotes?.trim() ?? '';
    const isFlag = input.decision === 'request_changes' || input.decision === 'agree';
    if (isFlag && !trimmedNotes) {
      throw new Error('Review notes are required when sending a survey back.');
    }

    const stages    = input.approvalStages;
    const liveIndex = input.currentStageIndex;
    const lastIndex = stages.length - 1;
    if (liveIndex < 0 || liveIndex > lastIndex) {
      throw new Error('This survey is not awaiting a review decision.');
    }
    if (input.decision === 'disagree' && liveIndex >= lastIndex) {
      throw new Error('There is no stage above this one to send the flag back to.');
    }

    const reviewNotes = isFlag ? trimmedNotes : (trimmedNotes || null);

    // ── Where the document goes next ────────────────────────────────────────
    const toField = {
      status:            'changes_requested' as WorkOrderStatus,
      currentStageIndex: 0,
      approverUid:       stages[0].ownerUid,
      approverName:      stages[0].ownerName,
      reviewDirection:   'forward' as ReviewDirection,
    };
    const complete = {
      status:            'approved' as WorkOrderStatus,
      currentStageIndex: stages.length,
      approverUid:       null,
      approverName:      null,
      reviewDirection:   'forward' as ReviewDirection,
    };
    const up = (dir: ReviewDirection) => ({
      status:            'pending_approval' as WorkOrderStatus,
      currentStageIndex: liveIndex + 1,
      approverUid:       stages[liveIndex + 1].ownerUid,
      approverName:      stages[liveIndex + 1].ownerName,
      reviewDirection:   dir,
    });
    const down = (dir: ReviewDirection) => ({
      status:            'pending_approval' as WorkOrderStatus,
      currentStageIndex: liveIndex - 1,
      approverUid:       stages[liveIndex - 1].ownerUid,
      approverName:      stages[liveIndex - 1].ownerName,
      reviewDirection:   dir,
    });

    const advance =
      direction === 'forward'
        ? (input.decision === 'approve'
            ? (liveIndex === lastIndex ? complete : up('forward'))
            : (liveIndex === 0 ? toField : down('backward')))
        : (input.decision === 'agree'
            ? (liveIndex === 0 ? toField : down('backward'))
            : up('forward'));

    // What this reviewer records against their OWN stage.
    const ownStatus: ApprovalStageResult['status'] =
      direction === 'forward'
        ? (input.decision === 'approve' ? 'approved' : 'changes_requested')
        : (input.decision === 'agree'   ? 'changes_requested' : 'approved');

    // Only the acting entry is replaced — plus, on a disagree, the stage above
    // it, reset to the exact shape isResetToPending permits: identity and
    // ownership pinned, the three result fields cleared. Every other element is
    // carried through by reference so it serialises byte-identically to what is
    // stored. actedAt is a client Date by necessity — Firestore rejects
    // serverTimestamp() inside an array element (see ApprovalStageResult).
    const approvalStages: ApprovalStageResult[] = stages.map((stage, i) => {
      if (i === liveIndex) {
        return {
          ...stage,
          status:        ownStatus,
          reviewNotes,
          attachmentUrl: input.attachmentUrl ?? null,
          actedAt:       new Date(),
        };
      }
      if (input.decision === 'disagree' && i === liveIndex + 1) {
        return {
          ...stage,
          status:        'pending',
          reviewNotes:   null,
          attachmentUrl: null,
          actedAt:       null,
        };
      }
      return stage;
    });

    const batch = writeBatch(db);
    batch.update(doc(db, 'surveyReports', surveyReportId), {
      ...advance,
      approvalStages,
      reviewNotes,
      reviewedBy:     currentUser.uid,
      reviewedByName: currentUser.name,
      reviewedAt:     serverTimestamp(),
      updatedAt:      serverTimestamp(),
    });
    batch.update(doc(db, 'workOrders', input.workOrderId), {
      ...advance,
      approvalStages,
      updatedAt: serverTimestamp(),
    });

    const updateRef = doc(collection(db, 'surveyReports', surveyReportId, 'updates'));
    batch.set(updateRef, {
      action:    input.decision,
      actorUid:  currentUser.uid,
      actorName: currentUser.name,
      createdAt: serverTimestamp(),
      // Which stage this decision belonged to — the review screen's History
      // section reads these, and the server timestamp above is the
      // trustworthy record of when it happened (unlike the stage's actedAt).
      stageKey:   stages[liveIndex].stageKey,
      stageIndex: liveIndex,
      ...(reviewNotes ? { reviewNotes } : {}),
      ...(input.attachmentUrl ? { attachmentUrl: input.attachmentUrl } : {}),
    });

    await batch.commit();

    // ── Audit log (non-critical) ──────────────────────────────────────────────
    try {
      await addDoc(collection(db, 'auditLog'), {
        timestamp:      serverTimestamp(),
        uid:            currentUser.uid,
        userName:       currentUser.name,
        action:         'REVIEW_SURVEY',
        detail:
          `${REVIEW_DECISION_AUDIT_VERB[input.decision]} ` +
          `"${stages[liveIndex].stageLabel}" of survey ${surveyReportId}`,
        surveyReportId,
        workOrderId:    input.workOrderId,
        stageKey:       stages[liveIndex].stageKey,
        stageIndex:     liveIndex,
      });
    } catch (auditErr) {
      console.warn('[reviewSurvey] auditLog write failed:', auditErr);
    }
  }

  return { saveProgress, submitSurvey, reviewSurvey };
}
