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
  type QuerySnapshot,
  type DocumentData,
} from 'firebase/firestore';
import { db } from '@/firebase/config';
import { useAuthStore } from '@/store/authStore';
import { mapSurveyReport } from '@/hooks/useSurveyReport';
import { toReviewHistoryEntry } from '@/hooks/useMyReviewHistory';
import type { ReviewHistoryEntry } from '@/hooks/useMyReviewHistory';

/** Surveys per round trip. */
const PAGE_SIZE = 25;
/**
 * Hard cap on pages per load, so one dashboard render can never read an
 * unbounded number of survey documents — 4 x 25 = 100 reads, worst case.
 * Reached only by a reviewer with more than 100 surveys touched inside the
 * window, which would be an extraordinary week.
 */
const MAX_PAGES = 4;

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
/**
 * Slack on the paging cut-off, NOT on the week itself.
 *
 * The stopping rule leans on `actedAt <= updatedAt`. That holds by
 * construction — reviewSurvey writes `actedAt: new Date()` (a client clock, as
 * Firestore rejects serverTimestamp() inside an array element) in the same
 * batch as `updatedAt: serverTimestamp()`, and every later write to the survey
 * pushes `updatedAt` further forward while leaving earlier `actedAt` values
 * alone. The one way it can invert is a device clock running AHEAD of the
 * server, which would place `actedAt` past `updatedAt` and let paging stop one
 * survey too early. A day of slack costs at most one extra page and makes that
 * irrelevant for any plausible skew.
 */
const PAGING_SKEW_MS = 24 * 60 * 60 * 1000;

/**
 * Roles whose dashboard reads this. Field and viewer sessions subscribe to
 * nothing survey-related for this widget — a viewer could read it (isViewer
 * short-circuits the list rule) but has no use for a personal review count,
 * and a field expert owns no stage so would always get an empty result.
 */
const REVIEWING_ROLES: readonly string[] = ['approver', 'admin'];

const EMPTY: ReviewHistoryEntry[] = [];

/**
 * The current user's own survey review actions from the last seven days —
 * the approver dashboard's "Approved This Week", "Sent Back This Week" and the
 * survey half of "Recently Reviewed".
 *
 * QUERY: where('approvalStageOwnerUids', 'array-contains', uid)
 *        + orderBy('updatedAt', 'desc') — the composite index that already
 *        exists for the review-history page.
 *
 * WHY NOT `reviewedBy`: Firestore authorises a list query from the QUERY'S OWN
 * CONSTRAINTS, not from which documents happen to match. surveyReports' list
 * rule tests assignedTo / approverUid / approvalStageOwnerUids; `reviewedBy` is
 * none of them, so that query is refused outright for a non-admin approver —
 * proven in tests/rules/reviewedSurveysQuery.test.mjs, which also shows it
 * refused for a field session whose result set would have been empty.
 *
 * WHY PER-STAGE: `reviewedBy` holds only the MOST RECENT reviewer. On a
 * three-stage chain a Level 1 approver's own action vanishes from their counts
 * the moment Level 2 acts. Each survey is instead flattened to this user's own
 * stage via toReviewHistoryEntry — the same definition the history page uses,
 * so the dashboard and the page its "View all" opens cannot disagree.
 *
 * One-time fetches, not a listener: these are weekly counters, and the history
 * page this mirrors made the same call for the same reason. The trade is that
 * the figures settle on load rather than live-updating after a review — see the
 * note in the report.
 */
export function useReviewedSurveys() {
  const { currentUser } = useAuthStore();
  const uid  = currentUser?.uid  ?? null;
  const role = currentUser?.role ?? null;
  const enabled = !!uid && !!role && REVIEWING_ROLES.includes(role);

  const [entries, setEntries] = useState<ReviewHistoryEntry[]>(EMPTY);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (forUid: string) => {
    const cutoff = new Date(Date.now() - WEEK_MS);
    const stopBefore = new Date(cutoff.getTime() - PAGING_SKEW_MS);

    const base = query(
      collection(db, 'surveyReports'),
      where('approvalStageOwnerUids', 'array-contains', forUid),
      orderBy('updatedAt', 'desc'),
    );

    const found: ReviewHistoryEntry[] = [];
    let after: QueryDocumentSnapshot<DocumentData> | null = null;

    for (let page = 0; page < MAX_PAGES; page++) {
      // Annotated: `after` is assigned from snap.docs below, so inference would
      // otherwise chase its own tail and land on `any`.
      const snap: QuerySnapshot<DocumentData> = await getDocs(
        after ? query(base, startAfter(after), limit(PAGE_SIZE)) : query(base, limit(PAGE_SIZE)),
      );
      if (snap.empty) break;

      let reachedCutoff = false;
      for (const d of snap.docs) {
        const survey = mapSurveyReport(d.id, d.data());
        // Ordered by updatedAt desc, so once a survey is older than the
        // cut-off every survey after it is too — nothing later can hold an
        // in-window action.
        if (survey.updatedAt && survey.updatedAt < stopBefore) { reachedCutoff = true; break; }

        const entry = toReviewHistoryEntry(survey, forUid);
        if (entry?.actedAt && entry.actedAt >= cutoff) found.push(entry);
      }

      if (reachedCutoff || snap.docs.length < PAGE_SIZE) break;
      after = snap.docs[snap.docs.length - 1];
    }

    return found;
  }, []);

  useEffect(() => {
    if (!enabled || !uid) return;

    let cancelled = false;
    (async () => {
      try {
        const found = await load(uid);
        if (cancelled) return;
        setEntries(found);
        setError(null);
        setLoadedFor(uid);
      } catch (err) {
        if (cancelled) return;
        console.error('[useReviewedSurveys] load failed:', err);
        // EXPLICIT error + empty, never a silent zero: a review dashboard
        // reporting "0 approved this week" when the read failed is worse than
        // one that says it could not load.
        setEntries(EMPTY);
        setError(err instanceof Error ? err.message : 'Could not load your recent reviews.');
        setLoadedFor(uid);
      }
    })();

    return () => { cancelled = true; };
  }, [enabled, uid, load]);

  // Derived, so a disabled role or a half-loaded session can never read a
  // previous user's results, and the effect body stays free of setState.
  const ready   = enabled && loadedFor === uid;
  const visible = ready ? entries : EMPTY;

  return {
    /** This user's own review actions in the last 7 days, newest survey first. */
    entries:          visible,
    approvedThisWeek: visible.filter((e) => e.decision === 'approved').length,
    sentBackThisWeek: visible.filter((e) => e.decision === 'changes_requested').length,
    loading:          enabled && !ready,
    error:            ready ? error : null,
  };
}
