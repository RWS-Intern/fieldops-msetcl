import { useEffect, useState } from 'react';
import { collection, query, orderBy, limit, onSnapshot } from 'firebase/firestore';
import { db } from '@/firebase/config';
import { mapSurveyReport } from '@/hooks/useSurveyReport';
import type { SurveyReport } from '@/types';

/**
 * Real-time listener for every survey report, ordered most-recently-updated
 * first. The org-wide counterpart to useAssignedWorkOrders, and the survey
 * equivalent of useAllSiteTasks — same shape, same 1 000-document cap.
 *
 * Distinct from useSurveyOversight, which pages 50 at a time: that one is a
 * browsing tool, whereas this feeds Reports, where a partial page would show
 * a wrong TOTAL rather than merely a short list.
 *
 * Reuses mapSurveyReport rather than mapping inline, so this can never drift
 * from the other readers of the collection.
 *
 * No `enabled` flag, unlike useAllSiteTasks: the only caller is the Reports
 * page, which is already gated to admin and viewer, so there is no session
 * that mounts this and should not be subscribed.
 */
export function useAllSurveys() {
  const [surveys, setSurveys] = useState<SurveyReport[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(
      collection(db, 'surveyReports'),
      orderBy('updatedAt', 'desc'),
      limit(1000),
    );

    const unsubscribe = onSnapshot(
      q,
      (snap) => {
        setSurveys(snap.docs.map((d) => mapSurveyReport(d.id, d.data())));
        setLoading(false);
      },
      (err) => {
        console.error('[useAllSurveys] listener error:', err);
        setLoading(false);
      },
    );

    return () => unsubscribe();
  }, []);

  return { surveys, loading };
}
