import { useEffect, useState } from 'react';
import {
  collection,
  query,
  where,
  onSnapshot,
} from 'firebase/firestore';
import { db } from '@/firebase/config';
import { useAuthStore } from '@/store/authStore';
import { mapSurveyReport } from '@/hooks/useSurveyReport';
import type { SurveyReport } from '@/types';

/**
 * Real-time listener for survey reports the current user has personally
 * reviewed (approved or sent back) — used for the approver dashboard's
 * "this week" stats and "Recently Reviewed" list.
 *
 * Query: where('reviewedBy', '==', uid) — single-field equality, no
 * composite index required (same pattern as useReviewedSiteTasks).
 */
export function useReviewedSurveys() {
  const { currentUser } = useAuthStore();
  const [surveys, setSurveys] = useState<SurveyReport[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!currentUser) {
      setSurveys([]);
      setLoading(false);
      return;
    }

    setLoading(true);

    const q = query(
      collection(db, 'surveyReports'),
      where('reviewedBy', '==', currentUser.uid),
    );

    const unsubscribe = onSnapshot(
      q,
      (snap) => {
        setSurveys(snap.docs.map((d) => mapSurveyReport(d.id, d.data())));
        setLoading(false);
      },
      (err) => {
        console.error('[useReviewedSurveys] listener error:', err);
        setLoading(false);
      },
    );

    return () => unsubscribe();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.uid]);

  return { surveys, loading };
}
