import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApprovalQueue }        from '@/hooks/useApprovalQueue';
import { useSurveyApprovalQueue }  from '@/hooks/useSurveyApprovalQueue';
import { SiteTaskCard }            from '@/components/siteTasks/SiteTaskCard';
import { SurveyApprovalCard }      from '@/components/approvals/SurveyApprovalCard';
import { ReviewSiteTaskDrawer }    from '@/components/siteTasks/ReviewSiteTaskDrawer';
import { Skeleton }                from '@/components/ui/skeleton';
import type { SiteTask, SurveyReport } from '@/types';

// ─── Unified row type ─────────────────────────────────────────────────────────
// Site tasks and surveys are different shapes with different approval flows —
// this is purely a display-layer union so both can share one sorted list.

type ApprovalRow =
  | { kind: 'siteTask'; updatedAt: Date; task: SiteTask }
  | { kind: 'survey';   updatedAt: Date; survey: SurveyReport };

export function ApprovalsPage() {
  const navigate = useNavigate();
  const { queue: siteTaskQueue, loading: siteTaskLoading } = useApprovalQueue();
  const { queue: surveyQueue,   loading: surveyLoading }   = useSurveyApprovalQueue();
  const [selectedTask, setSelectedTask] = useState<SiteTask | null>(null);

  const loading = siteTaskLoading || surveyLoading;

  // Newest-first across both kinds, by updatedAt.
  const rows = useMemo((): ApprovalRow[] =>
    [
      ...siteTaskQueue.map((task): ApprovalRow => ({ kind: 'siteTask', updatedAt: task.updatedAt, task })),
      ...surveyQueue.map((survey): ApprovalRow => ({ kind: 'survey', updatedAt: survey.updatedAt, survey })),
    ].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()),
    [siteTaskQueue, surveyQueue],
  );

  return (
    <div className="flex flex-col gap-4 max-w-2xl mx-auto pb-24">
      <div className="flex items-center gap-2">
        <h2 className="text-xl font-bold text-gray-900">Approvals</h2>
        <span className="rounded-full bg-violet-100 text-violet-700 text-xs font-semibold px-2 py-0.5">
          {rows.length}
        </span>
      </div>

      {loading ? (
        <div className="flex flex-col gap-2">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-lg" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="py-16 text-center">
          <p className="text-sm text-gray-400">Nothing awaiting your approval.</p>
          <p className="text-xs text-gray-300 mt-2">
            Tasks and surveys submitted for approval will appear here.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((row) =>
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
