import { useEffect, useState } from 'react';
import {
  collection,
  query,
  where,
  onSnapshot,
} from 'firebase/firestore';
import { db } from '@/firebase/config';
import { useAuthStore } from '@/store/authStore';
import type { WorkOrder, WorkOrderStage, WorkOrderStatus } from '@/types';

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
          .map((d) => {
            const data = d.data();
            return {
              id:             d.id,
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
              createdAt:      data['createdAt']?.toDate?.() ?? new Date(),
              updatedAt:      data['updatedAt']?.toDate?.() ?? new Date(),
              archived:       data['archived'] ?? false,
            } as WorkOrder;
          })
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
