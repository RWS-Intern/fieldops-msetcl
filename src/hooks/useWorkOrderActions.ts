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
import type { WorkOrderStage } from '@/types';

// ─── Input types ────────────────────────────────────────────────────────────────

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
  approverUid?:    string | null;
  approverName?:   string | null;
}

export interface ReassignWorkOrderInput {
  assignedTo:     string | null;
  assignedToName: string | null;
}

export interface SetWorkOrderApproverInput {
  approverUid:  string | null;
  approverName: string | null;
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
    const approverUid    = input.approverUid    ?? null;
    const approverName   = input.approverName   ?? null;

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

    const emptySurvey = createEmptySurveyReport({
      workOrderId:  workOrderRef.id,
      siteId:       input.siteId,
      siteCode:     input.siteCode,
      sapCode:      input.sapCode      ?? null,
      zone:         input.zone         ?? null,
      voltageClass: input.voltageClass ?? null,
      assignedTo,
      assignedToName,
      approverUid,
      approverName,
    });
    // Strip the client-only placeholders — Firestore assigns the real doc ID,
    // and createdAt/updatedAt must be serverTimestamp() at write time.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, ...surveyData } = emptySurvey;

    const workOrderCode = await runTransaction(db, async (tx) => {
      const siteSnap = await tx.get(siteRef);
      if (!siteSnap.exists()) {
        throw new Error(`Site ${input.siteId} not found`);
      }

      const counters = (siteSnap.data()['workOrderCounters'] as Partial<Record<WorkOrderStage, number>> | undefined) ?? {};
      const next = (counters[stage] ?? 0) + 1;
      const code = `WO-${input.siteCode}-${stage.toUpperCase()}-${String(next).padStart(2, '0')}`;

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
   * Sets/changes the nominated approver on a WorkOrder + its paired
   * SurveyReport in one batch, so the denormalised approverUid/approverName
   * never drift.
   */
  async function setWorkOrderApprover(
    workOrderId:    string,
    surveyReportId: string,
    data:           SetWorkOrderApproverInput,
  ): Promise<void> {
    assertAdmin();

    const batch = writeBatch(db);

    batch.update(doc(db, 'workOrders', workOrderId), {
      approverUid:  data.approverUid,
      approverName: data.approverName,
      updatedAt:    serverTimestamp(),
    });
    batch.update(doc(db, 'surveyReports', surveyReportId), {
      approverUid:  data.approverUid,
      approverName: data.approverName,
      updatedAt:    serverTimestamp(),
    });

    await batch.commit();
  }

  return { createWorkOrder, reassignWorkOrder, setWorkOrderApprover };
}
