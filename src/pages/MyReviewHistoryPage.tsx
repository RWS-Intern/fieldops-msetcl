import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ChevronRight } from 'lucide-react';
import { useMyReviewHistory } from '@/hooks/useMyReviewHistory';
import { Button }   from '@/components/ui/button';
import { Input }    from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { FilterPills } from '@/components/ui/filter-pills';
import { normaliseSearchTerm } from '@/lib/siteSearch';
import { cn } from '@/lib/utils';
import type { ReviewHistoryEntry } from '@/hooks/useMyReviewHistory';

/**
 * Decision filter. The two decision keys are ReviewHistoryEntry.decision's own
 * values, so a new decision could never silently fall through the filter
 * without failing to typecheck here first.
 */
type DecisionFilter = 'all' | ReviewHistoryEntry['decision'];

// "Changes Requested", NOT "Sent Back": every other screen in this app uses
// the former for this exact state (TasksPage's status pills, the row badge
// below, ApproverSurveyReviewPage). A second term for one state would read as
// a second state.
const DECISION_PILLS: readonly { key: DecisionFilter; label: string }[] = [
  { key: 'all',                label: 'All'               },
  { key: 'approved',           label: 'Approved'          },
  { key: 'changes_requested',  label: 'Changes Requested' },
];

/**
 * Does this entry match what the reviewer typed?
 *
 * Matches exactly the three identifiers the row RENDERS — site code,
 * substation name, work order code — so a hit is always explicable by looking
 * at the row. Stage label and review notes are deliberately excluded: both are
 * prose, and matching them would return rows whose visible identifiers bear no
 * resemblance to the search.
 *
 * `term` must already be normalised; use normaliseSearchTerm().
 */
function matchesHistoryEntry(entry: ReviewHistoryEntry, term: string): boolean {
  if (!term) return true;
  return [entry.siteCode, entry.siteName, entry.workOrderCode]
    .some((field) => (field ?? '').toLowerCase().includes(term));
}

// Decision colours match the dashboard's Recently Reviewed stripe and
// taskUtils.ts: approved → #2A9D8F (green), changes_requested → #F97316.

function formatActedAt(date: Date | null): string {
  if (!date) return 'Date not recorded';
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function HistoryRow({ entry, onOpen }: { entry: ReviewHistoryEntry; onOpen: () => void }) {
  const approved = entry.decision === 'approved';

  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full rounded-lg border border-gray-100 bg-white text-left shadow-sm overflow-hidden hover:border-blue-300 hover:shadow-sm transition-all"
    >
      <div className="w-1.5 shrink-0" style={{ backgroundColor: approved ? '#2A9D8F' : '#F97316' }} />

      <div className="flex-1 min-w-0 p-3">
        <div className="mb-0.5 flex items-start justify-between gap-2">
          <span className="truncate font-mono text-sm font-bold leading-snug text-gray-900">
            {entry.siteCode || '—'}
          </span>
          <span className={cn(
            'shrink-0 rounded-full px-2 py-0.5 text-xs font-medium',
            approved ? 'bg-green-50 text-green-700' : 'bg-orange-50 text-orange-700',
          )}>
            {approved ? 'Approved' : 'Changes Requested'}
          </span>
        </div>

        {entry.siteName && (
          <p className="truncate text-sm font-semibold leading-snug text-gray-800">{entry.siteName}</p>
        )}

        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-gray-400">
          {entry.workOrderCode && <span className="font-mono">{entry.workOrderCode}</span>}
          {entry.workOrderCode && <span aria-hidden>·</span>}
          {/* Which stage this reviewer personally held on the chain. */}
          <span className="font-medium text-violet-600">{entry.stageLabel}</span>
          <span aria-hidden>·</span>
          <span>{formatActedAt(entry.actedAt)}</span>
        </div>

        {entry.reviewNotes && (
          <p className="mt-1 line-clamp-2 text-xs italic text-gray-500">{entry.reviewNotes}</p>
        )}
      </div>

      <div className="flex items-center pr-2">
        <ChevronRight className="h-4 w-4 shrink-0 text-gray-300" />
      </div>
    </button>
  );
}

/**
 * Every survey stage this reviewer has personally acted on — the full list
 * behind the dashboard's "Recently Reviewed" widget.
 *
 * Sourced from approvalStageOwnerUids, so a stage stays listed after the chain
 * has moved on to the next reviewer. Rows open the SHARED read-only survey
 * record view (/survey-record/:workOrderId) — the same one Approvals and
 * oversight use, not a second viewer.
 */
export function MyReviewHistoryPage() {
  const navigate = useNavigate();
  const { entries, loading, loadingMore, hasMore, error, loadMore } = useMyReviewHistory();
  const [search,   setSearch]   = useState('');
  const [decision, setDecision] = useState<DecisionFilter>('all');

  const term = normaliseSearchTerm(search);

  // CLIENT-SIDE, over the entries loaded so far — see the note beside the
  // "Load more" hint below. Cheap enough to recompute on every keystroke: this
  // walks an array already in memory, bounded by how many pages the reviewer
  // has chosen to load.
  const visible = useMemo(
    () => entries.filter((e) =>
      (decision === 'all' || e.decision === decision) && matchesHistoryEntry(e, term)),
    [entries, decision, term],
  );

  // Counts respect the SEARCH but not the decision filter — so the pills show
  // what each one would give you from here, rather than every pill but the
  // active one reading zero.
  const counts = useMemo(() => {
    const matching = entries.filter((e) => matchesHistoryEntry(e, term));
    return {
      all:               matching.length,
      approved:          matching.filter((e) => e.decision === 'approved').length,
      changes_requested: matching.filter((e) => e.decision === 'changes_requested').length,
    };
  }, [entries, term]);

  const filtering = term !== '' || decision !== 'all';

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 pb-24">
      <div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="-ml-2 mb-1 gap-1 text-gray-500"
          onClick={() => navigate('/dashboard')}
        >
          <ArrowLeft className="h-4 w-4" />
          Dashboard
        </Button>

        <div className="flex items-center gap-2">
          <h2 className="text-xl font-bold text-gray-900">My Review History</h2>
          {!loading && (
            <span className="rounded-full bg-violet-100 px-2 py-0.5 text-xs font-semibold text-violet-700">
              {visible.length}{hasMore ? '+' : ''}
            </span>
          )}
        </div>
        <p className="mt-0.5 text-xs text-gray-500">
          Survey stages you have approved or sent back. Site task reviews are not included.
        </p>
      </div>

      {/* Shown only once there is something to filter — controls above an
          empty list are noise. Same rule as the Approvals search. */}
      {!loading && entries.length > 0 && (
        <div className="flex flex-col gap-2">
          <Input
            type="search"
            value={search}
            placeholder="Search site code, substation or work order…"
            onChange={(e) => setSearch(e.target.value)}
          />
          <FilterPills
            pills={DECISION_PILLS}
            active={decision}
            onChange={setDecision}
            counts={counts}
            ariaLabel="Filter by decision"
          />
          {/* Honest about scope: unlike the Approvals queue — an unpaginated
              live listener where every row is already in memory — this page
              pages through history on demand, so both the results and the pill
              counts describe what has been LOADED, not the whole history. */}
          {filtering && hasMore && (
            <span className="text-xs text-gray-400">
              Searching the {entries.length} reviews loaded so far — load more to widen it.
            </span>
          )}
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2">
          <p className="text-xs text-red-700">{error}</p>
        </div>
      )}

      {loading ? (
        <div className="flex flex-col gap-2">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24 rounded-lg" />)}
        </div>
      ) : visible.length === 0 ? (
        <div className="py-16 text-center">
          {filtering ? (
            <>
              <p className="text-sm text-gray-400">No reviews match your search or filter.</p>
              <button
                type="button"
                onClick={() => { setSearch(''); setDecision('all'); }}
                className="mt-2 text-xs font-medium text-brand-blue hover:underline"
              >
                Clear search and filters
              </button>
            </>
          ) : (
            <>
              <p className="text-sm text-gray-400">No reviews yet.</p>
              <p className="mt-2 text-xs text-gray-300">
                Surveys you approve or send back will appear here.
              </p>
            </>
          )}
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-2">
            {visible.map((entry) => (
              <HistoryRow
                key={`${entry.surveyId}-${entry.stageIndex}`}
                entry={entry}
                onOpen={() => navigate(`/survey-record/${entry.workOrderId}`)}
              />
            ))}
          </div>

          {hasMore && (
            <Button
              type="button"
              variant="outline"
              className="w-full"
              disabled={loadingMore}
              onClick={loadMore}
            >
              {loadingMore ? 'Loading…' : 'Load more'}
            </Button>
          )}
        </>
      )}
    </div>
  );
}
