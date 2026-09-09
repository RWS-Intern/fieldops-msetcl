import {
  doc,
  collection,
  addDoc,
  writeBatch,
  serverTimestamp,
} from 'firebase/firestore';
import { db }           from '@/firebase/config';
import { useAuthStore } from '@/store/authStore';
import type { SurveyReport, WorkOrderStatus, ApprovalStageResult } from '@/types';

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

const UNWRITABLE_KEYS = [
  'id', 'workOrderId', 'siteId',
  'assignedTo', 'assignedToName', 'approverUid', 'approverName',
  'approvalStages', 'currentStageIndex', 'approvalStageOwnerUids',
  'createdAt', 'updatedAt',
] as const;

function stripUnwritableFields(data: Partial<SurveyReport>): Partial<SurveyReport> {
  const copy: Partial<SurveyReport> = { ...data };
  for (const key of UNWRITABLE_KEYS) {
    delete copy[key];
  }
  return copy;
}

/**
 * The approval stage a submission belongs to, taken from the payload as it
 * stood at submit time.
 *
 * Both fields are nullable rather than defaulted, because a survey created
 * before the approval chain existed — or a submission queued offline by an
 * older build — genuinely has no stage to name. Writing null keeps that
 * honest; guessing index 0 would label a resubmission as "Approver Level 1"
 * on a document headed for government vetting.
 */
function resolveSubmittedStage(
  data: Partial<SurveyReport>,
): { stageKey: string | null; stageIndex: number | null } {
  const index = data.currentStageIndex;
  if (typeof index !== 'number' || index < 0) {
    return { stageKey: null, stageIndex: null };
  }
  return {
    stageKey:   data.approvalStages?.[index]?.stageKey ?? null,
    stageIndex: index,
  };
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

export interface ReviewSurveyInput {
  decision: 'approve' | 'request_changes';
  /** Required when decision === 'request_changes'. */
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
    const { stageKey, stageIndex } = resolveSubmittedStage(input.data);

    const batch = writeBatch(db);
    batch.update(doc(db, 'surveyReports', surveyReportId), {
      ...safeData,
      status:          'pending_approval',
      submittedBy:     input.submittedBy,
      submittedByName: input.submittedByName,
      submittedAt:     serverTimestamp(),
      updatedAt:       serverTimestamp(),
    });
    batch.update(doc(db, 'workOrders', input.workOrderId), {
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
   * One stage's review decision on a pending_approval SurveyReport — approve
   * (advancing the chain) or send it back with review notes. Guarded strictly
   * to the LIVE stage owner (no admin fallback — see ReviewSurveyInput).
   * Online-only: no offline queue, matching reviewSiteTask.
   *
   * On APPROVE:
   *   - the acting stage's entry gets status/reviewNotes/attachmentUrl/actedAt;
   *   - a NON-final stage advances currentStageIndex by one, moves
   *     approverUid/approverName to the next stage's nominated owner, and
   *     leaves the document at 'pending_approval' — it is still awaiting
   *     approval, just by someone else;
   *   - the FINAL stage sets the document to 'approved', currentStageIndex to
   *     the chain length, and clears approverUid — nobody owns it any more.
   *
   * On REQUEST CHANGES nothing about position or ownership moves: the flagging
   * stage keeps the document so the engineer's resubmission comes back to the
   * same reviewer rather than restarting the chain at stage 1.
   *
   * The stage array is derived from input.approvalStages (the caller's live
   * snapshot) with ONLY the acting index replaced. It is never rebuilt from
   * SURVEY_APPROVAL_STAGES — firestore.rules compares every other entry for
   * byte equality against what is stored and refuses the write otherwise.
   *
   * One writeBatch updates surveyReports + the parent workOrders doc to the
   * SAME status (they must never disagree — the discipline carried since
   * task 2), and writes an immutable audit-trail snapshot to
   * surveyReports/{id}/updates.
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

    const trimmedNotes = input.reviewNotes?.trim() ?? '';
    if (input.decision === 'request_changes' && !trimmedNotes) {
      throw new Error('Review notes are required when requesting changes.');
    }

    const stages    = input.approvalStages;
    const liveIndex = input.currentStageIndex;
    if (liveIndex < 0 || liveIndex >= stages.length) {
      throw new Error('This survey is not awaiting a review decision.');
    }

    const reviewNotes = input.decision === 'request_changes' ? trimmedNotes : (trimmedNotes || null);
    const isFinalStage = liveIndex === stages.length - 1;

    // Only the acting entry is replaced; every other element is carried
    // through by reference so it serialises byte-identically to what is
    // stored. actedAt is a client Date by necessity — Firestore rejects
    // serverTimestamp() inside an array element (see ApprovalStageResult).
    const approvalStages: ApprovalStageResult[] = stages.map((stage, i) =>
      i === liveIndex
        ? {
            ...stage,
            status:        input.decision === 'approve' ? 'approved' : 'changes_requested',
            reviewNotes,
            attachmentUrl: input.attachmentUrl ?? null,
            actedAt:       new Date(),
          }
        : stage,
    );

    // Where the document goes next.
    const advance =
      input.decision === 'request_changes'
        ? {
            // Flagging stage keeps it — resume-at-flagging-stage.
            status:            'changes_requested' as WorkOrderStatus,
            currentStageIndex: liveIndex,
            approverUid:       input.approverUid,
            approverName:      stages[liveIndex].ownerName,
          }
        : isFinalStage
        ? {
            status:            'approved' as WorkOrderStatus,
            currentStageIndex: stages.length,
            approverUid:       null,
            approverName:      null,
          }
        : {
            status:            'pending_approval' as WorkOrderStatus,
            currentStageIndex: liveIndex + 1,
            approverUid:       stages[liveIndex + 1].ownerUid,
            approverName:      stages[liveIndex + 1].ownerName,
          };

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
      ...(input.decision === 'request_changes' ? { reviewNotes } : {}),
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
          `${input.decision === 'approve' ? 'Approved' : 'Requested changes on'} ` +
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
