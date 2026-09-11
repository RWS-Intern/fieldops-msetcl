import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApprovalQueue }        from '@/hooks/useApprovalQueue';
import { useSurveyApprovalQueue }  from '@/hooks/useSurveyApprovalQueue';
import { SiteTaskCard }            from '@/components/siteTasks/SiteTaskCard';
import { SurveyApprovalCard }      from '@/components/approvals/SurveyApprovalCard';
import { ReviewSiteTaskDrawer }    from '@/components/siteTasks/ReviewSiteTaskDrawer';
import { Skeleton }                from '@/components/ui/skeleton';
import { Input }                  from '@/components/ui/input';
import { normaliseSearchTerm }    from '@/lib/siteSearch';
import type { SiteTask, SurveyReport } from '@/types';

// ─── Unified row type ─────────────────────────────────────────────────────────
// Site tasks and surveys are different shapes with different approval flows —
// this is purely a display-layer union so both can share one sorted list.

type ApprovalRow =
  | { kind: 'siteTask'; updatedAt: Date; task: SiteTask }
  | { kind: 'survey';   updatedAt: Date; survey: SurveyReport };

/**
 * Does this queue row match what the approver typed?
 *
 * CLIENT-SIDE, deliberately — and safe here in a way it would NOT be on the
 * admin oversight list. Both queue hooks are unpaginated live listeners
 * scoped to `approverUid == me`, so every row the approver can see is already
 * in memory: there is no page 2 for a filter to miss. Oversight pages the
 * whole collection 50 at a time, which is exactly why its search had to be a
 * real query instead.
 *
 * Matches the fields each row actually RENDERS, so a hit is always explicable
 * — site code, substation name, the row's label, and the code shown beside it
 * (work order code for a survey, project name for a site task).
 *
 * `term` must already be normalised; use normaliseSearchTerm().
 */
function matchesApprovalRow(row: ApprovalRow, term: string): boolean {
  if (!term) return true;

  const haystack = row.kind === 'survey'
    ? [row.survey.siteCode, row.survey.siteName, row.survey.workOrderCode, 'Survey']
    : [row.task.siteCode, row.task.siteName, row.task.taskLabel, row.task.projectName];

  return haystack.some((field) => (field ?? '').toLowerCase().includes(term));
}

export function ApprovalsPage() {
  const navigate = useNavigate();
  const { queue: siteTaskQueue, loading: siteTaskLoading } = useApprovalQueue();
  const { queue: surveyQueue,   loading: surveyLoading }   = useSurveyApprovalQueue();
  const [selectedTask, setSelectedTask] = useState<SiteTask | null>(null);
  const [search, setSearch] = useState('');

  const loading = siteTaskLoading || surveyLoading;

  // Newest-first across both kinds, by updatedAt.
  const rows = useMemo((): ApprovalRow[] =>
    [
      ...siteTaskQueue.map((task): ApprovalRow => ({ kind: 'siteTask', updatedAt: task.updatedAt, task })),
      ...surveyQueue.map((survey): ApprovalRow => ({ kind: 'survey', updatedAt: survey.updatedAt, survey })),
    ].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()),
    [siteTaskQueue, surveyQueue],
  );

  const term = normaliseSearchTerm(search);
  const visibleRows = useMemo(
    () => rows.filter((row) => matchesApprovalRow(row, term)),
    [rows, term],
  );

  return (
    <div className="flex flex-col gap-4 max-w-2xl mx-auto pb-24">
      <div className="flex items-center gap-2">
        <h2 className="text-xl font-bold text-gray-900">Approvals</h2>
        <span className="rounded-full bg-violet-100 text-violet-700 text-xs font-semibold px-2 py-0.5">
          {rows.length}
        </span>
      </div>

      {/* Shown only once there is something to filter — a search box above an
          empty queue is noise. */}
      {!loading && rows.length > 0 && (
        <div className="flex flex-col gap-1">
          <Input
            type="search"
            value={search}
            placeholder="Search site code, substation or task…"
            onChange={(e) => setSearch(e.target.value)}
          />
          {term !== '' && (
            <span className="text-xs text-gray-400">
              {visibleRows.length} of {rows.length} shown
            </span>
          )}
        </div>
      )}

      {loading ? (
        <div className="flex flex-col gap-2">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-lg" />
          ))}
        </div>
      ) : visibleRows.length === 0 ? (
        <div className="py-16 text-center">
          {term !== '' ? (
            <>
              <p className="text-sm text-gray-400">No matches for &ldquo;{search.trim()}&rdquo;.</p>
              <button
                type="button"
                onClick={() => setSearch('')}
                className="mt-2 text-xs font-medium text-brand-blue hover:underline"
              >
                Clear search
              </button>
            </>
          ) : (
            <>
              <p className="text-sm text-gray-400">Nothing awaiting your approval.</p>
              <p className="text-xs text-gray-300 mt-2">
                Tasks and surveys submitted for approval will appear here.
              </p>
            </>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {visibleRows.map((row) =>
            row.kind === 'siteTask' ? (
              <SiteTaskCard
                key={`task-${row.task.id}`}
                task={row.task}
                onUpdate={() => setSelectedTask(row.task)}
                actionLabel="Review"
              />
            ) : (
              <SurveyApprovalCard
                key={`survey-${row.survey.id}`}
                survey={row.survey}
                onOpen={() => navigate(`/survey-record/${row.survey.workOrderId}`)}
              />
            ),
          )}
        </div>
      )}

      {selectedTask && (
        <ReviewSiteTaskDrawer
          task={selectedTask}
          open={!!selectedTask}
          onClose={() => setSelectedTask(null)}
        />
      )}
    </div>
  );
}
