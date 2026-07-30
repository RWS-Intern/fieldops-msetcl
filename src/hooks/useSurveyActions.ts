import {
  doc,
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
    await batch.commit();
  }

  return { saveProgress, submitSurvey };
}
