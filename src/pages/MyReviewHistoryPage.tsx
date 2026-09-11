import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ChevronRight } from 'lucide-react';
import { useMyReviewHistory } from '@/hooks/useMyReviewHistory';
import { Button }   from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type { ReviewHistoryEntry } from '@/hooks/useMyReviewHistory';

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
              {entries.length}{hasMore ? '+' : ''}
            </span>
          )}
        </div>
        <p className="mt-0.5 text-xs text-gray-500">
          Survey stages you have approved or sent back. Site task reviews are not included.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2">
          <p className="text-xs text-red-700">{error}</p>
        </div>
      )}

      {loading ? (
        <div className="flex flex-col gap-2">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24 rounded-lg" />)}
        </div>
      ) : entries.length === 0 ? (
        <div className="py-16 text-center">
          <p className="text-sm text-gray-400">No reviews yet.</p>
          <p className="mt-2 text-xs text-gray-300">
            Surveys you approve or send back will appear here.
          </p>
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-2">
            {entries.map((entry) => (
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
