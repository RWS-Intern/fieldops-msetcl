import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore }              from '@/store/authStore';
import { useSiteStore }              from '@/store/siteStore';
import { useAssignedSiteTaskStore }  from '@/store/assignedSiteTaskStore';
import { useAllSiteTasks }           from '@/hooks/useAllSiteTasks';
import { useNetworkStatus }          from '@/hooks/useNetworkStatus';
import { useRealtimeProjectStats }   from '@/hooks/useRealtimeProjectStats';
import { StatCard }                  from '@/components/dashboard/StatCard';
import { SyncStatusBar }             from '@/components/dashboard/SyncStatusBar';
import { UpdateSiteTaskDrawer }      from '@/components/siteTasks/UpdateSiteTaskDrawer';
import { SiteTaskDetailDrawer }     from '@/components/siteTasks/SiteTaskDetailDrawer';
import { AdminMap }                  from '@/components/map/AdminMap';
import { Skeleton }                  from '@/components/ui/skeleton';
import { cn }                        from '@/lib/utils';
import type { SiteTask } from '@/types';

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

// ─── Page ─────────────────────────────────────────────────────────────────────

export function DashboardPage() {
  const navigate = useNavigate();

  const { currentUser }          = useAuthStore();
  const { lastUpdated }          = useSiteStore();
  const isOnline                 = useNetworkStatus();
  const { assignedSiteTasks }    = useAssignedSiteTaskStore();
  const projectStats             = useRealtimeProjectStats();

  // Admin subscribes to all site tasks for stats + recent activity.
  // Field engineers use their assigned tasks store instead.
  const isAdmin = currentUser?.role === 'admin';
  const { tasks: allSiteTasks, loading: allLoading } = useAllSiteTasks(isAdmin);

  // Choose data source based on role
  const siteTasks = isAdmin ? allSiteTasks : assignedSiteTasks;
  const isLoading = isAdmin ? allLoading : false;

  // ── Site task stat counts ────────────────────────────────────────────────────
  const siteTaskStats = useMemo(() => ({
    all:         siteTasks.length,
    in_progress: siteTasks.filter((t) => t.status === 'in_progress').length,
    completed:   siteTasks.filter((t) => t.status === 'completed').length,
    blocked:     siteTasks.filter((t) => t.status === 'blocked').length,
  }), [siteTasks]);

  // ── Drawer state ────────────────────────────────────────────────────────────
  const [selectedSiteTask, setSelectedSiteTask] = useState<SiteTask | null>(null);

  if (!currentUser) return null;

  // Stat card nav: admin → /sites, field → /tasks
  const statsNav = (filter?: string) =>
    isAdmin
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

      {/* Admin map */}
      {currentUser.role === 'admin' && (
        <AdminMap className="h-64" />
      )}

      {/* Project stat cards — admin only */}
      {currentUser.role === 'admin' && (
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

      {/* Site task stat cards */}
      <p className="text-sm font-semibold text-gray-500 uppercase tracking-wide -mb-1">
        {isAdmin ? 'All Site Tasks' : 'My Tasks'}
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

      {/* Site task drawer — admin sees read-only details (no assignment form),
           field engineers see the update/submission form */}
      {selectedSiteTask && (
        isAdmin ? (
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
