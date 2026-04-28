import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore }              from '@/store/authStore';
import { useTaskStore }              from '@/store/taskStore';
import { useAssignedSiteTaskStore }  from '@/store/assignedSiteTaskStore';
import { useRealtimeStats }          from '@/hooks/useRealtimeStats';
import { useRealtimeProjectStats }   from '@/hooks/useRealtimeProjectStats';
import { StatCard }                  from '@/components/dashboard/StatCard';
import { SyncStatusBar }             from '@/components/dashboard/SyncStatusBar';
import { TaskCard }                  from '@/components/tasks/TaskCard';
import { UpdateTaskDrawer }          from '@/components/tasks/UpdateTaskDrawer';
import { TaskDetailDrawer }          from '@/components/tasks/TaskDetailDrawer';
import { UpdateSiteTaskDrawer }      from '@/components/siteTasks/UpdateSiteTaskDrawer';
import { AdminMap }                  from '@/components/map/AdminMap';
import { Skeleton }                  from '@/components/ui/skeleton';
import type { Task, SiteTask } from '@/types';

// ─── Status badge styles (mirrors SiteTaskCard) ───────────────────────────────

const SITE_TASK_STATUS_BADGE: Record<string, string> = {
  pending:     'bg-gray-100 text-gray-600',
  in_progress: 'bg-amber-50 text-amber-700',
  completed:   'bg-green-50 text-green-700',
  blocked:     'bg-red-50 text-red-700',
};

const SITE_TASK_STATUS_LABELS: Record<string, string> = {
  pending:     'Pending',
  in_progress: 'In Progress',
  completed:   'Completed',
  blocked:     'Blocked',
};

// ─── Combined recent tasks (v2.1 + site tasks) ────────────────────────────────

type CombinedItem =
  | { kind: 'task';     data: Task;     sortKey: number }
  | { kind: 'siteTask'; data: SiteTask; sortKey: number };

interface RecentCombinedTasksProps {
  tasks:             Task[];
  siteTasks:         SiteTask[];
  currentUserRole:   string;
  onUpdateTask:      (task: Task)     => void;
  onViewTask:        (task: Task)     => void;
  onUpdateSiteTask:  (task: SiteTask) => void;
}

function RecentCombinedTasks({
  tasks,
  siteTasks,
  currentUserRole,
  onUpdateTask,
  onViewTask,
  onUpdateSiteTask,
}: RecentCombinedTasksProps) {
  // Build a unified list sorted by updatedAt DESC, capped at 5
  const combined: CombinedItem[] = [
    ...tasks.map<CombinedItem>((t) => ({
      kind:    'task',
      data:    t,
      sortKey: t.updatedAt.getTime(),
    })),
    ...siteTasks.map<CombinedItem>((t) => ({
      kind:    'siteTask',
      data:    t,
      sortKey: t.updatedAt.getTime(),
    })),
  ]
    .sort((a, b) => b.sortKey - a.sortKey)
    .slice(0, 5);

  return (
    <div>
      <h3 className="text-base font-semibold text-gray-900 mb-3">Recent Tasks</h3>
      {combined.length === 0 ? (
        <p className="text-sm text-gray-400 py-4 text-center">No tasks yet.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {combined.map((item) => {
            if (item.kind === 'task') {
              const t = item.data;
              return (
                <TaskCard
                  key={`task-${t.id}`}
                  task={t}
                  currentUserRole={currentUserRole as 'admin' | 'field'}
                  onUpdate={() => onUpdateTask(t)}
                  onView={() => onViewTask(t)}
                />
              );
            }
            // SiteTask mini-card
            const st = item.data;
            return (
              <div
                key={`sitetask-${st.id}`}
                className="flex rounded-lg border border-gray-100 bg-white shadow-sm overflow-hidden cursor-pointer hover:border-brand-blue transition-colors"
                onClick={() => onUpdateSiteTask(st)}
              >
                {/* Colour stripe */}
                <div className="w-1.5 shrink-0" style={{ backgroundColor: st.taskColour }} />

                <div className="flex-1 p-3 min-w-0">
                  {/* Site code + city · status badge */}
                  <div className="flex items-center justify-between gap-2 mb-0.5">
                    <span className="text-sm font-bold text-gray-900 font-mono leading-snug truncate">
                      {st.siteCode} · {st.city}
                    </span>
                    <span
                      className={`text-xs font-medium px-2 py-0.5 rounded-full shrink-0 ${SITE_TASK_STATUS_BADGE[st.status] ?? ''}`}
                    >
                      {SITE_TASK_STATUS_LABELS[st.status] ?? st.status}
                    </span>
                  </div>

                  {/* Task label */}
                  <p className="text-sm font-semibold text-gray-800 mt-0.5 leading-snug">
                    {st.taskLabel}
                  </p>

                  {/* Project name */}
                  <p className="text-xs text-gray-400 mt-0.5">{st.projectName}</p>

                  {/* Due date */}
                  {st.dueDate && (
                    <p className="text-xs text-gray-400 mt-1">
                      Due{' '}
                      {st.dueDate.toLocaleDateString('en-GB', {
                        day: '2-digit', month: 'short', year: 'numeric',
                      })}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Greeting ─────────────────────────────────────────────────────────────────

function greeting(name: string): string {
  const hour = new Date().getHours();
  const part = hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
  return `Good ${part}, ${name.split(' ')[0]}`;
}

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

function StatCardSkeletons() {
  return (
    <div className="grid grid-cols-2 gap-3">
      {[...Array(4)].map((_, i) => (
        <Skeleton key={i} className="h-20 rounded-lg" />
      ))}
    </div>
  );
}

function TaskSkeletons() {
  return (
    <div className="flex flex-col gap-2">
      {[...Array(3)].map((_, i) => (
        <Skeleton key={i} className="h-24 rounded-lg" />
      ))}
    </div>
  );
}

export function DashboardPage() {
  const navigate = useNavigate();
  const { currentUser }          = useAuthStore();
  const { tasks, lastUpdated, isConnected } = useTaskStore();
  const { assignedSiteTasks }    = useAssignedSiteTaskStore();
  const stats                    = useRealtimeStats();
  const projectStats             = useRealtimeProjectStats();

  // For field users: combine v2.1 task counts with assigned site-task counts
  // so the stat cards reflect total workload. Admin stat cards use useRealtimeStats
  // unchanged (admins see all v2.1 tasks; they manage site tasks via the Sites page).
  const siteTaskStats = {
    all:         assignedSiteTasks.length,
    pending:     assignedSiteTasks.filter((t) => t.status === 'pending').length,
    in_progress: assignedSiteTasks.filter((t) => t.status === 'in_progress').length,
    completed:   assignedSiteTasks.filter((t) => t.status === 'completed').length,
    blocked:     assignedSiteTasks.filter((t) => t.status === 'blocked').length,
  };
  const combinedStats = {
    all:         stats.all         + siteTaskStats.all,
    pending:     stats.pending     + siteTaskStats.pending,
    in_progress: stats.in_progress + siteTaskStats.in_progress,
    completed:   stats.completed   + siteTaskStats.completed,
    blocked:     stats.blocked     + siteTaskStats.blocked,
  };
  // Field users see combined counts; admins see their own v2.1 task counts only.
  const displayStats = currentUser?.role === 'field' ? combinedStats : stats;

  const [selectedTask, setSelectedTask]         = useState<Task | null>(null);
  const [showUpdate, setShowUpdate]             = useState(false);
  const [showDetail, setShowDetail]             = useState(false);
  const [selectedSiteTask, setSelectedSiteTask] = useState<SiteTask | null>(null);

  const isLoading = !isConnected && tasks.length === 0;

  if (!currentUser) return null;

  return (
    <div className="flex flex-col gap-4 max-w-2xl mx-auto pb-4">
      {/* Greeting */}
      <div>
        <h2 className="text-xl font-bold text-gray-900">
          {greeting(currentUser.name)}
        </h2>
        <div className="mt-1">
          <SyncStatusBar lastUpdated={lastUpdated} isConnected={isConnected} />
        </div>
      </div>

      {/* Notification banner — field users only */}
      {currentUser.role === 'field' && <NotificationBanner />}

      {/* Admin map — shows geotagged tasks as colour-coded pins */}
      {currentUser.role === 'admin' && (
        <AdminMap className="h-64" />
      )}

      {/* Project stat cards — admin only */}
      {currentUser.role === 'admin' && (
        <>
          <p className="text-sm font-semibold text-gray-500 uppercase tracking-wide -mb-1">
            Projects
          </p>
          {isLoading ? (
            <StatCardSkeletons />
          ) : (
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
          )}
        </>
      )}

      {/* Task stat cards */}
      <p className="text-sm font-semibold text-gray-500 uppercase tracking-wide -mb-1">
        Tasks
      </p>
      {isLoading ? (
        <StatCardSkeletons />
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <StatCard
            label="All Tasks"
            count={displayStats.all}
            colour="#0077B6"
            onClick={() => navigate('/tasks')}
          />
          <StatCard
            label="In Progress"
            count={displayStats.in_progress}
            colour="#F4A261"
            onClick={() => navigate('/tasks?filter=in_progress')}
          />
          <StatCard
            label="Completed"
            count={displayStats.completed}
            colour="#2A9D8F"
            onClick={() => navigate('/tasks?filter=completed')}
          />
          <StatCard
            label="Blocked"
            count={displayStats.blocked}
            colour="#E63946"
            onClick={() => navigate('/tasks?filter=blocked')}
          />
        </div>
      )}

      {/* Recent tasks — combined v2.1 tasks + assigned site tasks */}
      {isLoading ? (
        <div>
          <Skeleton className="h-5 w-32 mb-3" />
          <TaskSkeletons />
        </div>
      ) : (
        <RecentCombinedTasks
          tasks={tasks}
          siteTasks={assignedSiteTasks}
          currentUserRole={currentUser.role}
          onUpdateTask={(task) => { setSelectedTask(task); setShowUpdate(true); }}
          onViewTask={(task)   => { setSelectedTask(task); setShowDetail(true); }}
          onUpdateSiteTask={(t) => setSelectedSiteTask(t)}
        />
      )}

      {/* v2.1 task drawers */}
      {selectedTask && (
        <>
          <UpdateTaskDrawer
            task={selectedTask}
            open={showUpdate}
            onClose={() => { setShowUpdate(false); setSelectedTask(null); }}
          />
          <TaskDetailDrawer
            task={selectedTask}
            open={showDetail}
            onClose={() => { setShowDetail(false); setSelectedTask(null); }}
          />
        </>
      )}

      {/* Site task drawer */}
      {selectedSiteTask && (
        <UpdateSiteTaskDrawer
          task={selectedSiteTask}
          open={true}
          onClose={() => setSelectedSiteTask(null)}
        />
      )}
    </div>
  );
}
