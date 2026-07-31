import { useEffect, useState } from 'react';
import {
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
} from 'firebase/firestore';
import { db } from '@/firebase/config';
import { useAuthStore } from '@/store/authStore';
import { mapSurveyReport } from '@/hooks/useSurveyReport';
import type { SurveyReport } from '@/types';

/**
 * Real-time listener for the current user's survey approval queue.
 *
 * Query: approverUid == uid AND status == 'pending_approval', ordered by
 * updatedAt desc. Uses the composite index already deployed in task 1b
 * (firestore.indexes.json: surveyReports — approverUid ASC, status ASC,
 * updatedAt DESC) — no new index required. The approverUid equality is also
 * what satisfies the deployed `list` rule on surveyReports.
 */
export function useSurveyApprovalQueue() {
  const { currentUser } = useAuthStore();
  const [queue, setQueue] = useState<SurveyReport[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!currentUser) {
      setQueue([]);
      setLoading(false);
      return;
    }

    setLoading(true);

    const q = query(
      collection(db, 'surveyReports'),
      where('approverUid', '==', currentUser.uid),
      where('status', '==', 'pending_approval'),
      orderBy('updatedAt', 'desc'),
    );

    const unsubscribe = onSnapshot(
      q,
      (snap) => {
        setQueue(snap.docs.map((d) => mapSurveyReport(d.id, d.data())));
        setLoading(false);
      },
      (err) => {
        console.error('[useSurveyApprovalQueue] listener error:', err);
        setLoading(false);
      },
    );

    return () => unsubscribe();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.uid]);

  return { queue, loading };
}
