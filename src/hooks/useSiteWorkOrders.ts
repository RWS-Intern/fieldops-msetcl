import { useEffect, useState } from 'react';
import {
  collection,
  query,
  where,
  onSnapshot,
} from 'firebase/firestore';
import { db } from '@/firebase/config';
import { mapWorkOrder } from '@/hooks/useAssignedWorkOrders';
import type { WorkOrder } from '@/types';

/**
 * Real-time listener for a single site's work order history (all stages,
 * newest first) — the site detail drawer's Work Orders section.
 *
 * Query: where('siteId', '==', siteId) — single-field equality, no
 * composite index required. Sorting is done client-side, same pattern as
 * useAssignedWorkOrders.
 */
export function useSiteWorkOrders(siteId: string | null | undefined) {
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // unsubscribe is assigned from inside an async IIFE purely to route the
    // site-less reset through a microtask rather than a bare synchronous
    // setState call — no real async work happens before it runs (same
    // pattern as useSurveyUpdates.ts).
    let unsubscribe: (() => void) | undefined;

    (async () => {
      if (!siteId) {
        setWorkOrders([]);
        setLoading(false);
        return;
      }

      setLoading(true);

      const q = query(
        collection(db, 'workOrders'),
        where('siteId', '==', siteId),
      );

      unsubscribe = onSnapshot(
        q,
        (snap) => {
          const result = snap.docs
            .map((d) => mapWorkOrder(d.id, d.data()))
            .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
          setWorkOrders(result);
          setLoading(false);
        },
        (err) => {
          console.error('[useSiteWorkOrders] listener error:', err);
          setLoading(false);
        },
      );
    })();

    return () => unsubscribe?.();
  }, [siteId]);

  return { workOrders, loading };
}
