import { useCallback, useEffect, useState } from 'react';
import {
  collection,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  getDocs,
  type QueryDocumentSnapshot,
  type DocumentData,
} from 'firebase/firestore';
import { db } from '@/firebase/config';
import { mapSurveyReport } from '@/hooks/useSurveyReport';
import type { SurveyReport, WorkOrderStatus } from '@/types';

export type SurveyStatusFilter = 'all' | WorkOrderStatus;

const PAGE_SIZE = 50;

/**
 * Admin survey oversight listing — one-time fetches (not a live listener;
 * this is a browsing/paging tool, not a queue that needs to react instantly
 * to new submissions), refetched from the start whenever the status filter
 * changes.
 *
 * Both branches are paginated identically — limit(50) with a startAfter
 * cursor for "Load more" — since any single status (e.g. "Approved") can
 * still accumulate to cover most of the collection over the contract's
 * life, not just the unfiltered 'all' view.
 *
 * A specific status: where('status','==',filter) + orderBy('updatedAt','desc')
 * + limit — needs the composite index added to firestore.indexes.json
 * (surveyReports: status ASC, updatedAt DESC); limit/startAfter don't add
 * any further index requirement beyond what the where+orderBy already need.
 *
 * 'all': orderBy('updatedAt','desc') + limit — no where clause, so no
 * composite index needed (the automatic single-field index covers it).
 */
export function useSurveyOversight(filter: SurveyStatusFilter) {
  const [surveys, setSurveys]         = useState<SurveyReport[]>([]);
  const [loading, setLoading]         = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore]         = useState(false);
  const [cursor, setCursor]           = useState<QueryDocumentSnapshot<DocumentData> | null>(null);

  const fetchPage = useCallback(
    (after: QueryDocumentSnapshot<DocumentData> | null) => {
      const base = collection(db, 'surveyReports');
      const orderConstraints = filter === 'all'
        ? [orderBy('updatedAt', 'desc')]
        : [where('status', '==', filter), orderBy('updatedAt', 'desc')];
      return getDocs(
        after
          ? query(base, ...orderConstraints, startAfter(after), limit(PAGE_SIZE))
          : query(base, ...orderConstraints, limit(PAGE_SIZE)),
      );
    },
    [filter],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setSurveys([]);
    setCursor(null);
    setHasMore(false);

    (async () => {
      try {
        const snap = await fetchPage(null);
        if (cancelled) return;
        setSurveys(snap.docs.map((d) => mapSurveyReport(d.id, d.data())));
        setCursor(snap.docs[snap.docs.length - 1] ?? null);
        setHasMore(snap.docs.length === PAGE_SIZE);
      } catch (err) {
        console.error('[useSurveyOversight] fetch failed:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [filter, fetchPage]);

  async function loadMore() {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const snap = await fetchPage(cursor);
      setSurveys((prev) => [...prev, ...snap.docs.map((d) => mapSurveyReport(d.id, d.data()))]);
      setCursor(snap.docs[snap.docs.length - 1] ?? null);
      setHasMore(snap.docs.length === PAGE_SIZE);
    } catch (err) {
      console.error('[useSurveyOversight] loadMore failed:', err);
    } finally {
      setLoadingMore(false);
    }
  }

  return { surveys, loading, loadingMore, hasMore, loadMore };
}
