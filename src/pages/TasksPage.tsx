import { useState, useMemo, useEffect } from 'react';
import { Navigate }                     from 'react-router-dom';
import { useAuthStore }              from '@/store/authStore';
import { useAssignedSiteTaskStore }  from '@/store/assignedSiteTaskStore';
import { SiteTaskCard }              from '@/components/siteTasks/SiteTaskCard';
import { UpdateSiteTaskDrawer }      from '@/components/siteTasks/UpdateSiteTaskDrawer';
import { cn }                        from '@/lib/utils';
import type { SiteTask, TaskStatus } from '@/types';

// ─── Types ────────────────────────────────────────────────────────────────────

/** Shape saved to sessionStorage when "Create new task type" is clicked */
export interface CreateTaskFormState {
  title:           string;
  typeId:          string;
  description:     string;
  assignedTo:      string;
  startDate:       string;
  dueDate:         string;
  siteCode:        string;
  linkedProjectId: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_PILLS: { key: TaskStatus | 'all'; label: string }[] = [
  { key: 'all',                label: 'All'                },
  { key: 'pending',            label: 'Pending'            },
  { key: 'in_progress',        label: 'In Progress'        },
  { key: 'pending_approval',   label: 'Pending Approval'   },
  { key: 'changes_requested',  label: 'Changes Requested'  },
  { key: 'completed',          label: 'Completed'          },
  { key: 'blocked',            label: 'Blocked'            },
];

// ─── Field Engineer View ──────────────────────────────────────────────────────

function FieldTasksView() {
  const { assignedSiteTasks } = useAssignedSiteTaskStore();

  const [search,       setSearch]       = useState('');
  const [activeFilter, setActiveFilter] = useState<TaskStatus | 'all'>('all');
  const [selectedTask, setSelectedTask] = useState<SiteTask | null>(null);

  // ── URL ?filter= param ──────────────────────────────────────────────────────
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const f = params.get('filter');
    if (f && STATUS_PILLS.some((p) => p.key === f)) {
      setActiveFilter(f as TaskStatus | 'all');
    }
  }, []);

  // ── Filter + search ─────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    let result = assignedSiteTasks;

    if (activeFilter !== 'all') {
      result = result.filter((t) => t.status === activeFilter);
    }

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter(
        (t) =>
          t.siteCode.toLowerCase().includes(q) ||
          t.taskLabel.toLowerCase().includes(q) ||
          t.city.toLowerCase().includes(q)
      );
    }

    return result;
  }, [assignedSiteTasks, activeFilter, search]);

  // ── Counts for pills ─────────────────────────────────────────────────────────
  const counts = useMemo(() => ({
    all:                assignedSiteTasks.length,
    pending:            assignedSiteTasks.filter((t) => t.status === 'pending').length,
    in_progress:        assignedSiteTasks.filter((t) => t.status === 'in_progress').length,
    pending_approval:   assignedSiteTasks.filter((t) => t.status === 'pending_approval').length,
    changes_requested:  assignedSiteTasks.filter((t) => t.status === 'changes_requested').length,
    completed:          assignedSiteTasks.filter((t) => t.status === 'completed').length,
    blocked:            assignedSiteTasks.filter((t) => t.status === 'blocked').length,
  }), [assignedSiteTasks]);

  return (
    <div className="flex flex-col gap-4 max-w-2xl mx-auto pb-24">
      {/* Heading */}
      <div className="flex items-center gap-2">
        <h2 className="text-xl font-bold text-gray-900">My Tasks</h2>
        <span className="rounded-full bg-brand-blue/10 text-brand-blue text-xs font-semibold px-2 py-0.5">
          {filtered.length}
        </span>
      </div>

      {/* Search */}
      <div className="relative">
        <svg
          className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none"
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round"
            d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
        </svg>
        <input
          type="search"
          placeholder="Search by site code, task, or city…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded-lg border border-gray-200 bg-white pl-9 pr-4 py-2 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-blue/30 focus:border-brand-blue"
        />
      </div>

      {/* Status filter pills */}
      <div className="flex gap-1.5 flex-wrap">
        {STATUS_PILLS.map(({ key, label }) => {
          const isActive = activeFilter === key;
          const count    = counts[key as keyof typeof counts];
          return (
            <button
              key={key}
              type="button"
              onClick={() => setActiveFilter(key)}
              className={cn(
                'px-3 py-1 rounded-full text-xs font-medium border transition-colors',
                isActive
                  ? 'bg-brand-blue text-white border-brand-blue'
                  : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300 hover:bg-gray-50'
              )}
            >
              {label}
              <span className={cn('ml-1', isActive ? 'opacity-75' : 'text-gray-400')}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Task list */}
      {filtered.length === 0 ? (
        <div className="py-16 text-center">
          <p className="text-sm text-gray-400">
            {assignedSiteTasks.length === 0
              ? 'No tasks assigned yet.'
              : search || activeFilter !== 'all'
              ? 'No tasks match your search or filter.'
              : 'No tasks in this category.'}
          </p>
          {assignedSiteTasks.length === 0 && (
            <p className="text-xs text-gray-300 mt-2">
              Your tasks will appear here when an admin assigns them to you.
            </p>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.map((task) => (
            <SiteTaskCard
              key={task.id}
              task={task}
              onUpdate={() => setSelectedTask(task)}
            />
          ))}
        </div>
      )}

      {/* Drawer */}
      {selectedTask && (
        <UpdateSiteTaskDrawer
          task={selectedTask}
          open={!!selectedTask}
          onClose={() => setSelectedTask(null)}
        />
      )}
    </div>
  );
}

// ─── Page entry point ─────────────────────────────────────────────────────────

export function TasksPage() {
  const { currentUser } = useAuthStore();

  if (!currentUser) return null;

  // Admins no longer use /tasks — redirect to the Sites page which is the v3
  // command centre for all site task management. A viewer goes the same way:
  // nothing is assigned to them, so the field list would always be empty.
  if (currentUser.role === 'admin' || currentUser.role === 'viewer') {
    return <Navigate to="/sites" replace />;
  }

  return <FieldTasksView />;
}
