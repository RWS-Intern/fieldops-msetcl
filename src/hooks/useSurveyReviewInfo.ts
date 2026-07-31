import { useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/firebase/config';

export interface SurveyReviewInfo {
  reviewedByName: string | null;
  reviewedAt: Date | null;
}

/**
 * One-time fetch of a survey's review metadata, keyed by workOrderId — the
 * paired surveyReports document shares the work order's ID (see
 * createWorkOrder in useWorkOrderActions.ts), so this is a direct getDoc,
 * not a query. Used by the site detail drawer's Work Orders history list,
 * which otherwise only has the WorkOrder document itself (no
 * reviewedBy/reviewedAt fields — those live on SurveyReport).
 */
export function useSurveyReviewInfo(workOrderId: string | null | undefined) {
  const [info, setInfo] = useState<SurveyReviewInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!workOrderId) {
        setInfo(null);
        setLoading(false);
        return;
      }

      setLoading(true);
      try {
        const snap = await getDoc(doc(db, 'surveyReports', workOrderId));
        if (cancelled) return;
        if (snap.exists()) {
          const data = snap.data();
          setInfo({
            reviewedByName: data['reviewedByName'] ?? null,
            reviewedAt:     data['reviewedAt']?.toDate?.() ?? null,
          });
        } else {
          setInfo(null);
        }
        setLoading(false);
      } catch (err) {
        console.error('[useSurveyReviewInfo] fetch failed:', err);
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [workOrderId]);

  return { info, loading };
}
