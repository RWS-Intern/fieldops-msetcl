import { useCallback, useEffect, useState } from 'react';
import { collection, query, where, getCountFromServer } from 'firebase/firestore';
import { db } from '@/firebase/config';
import type { SurveyStatusFilter } from '@/hooks/useSurveyOversight';
import type { WorkOrderStatus } from '@/types';

/**
 * True collection-wide survey counts per status pill.
 *
 * COLLECTION-WIDE, not a count of what is loaded: the oversight list is
 * paginated at 50, so counting loaded rows would show "50" next to a status
 * that actually has 340 surveys. A wrong number on an oversight screen is
 * worse than no number, which is why these come from Firestore's aggregate
 * count rather than from the rows on screen.
 *
 * getCountFromServer is billed as a single document read per query however
 * many documents match, and never transfers document data — so the whole set
 * of pills costs one read each, not one per survey.
 *
 * ONE-TIME FETCH, NOT A LIVE LISTENER — and that is a platform limit, not a
 * choice or an SDK-version issue. Firestore has no real-time aggregate
 * queries at any version: `onSnapshot` accepts only a DocumentReference or a
 * Query (8 overloads, verified against the installed firebase 10.14.1
 * typings), and getCountFromServer returns a Promise. Hence the explicit
 * `refresh()` below, which the page surfaces as a manual refresh control.
 *
 * Each count is a single equality filter with no ordering, so all of these run
 * on Firestore's automatic single-field indexes — no composite index needed.
 */
export type SurveyStatusCounts = Partial<Record<SurveyStatusFilter, number>>;

export function useSurveyStatusCounts(statuses: readonly WorkOrderStatus[]) {
  const [counts,  setCounts]  = useState<SurveyStatusCounts>({});
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  /** Bumped by refresh() to re-run the fetch. */
  const [nonce,   setNonce]   = useState(0);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  // statuses is a module-level constant at every call site, but join it so a
  // caller passing a fresh array literal doesn't re-fetch on every render.
  const statusKey = statuses.join(',');

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setLoading(true);
      setError(null);
      try {
        const base = collection(db, 'surveyReports');
        const keys: SurveyStatusFilter[] = ['all', ...statuses];

        const snaps = await Promise.all([
          getCountFromServer(query(base)),
          ...statuses.map((s) => getCountFromServer(query(base, where('status', '==', s)))),
        ]);
        if (cancelled) return;

        const next: SurveyStatusCounts = {};
        snaps.forEach((snap, i) => { next[keys[i]] = snap.data().count; });
        setCounts(next);
      } catch (err) {
        if (cancelled) return;
        console.error('[useSurveyStatusCounts] count fetch failed:', err);
        setError(err instanceof Error ? err.message : 'Could not load counts');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  // statusKey stands in for the statuses array — see the note above.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusKey, nonce]);

  return { counts, loading, error, refresh };
}
