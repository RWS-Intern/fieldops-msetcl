import { useEffect, useState } from 'react';
import {
  collection,
  query,
  where,
  onSnapshot,
} from 'firebase/firestore';
import { db } from '@/firebase/config';
import { useAuthStore } from '@/store/authStore';
import { SURVEY_APPROVAL_STAGES, findApprovalStage } from '@/lib/approvalStages';
import type { WorkOrder, WorkOrderStage, WorkOrderStatus, ApprovalStageResult } from '@/types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapApprovalStage(raw: Record<string, any>, index: number): ApprovalStageResult {
  const stageKey = raw['stageKey'] ?? SURVEY_APPROVAL_STAGES[index]?.key ?? '';
  return {
    stageKey,
    stageLabel:    raw['stageLabel'] ?? findApprovalStage(stageKey)?.label ?? stageKey,
    status:        (raw['status'] ?? 'pending') as ApprovalStageResult['status'],
    ownerUid:      raw['ownerUid']      ?? null,
    ownerName:     raw['ownerName']     ?? null,
    reviewNotes:   raw['reviewNotes']   ?? null,
    attachmentUrl: raw['attachmentUrl'] ?? null,
    actedAt:       raw['actedAt']?.toDate?.() ?? null,
  };
}

/** See the identical helper in useSurveyReport.ts for why legacy docs get this. */
function legacyApprovalStages(
  approverUid:  string | null,
  approverName: string | null,
): ApprovalStageResult[] {
  return SURVEY_APPROVAL_STAGES.map((stage, i) => ({
    stageKey:      stage.key,
    stageLabel:    stage.label,
    status:        'pending' as const,
    ownerUid:      i === 0 ? approverUid  : null,
    ownerName:     i === 0 ? approverName : null,
    reviewNotes:   null,
    attachmentUrl: null,
    actedAt:       null,
  }));
}

// Exported for reuse by useSiteWorkOrders.ts — every reader of workOrders
// documents must map them identically.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapWorkOrder(id: string, data: Record<string, any>): WorkOrder {
  return {
    id,
    workOrderCode:  data['workOrderCode']  ?? '',
    siteId:         data['siteId']         ?? '',
    siteCode:       data['siteCode']       ?? '',
    siteName:       data['siteName']       ?? '',
    sapCode:        data['sapCode']        ?? null,
    zone:           data['zone']           ?? null,
    stage:          (data['stage']  ?? 'survey') as WorkOrderStage,
    status:         (data['status'] ?? 'open')   as WorkOrderStatus,
    assignedTo:     data['assignedTo']     ?? null,
    assignedToName: data['assignedToName'] ?? null,
    approverUid:    data['approverUid']    ?? null,
    approverName:   data['approverName']   ?? null,
    approvalStages: Array.isArray(data['approvalStages']) && data['approvalStages'].length > 0
      ? data['approvalStages'].map(mapApprovalStage)
      : legacyApprovalStages(data['approverUid'] ?? null, data['approverName'] ?? null),
    currentStageIndex: data['currentStageIndex'] ?? 0,
    approvalStageOwnerUids: data['approvalStageOwnerUids']
      ?? (data['approverUid'] ? [data['approverUid']] : []),
    createdAt:      data['createdAt']?.toDate?.() ?? new Date(),
    updatedAt:      data['updatedAt']?.toDate?.() ?? new Date(),
    archived:       data['archived'] ?? false,
  };
}

/**
 * Real-time listener for WorkOrders assigned to the current user.
 *
 * Query: where('assignedTo', '==', uid) — single-field equality, no
 * composite index required. Archived filtering and sorting are done
 * client-side (same pattern as useEngineerTasks / useApprovalQueue).
 */
export function useAssignedWorkOrders() {
  const { currentUser } = useAuthStore();
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [loading,    setLoading]    = useState(true);

  useEffect(() => {
    if (!currentUser) {
      setWorkOrders([]);
      setLoading(false);
      return;
    }

    setLoading(true);

    const q = query(
      collection(db, 'workOrders'),
      where('assignedTo', '==', currentUser.uid),
    );

    const unsubscribe = onSnapshot(
      q,
      (snap) => {
        const result: WorkOrder[] = snap.docs
          .map((d) => mapWorkOrder(d.id, d.data()))
          // Client-side archived filter — avoids needing a 3-field composite index.
          .filter((w) => !w.archived)
          .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

        setWorkOrders(result);
        setLoading(false);
      },
      (err) => {
        console.error('[useAssignedWorkOrders] listener error:', err);
        setLoading(false);
      },
    );

    return () => unsubscribe();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.uid]);

  return { workOrders, loading };
}
