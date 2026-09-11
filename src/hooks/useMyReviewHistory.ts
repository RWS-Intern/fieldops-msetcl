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
import { useAuthStore } from '@/store/authStore';
import { mapSurveyReport } from '@/hooks/useSurveyReport';
import type { ApprovalStageResult, SurveyReport } from '@/types';

/** Surveys fetched per round trip, before the client-side "has acted" filter. */
const PAGE_SIZE = 25;

/**
 * How many server pages one load may walk through looking for acted-on
 * stages. Bounds the read cost when a reviewer owns many still-pending
 * stages — without it, a first load could walk the whole result set before
 * finding anything to show.
 */
const MAX_PAGES_PER_LOAD = 5;

/** One acted-on stage, flattened for display. */
export interface ReviewHistoryEntry {
  surveyId:      string;
  workOrderId:   string;
  workOrderCode: string;
  siteCode:      string;
  siteName:      string;
  /** Which stage THIS reviewer held, e.g. "Site Engineer". */
  stageLabel:    string;
  stageIndex:    number;
  decision:      'approved' | 'changes_requested';
  /**
   * Client-supplied and NOT authoritative — see the note on
   * ApprovalStageResult.actedAt. Display only; the trustworthy record is the
   * server timestamp on the matching updates snapshot.
   */
  actedAt:       Date | null;
  reviewNotes:   string | null;
}

/**
 * Every survey stage the current user has personally acted on.
 *
 * QUERY: where('approvalStageOwnerUids', 'array-contains', uid)
 *        + orderBy('updatedAt', 'desc') + limit + startAfter cursor.
 *
 * `approvalStageOwnerUids` is the denormalised union of every stage owner on
 * the chain — added in Phase 1 of the chain build precisely so a past-or-
 * present stage owner keeps read access after their own stage clears. It is
 * therefore the only field that can find a survey whose later stages have
 * moved on to someone else.
 *
 * INDEX: array-contains combined with an orderBy on a DIFFERENT field needs a
 * composite index (surveyReports: approvalStageOwnerUids CONTAINS, updatedAt
 * DESC). A bare array-contains with no ordering would not — the automatic
 * single-field index covers that — but then pages would come back in document-
 * id order, which for a history list is no order at all.
 *
 * WHY THE CLIENT-SIDE FILTER: "have I acted on my stage?" lives inside
 * approvalStages[], an array of maps. Firestore cannot filter on a field
 * inside an array element, so the query returns every survey this user owns a
 * stage on — including ones still waiting on them — and the acted-on test runs
 * here. A page can therefore yield fewer rows than PAGE_SIZE; the loader walks
 * up to MAX_PAGES_PER_LOAD pages rather than handing back an empty list while
 * more documents remain.
 *
 * One-time fetches, not a live listener: this is a browsing/paging history
 * tool, the same call the oversight listing makes for the same reason.
 */
export function useMyReviewHistory() {
  const { currentUser } = useAuthStore();
  const uid = currentUser?.uid ?? null;

  const [entries,     setEntries]     = useState<ReviewHistoryEntry[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore,     setHasMore]     = useState(false);
  const [error,       setError]       = useState<string | null>(null);
  const [cursor,      setCursor]      = useState<QueryDocumentSnapshot<DocumentData> | null>(null);

  /**
   * Flattens one survey into at most one entry — the current user's own stage.
   * Returns null when they hold no stage on it, or hold one they haven't acted
   * on yet (that survey belongs in Approvals, not history).
   *
   * If the same person owns more than one stage on a chain, the LAST acted-on
   * one wins: that's their most recent decision on this survey, which is what
   * a history list should show.
   */
  const toEntry = useCallback((survey: SurveyReport): ReviewHistoryEntry | null => {
    if (!uid) return null;

    // A direct loop, not forEach: an assignment inside a callback defeats
    // TypeScript's control-flow narrowing, leaving `match` as `never` below.
    let stage: ApprovalStageResult | null = null;
    let stageIndex = -1;
    for (let i = 0; i < survey.approvalStages.length; i++) {
      const candidate = survey.approvalStages[i];
      if (candidate.ownerUid === uid && candidate.status !== 'pending') {
        stage = candidate;
        stageIndex = i;
      }
    }
    if (!stage) return null;
    return {
      surveyId:      survey.id,
      workOrderId:   survey.workOrderId,
      workOrderCode: survey.workOrderCode,
      siteCode:      survey.siteCode,
      siteName:      survey.siteName,
      stageLabel:    stage.stageLabel,
      stageIndex,
      decision:      stage.status === 'approved' ? 'approved' : 'changes_requested',
      actedAt:       stage.actedAt,
      reviewNotes:   stage.reviewNotes,
    };
  }, [uid]);

  const fetchPage = useCallback(
    (after: QueryDocumentSnapshot<DocumentData> | null) => {
      const base = query(
        collection(db, 'surveyReports'),
        where('approvalStageOwnerUids', 'array-contains', uid),
        orderBy('updatedAt', 'desc'),
      );
      return getDocs(after ? query(base, startAfter(after), limit(PAGE_SIZE)) : query(base, limit(PAGE_SIZE)));
    },
    [uid],
  );

  /**
   * Walks forward from `after` until it has at least one displayable entry or
   * runs out of pages/budget. Returns what it found plus the new cursor.
   */
  const collectFrom = useCallback(
    async (after: QueryDocumentSnapshot<DocumentData> | null) => {
      const collected: ReviewHistoryEntry[] = [];
      let next = after;
      let more = false;

      for (let page = 0; page < MAX_PAGES_PER_LOAD; page++) {
        const snap = await fetchPage(next);
        next = snap.docs[snap.docs.length - 1] ?? next;
        more = snap.docs.length === PAGE_SIZE;

        for (const d of snap.docs) {
          const entry = toEntry(mapSurveyReport(d.id, d.data()));
          if (entry) collected.push(entry);
        }

        if (collected.length > 0 || !more) break;
      }

      return { collected, cursor: next, hasMore: more };
    },
    [fetchPage, toEntry],
  );

  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!uid) { setEntries([]); setLoading(false); return; }

      setLoading(true);
      setError(null);
      setEntries([]);
      setCursor(null);
      setHasMore(false);

      try {
        const result = await collectFrom(null);
        if (cancelled) return;
        setEntries(result.collected);
        setCursor(result.cursor);
        setHasMore(result.hasMore);
      } catch (err) {
        if (cancelled) return;
        console.error('[useMyReviewHistory] fetch failed:', err);
        setError(err instanceof Error ? err.message : 'Could not load review history.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [uid, collectFrom]);

  async function loadMore() {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const result = await collectFrom(cursor);
      setEntries((prev) => [...prev, ...result.collected]);
      setCursor(result.cursor);
      setHasMore(result.hasMore);
    } catch (err) {
      console.error('[useMyReviewHistory] loadMore failed:', err);
      setError(err instanceof Error ? err.message : 'Could not load more.');
    } finally {
      setLoadingMore(false);
    }
  }

  return { entries, loading, loadingMore, hasMore, error, loadMore };
}
