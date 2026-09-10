import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, X, RefreshCw } from 'lucide-react';
import { useSurveyOversight } from '@/hooks/useSurveyOversight';
import { useSurveySearch } from '@/hooks/useSurveySearch';
import { useSurveyStatusCounts } from '@/hooks/useSurveyStatusCounts';
import { Button }   from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type { SurveyStatusFilter } from '@/hooks/useSurveyOversight';
import type { SurveyReport, WorkOrderStatus } from '@/types';

// ─── Constants ────────────────────────────────────────────────────────────────

const SEARCH_DEBOUNCE_MS = 250;

const STATUS_FILTERS: { key: SurveyStatusFilter; label: string }[] = [
  { key: 'all',               label: 'All' },
  { key: 'open',               label: 'Open' },
  { key: 'in_progress',        label: 'In Progress' },
  { key: 'pending_approval',   label: 'Pending Approval' },
  { key: 'changes_requested',  label: 'Changes Requested' },
  { key: 'approved',           label: 'Approved' },
];

/**
 * The statuses that get their own aggregate count — the pill set minus 'all',
 * which is counted with an unfiltered query. Derived from STATUS_FILTERS so a
 * pill can never be added without gaining a count.
 *
 * Note 'closed' is deliberately absent from the pills (a survey never reaches
 * it today), so no count is fetched for it either.
 */
const COUNTED_STATUSES: readonly WorkOrderStatus[] = STATUS_FILTERS
  .map((f) => f.key)
  .filter((k): k is WorkOrderStatus => k !== 'all');

const STATUS_BADGE: Record<WorkOrderStatus, string> = {
  open:              'bg-gray-100 text-gray-600',
  in_progress:       'bg-amber-50 text-amber-700',
  pending_approval:  'bg-violet-50 text-violet-700',
  changes_requested: 'bg-orange-50 text-orange-700',
  approved:          'bg-green-50 text-green-700',
  closed:            'bg-gray-200 text-gray-600',
};

const STATUS_LABEL: Record<WorkOrderStatus, string> = {
  open:              'Open',
  in_progress:       'In Progress',
  pending_approval:  'Pending Approval',
  changes_requested: 'Changes Requested',
  approved:          'Approved',
  closed:            'Closed',
};

function formatDate(d: Date): string {
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ─── Row ──────────────────────────────────────────────────────────────────────
//
// siteName/workOrderCode are denormalised directly onto SurveyReport (see the
// type comment) specifically so a list of many rows like this one never
// needs a per-row getDoc.

/**
 * Where this survey sits in its approval chain, for the row's stage pill.
 * Sourced from the document's OWN approvalStages[currentStageIndex] — its
 * denormalised stageLabel, so a survey renders with the wording it was created
 * under rather than this build's.
 *
 * Returns null once the chain is complete: the status badge already reads
 * "Approved" then, and a stage pill would be noise. Also null for a document
 * that predates the chain (empty array), which simply shows no pill.
 */
function currentStageSummary(survey: SurveyReport): { label: string; state: string } | null {
  const stages = survey.approvalStages;
  const index  = survey.currentStageIndex;
  if (stages.length === 0 || index < 0 || index >= stages.length) return null;

  const label = stages[index].stageLabel;
  // Derived from the DOCUMENT's status, not the stage entry's own — after an
  // engineer resubmits a sent-back survey the entry still reads
  // 'changes_requested' (they cannot rewrite the approval record) while the
  // document is back to pending_approval and genuinely awaiting this stage.
  const state =
    survey.status === 'changes_requested' ? 'changes requested' :
    survey.status === 'pending_approval'  ? 'pending' :
    'not yet submitted';

  return { label, state };
}

function SurveyOversightRow({ survey, onOpen }: { survey: SurveyReport; onOpen: () => void }) {
  const stage = currentStageSummary(survey);

  return (
    <div
      className="border rounded-lg p-3 flex flex-col gap-1.5 cursor-pointer hover:border-blue-300 hover:shadow-sm transition-all"
      onClick={onOpen}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-bold text-gray-900 font-mono leading-snug">{survey.siteCode}</p>
          {survey.siteName && (
            <p className="text-sm font-semibold text-gray-800 leading-snug">{survey.siteName}</p>
          )}
          {survey.workOrderCode && (
            <p className="text-xs text-gray-400 font-mono">{survey.workOrderCode}</p>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className={cn('text-xs font-medium px-2 py-0.5 rounded-full', STATUS_BADGE[survey.status])}>
            {STATUS_LABEL[survey.status]}
          </span>
          {/* Which of the three stages the survey is sitting at — the status
              badge alone can't distinguish "pending approval at stage 1" from
              "pending approval at stage 3". */}
          {stage && (
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600">
              {stage.label} — {stage.state}
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-gray-500">
        <span>Engineer: {survey.assignedToName ?? '—'}</span>
        {/* Names the stage rather than a bare "Approver", so it is clear WHICH
            reviewer this is — approverName tracks the live stage owner. */}
        <span>{stage ? stage.label : 'Approver'}: {survey.approverName ?? '—'}</span>
        {survey.submittedAt && <span>Submitted {formatDate(survey.submittedAt)}</span>}
        {survey.status === 'approved' && survey.reviewedAt && (
          <span>Approved {formatDate(survey.reviewedAt)}</span>
        )}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
//
// Admin-only oversight across every survey work order, any site, any status
// — the "who did it, who approved it" view for surveys that have already
// left the approver's own queue (which only ever shows pending_approval).
// Tapping a row reuses the existing approver review screen (SurveyPreview,
// read-only, with its History section) — no second viewer.

export function AdminSurveyOversightPage() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<SurveyStatusFilter>('all');

  // Browse mode — the existing paginated query, untouched.
  const { surveys, loading, loadingMore, hasMore, loadMore } = useSurveyOversight(filter);

  // Search mode — resolves the term against sites, then queries surveyReports
  // by site id. Completely separate from the paginated path above; the two
  // never feed each other, so pagination state can't limit what search finds.
  const [searchInput, setSearchInput] = useState('');
  const [searchTerm,  setSearchTerm]  = useState('');
  useEffect(() => {
    const t = setTimeout(() => setSearchTerm(searchInput), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [searchInput]);
  const search = useSurveySearch(searchTerm);

  // True collection-wide counts for the pills.
  const { counts, loading: countsLoading, refresh: refreshCounts } =
    useSurveyStatusCounts(COUNTED_STATUSES);

  // The selected pill narrows search results in JS rather than in Firestore —
  // the set is small (surveys at a few matched sites) and it keeps the search
  // query to a single `in` filter, needing no composite index.
  const searchResults = filter === 'all'
    ? search.results
    : search.results.filter((s) => s.status === filter);

  // One list, two sources.
  const rows      = search.active ? searchResults  : surveys;
  const isLoading = search.active ? search.loading : loading;

  function clearSearch() {
    setSearchInput('');
    setSearchTerm('');
  }

  return (
    <div className="flex flex-col gap-4 max-w-2xl mx-auto pb-24">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-xl font-bold text-gray-900">Surveys</h2>
        <button
          type="button"
          onClick={refreshCounts}
          disabled={countsLoading}
          title="Refresh counts"
          className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-gray-400 transition-colors hover:text-brand-blue disabled:opacity-50"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', countsLoading && 'animate-spin')} />
          Counts
        </button>
      </div>

      {/* Substation search. Matches site code / name / city — the same rule as
          the header's global search (src/lib/siteSearch.ts) — then finds every
          survey at those sites, regardless of the browse list's page. */}
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <input
          type="search"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search by substation code, name or city…"
          aria-label="Search surveys by substation code, name or city"
          className="h-10 w-full rounded-lg border border-gray-200 bg-white pl-9 pr-9 text-sm placeholder:text-gray-400 focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/20"
        />
        {searchInput && (
          <button
            type="button"
            onClick={clearSearch}
            aria-label="Clear search"
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {STATUS_FILTERS.map(({ key, label }) => {
          // In search mode the pill shows how many of THESE results carry that
          // status; browsing, it shows the true collection-wide total. Showing
          // the collection total while search is narrowing the list would
          // contradict the row count right below it.
          const count = search.active
            ? (key === 'all'
                ? search.results.length
                : search.results.filter((s) => s.status === key).length)
            : counts[key];
          return (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className={cn(
                'text-sm font-medium px-3 py-1.5 rounded-full border transition-colors',
                filter === key
                  ? 'bg-brand-blue text-white border-brand-blue'
                  : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300 hover:bg-gray-50',
              )}
            >
              {label}
              {count !== undefined && (
                <span className={cn('ml-1.5', filter === key ? 'opacity-80' : 'text-gray-400')}>
                  ({count})
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Result line — only while searching. */}
      {search.active && !search.loading && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-gray-500">
          <span>
            {searchResults.length} result{searchResults.length !== 1 ? 's' : ''} for
            {' '}&ldquo;{searchTerm.trim()}&rdquo;
            {search.matchedSites > 0 && (
              <span className="text-gray-400">
                {' '}across {search.matchedSites} substation{search.matchedSites !== 1 ? 's' : ''}
              </span>
            )}
          </span>
          <button
            type="button"
            onClick={clearSearch}
            className="font-medium text-brand-blue hover:underline"
          >
            Clear
          </button>
        </div>
      )}

      {search.error && (
        <p className="text-sm text-brand-red">Search failed: {search.error}</p>
      )}

      {isLoading ? (
        <div className="flex flex-col gap-2">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-lg" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="py-16 text-center">
          <p className="text-sm text-gray-400">
            {search.active
              ? search.matchedSites === 0
                ? `No substation matches “${searchTerm.trim()}”.`
                : 'No surveys match this filter at the matching substations.'
              : 'No surveys match this filter.'}
          </p>
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-2">
            {rows.map((survey) => (
              <SurveyOversightRow
                key={survey.id}
                survey={survey}
                onOpen={() => navigate(`/survey-record/${survey.workOrderId}`)}
              />
            ))}
          </div>

          {/* Load more belongs to browse mode only — search is unpaginated and
              already returns everything at the matched sites. */}
          {!search.active && hasMore && (
            <Button
              type="button"
              variant="outline"
              onClick={loadMore}
              disabled={loadingMore}
              className="self-center"
            >
              {loadingMore ? 'Loading…' : 'Load more'}
            </Button>
          )}
        </>
      )}
    </div>
  );
}
