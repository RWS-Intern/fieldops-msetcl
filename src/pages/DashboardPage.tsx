import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore }              from '@/store/authStore';
import { useSiteStore }              from '@/store/siteStore';
import { useAssignedSiteTaskStore }  from '@/store/assignedSiteTaskStore';
import { useAllSiteTasks }           from '@/hooks/useAllSiteTasks';
import { useApprovalQueue }          from '@/hooks/useApprovalQueue';
import { useReviewedSiteTasks }      from '@/hooks/useReviewedSiteTasks';
import { useSurveyApprovalQueue }    from '@/hooks/useSurveyApprovalQueue';
import { useReviewedSurveys }        from '@/hooks/useReviewedSurveys';
import { useNetworkStatus }          from '@/hooks/useNetworkStatus';
import { useRealtimeProjectStats }   from '@/hooks/useRealtimeProjectStats';
import { StatCard }                  from '@/components/dashboard/StatCard';
import { SyncStatusBar }             from '@/components/dashboard/SyncStatusBar';
import { UpdateSiteTaskDrawer }      from '@/components/siteTasks/UpdateSiteTaskDrawer';
import { SiteTaskDetailDrawer }     from '@/components/siteTasks/SiteTaskDetailDrawer';
import { AdminMap }                  from '@/components/map/AdminMap';
import { Skeleton }                  from '@/components/ui/skeleton';
import { cn }                        from '@/lib/utils';
import type { SiteTask, SurveyReport } from '@/types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(d: Date): string {
  const s = (Date.now() - d.getTime()) / 1000;
  if (s < 60)    return 'just now';
  if (s < 3600)  return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function greeting(name: string): string {
  const h = new Date().getHours();
  const part = h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening';
  return `Good ${part}, ${name.split(' ')[0]}`;
}

// ─── Status badge ─────────────────────────────────────────────────────────────

const STATUS_BADGE: Record<string, string> = {
  pending:     'bg-gray-100 text-gray-600',
  in_progress: 'bg-amber-50 text-amber-700',
  completed:   'bg-green-50 text-green-700',
  blocked:     'bg-red-50 text-red-700',
};
const STATUS_LABEL: Record<string, string> = {
  pending:     'Pending',
  in_progress: 'In Progress',
  completed:   'Completed',
  blocked:     'Blocked',
};

// ─── Notification banner ──────────────────────────────────────────────────────

function NotificationBanner() {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  if (typeof Notification === 'undefined') return null;
  if (Notification.permission !== 'default') return null;
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg bg-brand-blue/10 border border-brand-blue/20 px-3 py-2">
      <p className="text-sm text-brand-navy">
        Enable notifications to get task alerts
      </p>
      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={() => Notification.requestPermission()}
          className="text-xs font-semibold text-brand-blue hover:underline"
        >
          Enable
        </button>
        <button
          onClick={() => setDismissed(true)}
          className="text-gray-400 hover:text-gray-600 text-sm leading-none"
          aria-label="Dismiss"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

// ─── Skeletons ────────────────────────────────────────────────────────────────

function StatCardSkeletons() {
  return (
    <div className="grid grid-cols-2 gap-3">
      {[...Array(4)].map((_, i) => (
        <Skeleton key={i} className="h-20 rounded-lg" />
      ))}
    </div>
  );
}

function ActivitySkeletons() {
  return (
    <div className="flex flex-col gap-2">
      {[...Array(3)].map((_, i) => (
        <Skeleton key={i} className="h-20 rounded-lg" />
      ))}
    </div>
  );
}

// ─── Recent Activity ──────────────────────────────────────────────────────────

interface RecentActivityProps {
  tasks:           SiteTask[];
  onUpdate:        (t: SiteTask) => void;
}

function RecentActivity({ tasks, onUpdate }: RecentActivityProps) {
  const recent = useMemo(() =>
    tasks
      .filter((t) => t.submittedAt != null)
      .sort((a, b) => (b.submittedAt?.getTime() ?? 0) - (a.submittedAt?.getTime() ?? 0))
      .slice(0, 5),
    [tasks]
  );

  return (
    <div>
      <h3 className="text-base font-semibold text-gray-900 mb-3">Recent Activity</h3>
      {recent.length === 0 ? (
        <p className="text-sm text-gray-400 py-4 text-center">No submissions yet.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {recent.map((st) => (
            <div
              key={st.id}
              className="flex rounded-lg border border-gray-100 bg-white shadow-sm overflow-hidden cursor-pointer hover:border-brand-blue transition-colors"
              onClick={() => onUpdate(st)}
            >
              {/* Colour stripe */}
              <div className="w-1.5 shrink-0" style={{ backgroundColor: st.taskColour }} />

              <div className="flex-1 p-3 min-w-0">
                {/* Site code + task label + status */}
                <div className="flex items-start justify-between gap-2 mb-0.5">
                  <span className="text-sm font-bold text-gray-900 font-mono leading-snug truncate">
                    {st.siteCode}
                  </span>
                  <span className={cn(
                    'text-xs font-medium px-2 py-0.5 rounded-full shrink-0',
                    STATUS_BADGE[st.status] ?? 'bg-gray-100 text-gray-600'
                  )}>
                    {STATUS_LABEL[st.status] ?? st.status}
                  </span>
                </div>

                {/* Task label */}
                <p className="text-sm font-semibold text-gray-800 leading-snug">
                  {st.taskLabel}
                </p>

                {/* Engineer + time ago */}
                <div className="flex items-center gap-2 mt-1">
                  {st.assignedToName && (
                    <span className="text-xs text-gray-500">{st.assignedToName}</span>
                  )}
                  {st.submittedAt && (
                    <span className="text-xs text-gray-400">· {timeAgo(st.submittedAt)}</span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Recently Reviewed (approver dashboard) ───────────────────────────────────
//
// Colours match taskUtils.ts: completed/approved → #2A9D8F (green),
// changes_requested → #F97316 (orange). reviewedBy overwrites on every
// review, so an item only ever reflects its MOST RECENT reviewer's decision
// — exactly what "reviewedBy == currentUser.uid" should show.
//
// Site tasks (status 'completed') and surveys (status 'approved') use
// different literal values for "approved" — ReviewedRow normalises that at
// the call site so this component only ever branches on `kind`.

type ReviewedRow =
  | { kind: 'siteTask'; reviewedAt: Date; task: SiteTask }
  | { kind: 'survey';   reviewedAt: Date; survey: SurveyReport };

function RecentlyReviewed({ rows }: { rows: ReviewedRow[] }) {
  return (
    <div>
      <h3 className="text-base font-semibold text-gray-900 mb-3">Recently Reviewed</h3>
      {rows.length === 0 ? (
        <p className="text-sm text-gray-400 py-4 text-center">No reviews yet.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((row) => {
            const isSurvey    = row.kind === 'survey';
            const siteCode    = isSurvey ? row.survey.siteCode : row.task.siteCode;
            const label       = isSurvey ? 'Survey' : row.task.taskLabel;
            const isApproved  = isSurvey ? row.survey.status === 'approved' : row.task.status === 'completed';
            const key         = isSurvey ? `survey-${row.survey.id}` : `task-${row.task.id}`;
            return (
              <div
                key={key}
                className="flex rounded-lg border border-gray-100 bg-white shadow-sm overflow-hidden"
              >
                {/* Colour stripe */}
                <div
                  className="w-1.5 shrink-0"
                  style={{ backgroundColor: isApproved ? '#2A9D8F' : '#F97316' }}
                />

                <div className="flex-1 p-3 min-w-0">
                  {/* Site code + decision */}
                  <div className="flex items-start justify-between gap-2 mb-0.5">
                    <span className="text-sm font-bold text-gray-900 font-mono leading-snug truncate">
                      {siteCode}
                    </span>
                    <span className={cn(
                      'text-xs font-medium px-2 py-0.5 rounded-full shrink-0',
                      isApproved ? 'bg-green-50 text-green-700' : 'bg-orange-50 text-orange-700'
                    )}>
                      {isApproved ? 'Approved' : 'Changes Requested'}
                    </span>
                  </div>

                  {/* Task label / "Survey" marker */}
                  <p className="text-sm font-semibold text-gray-800 leading-snug">
                    {label}
                  </p>

                  {/* Reviewed at */}
                  <p className="text-xs text-gray-400 mt-1">{timeAgo(row.reviewedAt)}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function DashboardPage() {
  const navigate = useNavigate();

  const { currentUser }          = useAuthStore();
  const { lastUpdated }          = useSiteStore();
  const isOnline                 = useNetworkStatus();
  const { assignedSiteTasks }    = useAssignedSiteTaskStore();
  const projectStats             = useRealtimeProjectStats();

  // Admin (and the read-only viewer) subscribe to all site tasks for stats +
  // recent activity. Field engineers use their assigned tasks store instead.
  //
  // A viewer must get the org-wide overview, NOT the field-engineer branch:
  // nothing is ever assigned to a viewer, so that branch would render all
  // zeros — the same bug already fixed for approvers.
  const isAdmin    = currentUser?.role === 'admin';
  const isApprover = currentUser?.role === 'approver';
  const isViewer   = currentUser?.role === 'viewer';
  const isOverview = isAdmin || isViewer;
  const { tasks: allSiteTasks, loading: allLoading } = useAllSiteTasks(isOverview);

  // Choose data source based on role
  const siteTasks = isOverview ? allSiteTasks : assignedSiteTasks;
  const isLoading = isOverview ? allLoading : false;

  // ── Site task stat counts ────────────────────────────────────────────────────
  const siteTaskStats = useMemo(() => ({
    all:         siteTasks.length,
    in_progress: siteTasks.filter((t) => t.status === 'in_progress').length,
    completed:   siteTasks.filter((t) => t.status === 'completed').length,
    blocked:     siteTasks.filter((t) => t.status === 'blocked').length,
  }), [siteTasks]);

  // ── Approver dashboard data ──────────────────────────────────────────────────
  // Called unconditionally (rules of hooks) for every role — same tolerance
  // already established for useAssignedSiteTasks in Layout.tsx: both queries
  // are scoped by uid (approverUid / reviewedBy), so an admin or field session
  // simply gets whatever matches their own uid, which is safe and inexpensive.
  const { queue: approvalQueue, loading: approvalQueueLoading }             = useApprovalQueue();
  const { queue: surveyApprovalQueue, loading: surveyApprovalQueueLoading } = useSurveyApprovalQueue();
  const { tasks: reviewedTasks, loading: reviewedLoading }                  = useReviewedSiteTasks();
  const { surveys: reviewedSurveys, loading: reviewedSurveysLoading }      = useReviewedSurveys();
  const approverLoading =
    approvalQueueLoading || surveyApprovalQueueLoading || reviewedLoading || reviewedSurveysLoading;

  const approverStats = useMemo(() => {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const reviewedTasksThisWeek = reviewedTasks.filter(
      (t) => t.reviewedAt != null && t.reviewedAt >= sevenDaysAgo,
    );
    const reviewedSurveysThisWeek = reviewedSurveys.filter(
      (s) => s.reviewedAt != null && s.reviewedAt >= sevenDaysAgo,
    );
    return {
      pendingMyApproval: approvalQueue.length + surveyApprovalQueue.length,
      approvedThisWeek:
        reviewedTasksThisWeek.filter((t) => t.status === 'completed').length +
        reviewedSurveysThisWeek.filter((s) => s.status === 'approved').length,
      sentBackThisWeek:
        reviewedTasksThisWeek.filter((t) => t.status === 'changes_requested').length +
        reviewedSurveysThisWeek.filter((s) => s.status === 'changes_requested').length,
    };
  }, [approvalQueue, surveyApprovalQueue, reviewedTasks, reviewedSurveys]);

  const recentlyReviewed = useMemo((): ReviewedRow[] =>
    [
      ...reviewedTasks
        .filter((t) => t.reviewedAt != null)
        .map((task): ReviewedRow => ({ kind: 'siteTask', reviewedAt: task.reviewedAt!, task })),
      ...reviewedSurveys
        .filter((s) => s.reviewedAt != null)
        .map((survey): ReviewedRow => ({ kind: 'survey', reviewedAt: survey.reviewedAt!, survey })),
    ]
      .sort((a, b) => b.reviewedAt.getTime() - a.reviewedAt.getTime())
      .slice(0, 5),
    [reviewedTasks, reviewedSurveys]
  );

  // ── Drawer state ────────────────────────────────────────────────────────────
  const [selectedSiteTask, setSelectedSiteTask] = useState<SiteTask | null>(null);

  if (!currentUser) return null;

  // Stat card nav: admin/viewer → /sites, field → /tasks
  const statsNav = (filter?: string) =>
    isOverview
      ? () => navigate('/sites')
      : () => navigate(filter ? `/tasks?filter=${filter}` : '/tasks');

  return (
    <div className="flex flex-col gap-4 max-w-2xl mx-auto pb-4">

      {/* Greeting */}
      <div>
        <h2 className="text-xl font-bold text-gray-900">
          {greeting(currentUser.name)}
        </h2>
        <div className="mt-1">
          <SyncStatusBar lastUpdated={lastUpdated} isConnected={isOnline} />
        </div>
      </div>

      {/* Notification banner — field users only */}
      {currentUser.role === 'field' && <NotificationBanner />}

      {/* Org-wide site map — admin + viewer (read-only either way) */}
      {isOverview && (
        <AdminMap className="h-64" />
      )}

      {/* Project stat cards — admin + viewer */}
      {isOverview && (
        <>
          <p className="text-sm font-semibold text-gray-500 uppercase tracking-wide -mb-1">
            Projects
          </p>
          <div className="grid grid-cols-2 gap-3">
            <StatCard
              label="All Projects"
              count={projectStats.all}
              colour="#0077B6"
              onClick={() => navigate('/projects')}
            />
            <StatCard
              label="In Progress"
              count={projectStats.in_progress}
              colour="#F4A261"
              onClick={() => navigate('/projects')}
            />
            <StatCard
              label="Completed"
              count={projectStats.completed}
              colour="#2A9D8F"
              onClick={() => navigate('/projects')}
            />
            <StatCard
              label="Blocked"
              count={projectStats.blocked}
              colour="#E63946"
              onClick={() => navigate('/projects')}
            />
          </div>
        </>
      )}

      {/* Site task stat cards — admin, viewer & field; approver has its own block below */}
      {!isApprover && (
        <>
          <p className="text-sm font-semibold text-gray-500 uppercase tracking-wide -mb-1">
            {isOverview ? 'All Site Tasks' : 'My Tasks'}
          </p>
          {isLoading ? (
            <StatCardSkeletons />
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <StatCard
                label="All Tasks"
                count={siteTaskStats.all}
                colour="#0077B6"
                onClick={statsNav()}
              />
              <StatCard
                label="In Progress"
                count={siteTaskStats.in_progress}
                colour="#F4A261"
                onClick={statsNav('in_progress')}
              />
              <StatCard
                label="Completed"
                count={siteTaskStats.completed}
                colour="#2A9D8F"
                onClick={statsNav('completed')}
              />
              <StatCard
                label="Blocked"
                count={siteTaskStats.blocked}
                colour="#E63946"
                onClick={statsNav('blocked')}
              />
            </div>
          )}

          {/* Recent Activity */}
          {isLoading ? (
            <div>
              <Skeleton className="h-5 w-40 mb-3" />
              <ActivitySkeletons />
            </div>
          ) : (
            <RecentActivity
              tasks={siteTasks}
              onUpdate={(t) => setSelectedSiteTask(t)}
            />
          )}
        </>
      )}

      {/* Approver dashboard */}
      {isApprover && (
        <>
          <p className="text-sm font-semibold text-gray-500 uppercase tracking-wide -mb-1">
            Approvals
          </p>
          {approverLoading ? (
            <StatCardSkeletons />
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <StatCard
                label="Pending My Approval"
                count={approverStats.pendingMyApproval}
                colour="#8B5CF6"
                onClick={() => navigate('/approvals')}
              />
              <StatCard
                label="Approved This Week"
                count={approverStats.approvedThisWeek}
                colour="#2A9D8F"
                onClick={() => navigate('/approvals')}
              />
              <StatCard
                label="Sent Back This Week"
                count={approverStats.sentBackThisWeek}
                colour="#F97316"
                onClick={() => navigate('/approvals')}
              />
            </div>
          )}

          {approverLoading ? (
            <div>
              <Skeleton className="h-5 w-40 mb-3" />
              <ActivitySkeletons />
            </div>
          ) : (
            <RecentlyReviewed rows={recentlyReviewed} />
          )}
        </>
      )}

      {/* Site task drawer — admin and viewer see read-only details (no
           assignment form), field engineers see the update/submission form */}
      {selectedSiteTask && (
        isOverview ? (
          <SiteTaskDetailDrawer
            task={selectedSiteTask}
            open={true}
            onClose={() => setSelectedSiteTask(null)}
            readOnly={true}
          />
        ) : (
          <UpdateSiteTaskDrawer
            task={selectedSiteTask}
            open={true}
            onClose={() => setSelectedSiteTask(null)}
          />
        )
      )}
    </div>
  );
}
