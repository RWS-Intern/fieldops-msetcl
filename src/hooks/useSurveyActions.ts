import {
  doc,
  collection,
  addDoc,
  writeBatch,
  serverTimestamp,
} from 'firebase/firestore';
import { db }           from '@/firebase/config';
import { useAuthStore } from '@/store/authStore';
import type { SurveyReport, WorkOrderStatus } from '@/types';

// ─── Field stripping ────────────────────────────────────────────────────────────
// Fields an engineer write must NEVER include: the deployed rules reject any
// write that changes assignedTo/approverUid (self-reassignment guard), and
// id/workOrderId/siteId/createdAt/updatedAt are identifiers/timestamps that
// are set once at creation or by serverTimestamp() here, never resent.

const UNWRITABLE_KEYS = [
  'id', 'workOrderId', 'siteId',
  'assignedTo', 'assignedToName', 'approverUid', 'approverName',
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
      payload:   safeData,
    });

    await batch.commit();
  }

  /**
   * Approver review of a pending_approval SurveyReport — approve or send
   * back with review notes. Guarded strictly to the nominated approver (no
   * admin fallback — see ReviewSurveyInput). Online-only: no offline queue,
   * matching reviewSiteTask.
   *
   * One writeBatch updates surveyReports + the parent workOrders doc to the
   * SAME status (they must never disagree — the discipline carried since
   * task 2), and writes an immutable audit-trail snapshot to
   * surveyReports/{id}/updates (metadata only — approve/request_changes
   * never change survey content, so there's nothing to duplicate).
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

    const newStatus: WorkOrderStatus = input.decision === 'approve' ? 'approved' : 'changes_requested';
    const reviewNotes = input.decision === 'request_changes' ? trimmedNotes : null;

    const batch = writeBatch(db);
    batch.update(doc(db, 'surveyReports', surveyReportId), {
      status:         newStatus,
      reviewNotes,
      reviewedBy:     currentUser.uid,
      reviewedByName: currentUser.name,
      reviewedAt:     serverTimestamp(),
      updatedAt:      serverTimestamp(),
    });
    batch.update(doc(db, 'workOrders', input.workOrderId), {
      status:    newStatus,
      updatedAt: serverTimestamp(),
    });

    const updateRef = doc(collection(db, 'surveyReports', surveyReportId, 'updates'));
    batch.set(updateRef, {
      action:    input.decision,
      actorUid:  currentUser.uid,
      actorName: currentUser.name,
      createdAt: serverTimestamp(),
      ...(input.decision === 'request_changes' ? { reviewNotes } : {}),
    });

    await batch.commit();

    // ── Audit log (non-critical) ──────────────────────────────────────────────
    try {
      await addDoc(collection(db, 'auditLog'), {
        timestamp:      serverTimestamp(),
        uid:            currentUser.uid,
        userName:       currentUser.name,
        action:         'REVIEW_SURVEY',
        detail:         `${input.decision === 'approve' ? 'Approved' : 'Requested changes on'} survey ${surveyReportId}`,
        surveyReportId,
        workOrderId:    input.workOrderId,
      });
    } catch (auditErr) {
      console.warn('[reviewSurvey] auditLog write failed:', auditErr);
    }
  }

  return { saveProgress, submitSurvey, reviewSurvey };
}
