import { useEffect, useState } from 'react';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '@/firebase/config';
import { mapSurveyReport } from '@/hooks/useSurveyReport';
import { findMatchingSites, normaliseSearchTerm } from '@/lib/siteSearch';
import { useSiteStore } from '@/store/siteStore';
import type { SurveyReport } from '@/types';

/** Firestore's hard cap on values in an `in` filter. */
const IN_CHUNK_SIZE = 30;

/**
 * Two-step substation search over surveys, independent of the oversight
 * list's pagination.
 *
 * WHY NOT filter the loaded rows: the oversight list is paginated at 50, so a
 * client-side filter over what happens to be loaded would silently return
 * nothing for a real site sitting on page 3. That is a wrong answer presented
 * as an empty one, which on an oversight screen is worse than no search.
 *
 * So instead:
 *   1. Resolve the term against siteStore — every non-archived site, already
 *      loaded once per admin/viewer session — using the SAME predicate the
 *      header search uses (src/lib/siteSearch.ts).
 *   2. Query surveyReports directly for those site ids. This is a real,
 *      unpaginated query against the live collection, so it finds every
 *      survey at a matched site no matter what the browse list last loaded.
 *
 * `where('siteId','in',…)` with NO orderBy runs on Firestore's automatic
 * single-field index — sorting is client-side, deliberately, because adding
 * orderBy('updatedAt') alongside the `in` filter WOULD require a new
 * composite index (siteId ASC, updatedAt DESC). No index change is needed for
 * this feature.
 *
 * Status filtering is likewise applied by the CALLER in JS rather than as a
 * second `where` clause: the result set is only the surveys at a handful of
 * matched sites, so it costs nothing, and it avoids a
 * siteId + status composite index too.
 */
export interface SurveySearchResult {
  /** Surveys at every matching site, newest-updated first. */
  results:      SurveyReport[];
  /** How many sites the term matched — useful when it matched none. */
  matchedSites: number;
  loading:      boolean;
  error:        string | null;
  /** True when a term is present, i.e. the page should be in search mode. */
  active:       boolean;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export function useSurveySearch(rawTerm: string): SurveySearchResult {
  const { sites } = useSiteStore();
  const term = normaliseSearchTerm(rawTerm);

  const [results,      setResults]      = useState<SurveyReport[]>([]);
  const [matchedSites, setMatchedSites] = useState(0);
  const [loading,      setLoading]      = useState(false);
  const [error,        setError]        = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    // The async IIFE keeps the inactive-term reset off the effect body — same
    // pattern as useSurveyUpdates.ts / useSiteLifecycle.ts.
    (async () => {
      if (!term) {
        setResults([]);
        setMatchedSites(0);
        setLoading(false);
        setError(null);
        return;
      }

      const siteIds = findMatchingSites(sites, term).map((s) => s.id);
      setMatchedSites(siteIds.length);

      if (siteIds.length === 0) {
        setResults([]);
        setLoading(false);
        setError(null);
        return;
      }

      setLoading(true);
      setError(null);
      try {
        // Chunked at 30 and merged — a broad term (a city name, say) can
        // easily match more sites than one `in` filter accepts.
        const snaps = await Promise.all(
          chunk(siteIds, IN_CHUNK_SIZE).map((ids) =>
            getDocs(query(collection(db, 'surveyReports'), where('siteId', 'in', ids))),
          ),
        );
        if (cancelled) return;

        const merged = snaps
          .flatMap((snap) => snap.docs.map((d) => mapSurveyReport(d.id, d.data())))
          .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

        setResults(merged);
      } catch (err) {
        if (cancelled) return;
        console.error('[useSurveySearch] search failed:', err);
        setError(err instanceof Error ? err.message : 'Search failed');
        setResults([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [term, sites]);

  return { results, matchedSites, loading, error, active: term.length > 0 };
}
