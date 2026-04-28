import { useState, useEffect, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { Plus, RotateCcw } from 'lucide-react';
import { db } from '@/firebase/config';
import { useAuthStore }               from '@/store/authStore';
import { useTaskStore }               from '@/store/taskStore';
import { useProjectStore }            from '@/store/projectStore';
import { useAssignedSiteTaskStore }   from '@/store/assignedSiteTaskStore';
import { useToast }                   from '@/components/ui/toast';
import { archiveTask }                from '@/hooks/useTaskActions';
import { SearchBar }                  from '@/components/tasks/SearchBar';
import { FilterPills }                from '@/components/tasks/FilterPills';
import { TaskCard }                   from '@/components/tasks/TaskCard';
import { Card }                       from '@/components/ui/card';
import { Button }                     from '@/components/ui/button';
import { CreateTaskModal }            from '@/components/tasks/CreateTaskModal';
import { UpdateTaskDrawer }           from '@/components/tasks/UpdateTaskDrawer';
import { TaskDetailDrawer }           from '@/components/tasks/TaskDetailDrawer';
import { SiteTaskCard }               from '@/components/siteTasks/SiteTaskCard';
import { UpdateSiteTaskDrawer }       from '@/components/siteTasks/UpdateSiteTaskDrawer';
import { Skeleton }                   from '@/components/ui/skeleton';
import { cn }                         from '@/lib/utils';
import type { Task, TaskType, SiteTask } from '@/types';

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

const VALID_STATUS_FILTERS = ['all', 'pending', 'in_progress', 'completed', 'blocked'];

// ─── Sub-components ───────────────────────────────────────────────────────────

function TaskSkeletons() {
  return (
    <div className="flex flex-col gap-2">
      {[...Array(5)].map((_, i) => (
        <Skeleton key={i} className="h-28 rounded-lg" />
      ))}
    </div>
  );
}

/** Minimal card shown in the archived view */
function ArchivedTaskCard({
  task,
  onRestore,
}: {
  task:      Task;
  onRestore: () => void;
}) {
  return (
    <Card className="overflow-hidden border-0 shadow-sm opacity-75">
      <div className="flex">
        <div className="w-1 shrink-0 bg-gray-300" />
        <div className="flex-1 p-3 min-w-0">
          <div className="flex items-start justify-between gap-2 mb-1">
            <div className="min-w-0">
              <span className="text-xs font-mono text-gray-400">{task.taskNum}</span>
              {task.siteCode && (
                <span className="text-xs text-gray-400 ml-2">· {task.siteCode}</span>
              )}
            </div>
            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 shrink-0">
              Archived
            </span>
          </div>
          <h3 className="text-sm font-semibold text-gray-600 leading-snug line-clamp-1">
            {task.title}
          </h3>
          <div className="flex items-center gap-2 mt-1.5">
            <span className="text-xs text-gray-400">{task.assignedToName}</span>
            {task.type && (
              <span className="text-xs text-gray-400">· {task.type}</span>
            )}
          </div>
          <div className="flex justify-end mt-2">
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1.5"
              onClick={onRestore}
            >
              <RotateCcw className="h-3 w-3" />
              Restore
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function TasksPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { currentUser }                 = useAuthStore();
  const { tasks, isConnected }          = useTaskStore();
  const { projects }                    = useProjectStore();
  const { assignedSiteTasks }           = useAssignedSiteTaskStore();
  const { showToast }                   = useToast();

  const [searchQuery, setSearchQuery]             = useState('');
  const [activeFilter, setActiveFilter]           = useState<string>('all');
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [taskTypes, setTaskTypes]                 = useState<TaskType[]>([]);
  const [selectedTask, setSelectedTask]           = useState<Task | null>(null);
  const [showCreate, setShowCreate]               = useState(false);
  const [showUpdate, setShowUpdate]               = useState(false);
  const [showDetail, setShowDetail]               = useState(false);
  const [selectedSiteTask, setSelectedSiteTask]   = useState<SiteTask | null>(null);

  // Archived-view state
  const [showArchived, setShowArchived]       = useState(false);
  const [archivedTasks, setArchivedTasks]     = useState<Task[]>([]);
  const [loadingArchived, setLoadingArchived] = useState(false);

  // Form state to restore after "create new task type" navigation
  const [createModalInitialData, setCreateModalInitialData] =
    useState<CreateTaskFormState | undefined>(undefined);

  // Guard against re-processing the restoreForm param on URL changes
  const restoredRef = useRef(false);

  const safeProjects = projects ?? [];
  const isLoading    = !isConnected && (tasks ?? []).length === 0;

  // ── Read ?filter= param ───────────────────────────────────────────────────
  useEffect(() => {
    const param = searchParams.get('filter') ?? 'all';
    setActiveFilter(param);
  }, [searchParams]);

  // ── Restore form from sessionStorage after task-type creation flow ────────
  // TasksPage remounts on navigation, so empty-deps captures the initial URL.
  // The restoredRef guard prevents double-processing on any URL-driven re-run.
  useEffect(() => {
    if (restoredRef.current) return;
    if (searchParams.get('restoreForm') !== 'true') return;

    restoredRef.current = true;

    // Clean the URL without affecting other params
    setSearchParams(
      (prev) => { prev.delete('restoreForm'); return prev; },
      { replace: true }
    );

    const saved = sessionStorage.getItem('pendingTaskForm');
    if (saved) {
      try {
        const data = JSON.parse(saved) as CreateTaskFormState;
        sessionStorage.removeItem('pendingTaskForm');
        setCreateModalInitialData(data);
        setShowCreate(true);
      } catch {
        sessionStorage.removeItem('pendingTaskForm');
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Load task types for filter pills ─────────────────────────────────────
  useEffect(() => {
    async function loadTaskTypes() {
      try {
        const q = query(collection(db, 'taskMaster'), where('active', '==', true));
        const snap = await getDocs(q);
        const types: TaskType[] = snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as Omit<TaskType, 'id'>) }))
          .sort((a, b) => a.sortOrder - b.sortOrder);
        setTaskTypes(types);
      } catch { /* non-critical */ }
    }
    loadTaskTypes();
  }, []);

  // ── Fetch archived tasks (admin only, on demand) ──────────────────────────
  async function loadArchivedTasks() {
    if (!currentUser || currentUser.role !== 'admin') return;
    setLoadingArchived(true);
    try {
      const q = query(
        collection(db, 'tasks'),
        where('archived', '==', true)
      );
      const snap = await getDocs(q);
      const loaded: Task[] = snap.docs.map((d) => {
        const data = d.data();
        return {
          id:               d.id,
          taskNum:          data['taskNum']          ?? '',
          title:            data['title']            ?? '',
          type:             data['type']             ?? '',
          description:      data['description']      ?? '',
          assignedTo:       data['assignedTo']       ?? '',
          assignedToName:   data['assignedToName']   ?? '',
          createdBy:        data['createdBy']        ?? '',
          siteCode:         data['siteCode']         ?? '',
          startDate:        data['startDate']?.toDate?.()   ?? new Date(),
          dueDate:          data['dueDate']?.toDate?.()     ?? new Date(),
          status:           data['status']           ?? 'pending',
          blockedReason:    data['blockedReason']    ?? null,
          location:         data['location']         ?? null,
          subtaskAnswers:   data['subtaskAnswers']   ?? {},
          subtaskPhotos:    data['subtaskPhotos']    ?? {},
          completionPhotos: data['completionPhotos'] ?? [],
          createdAt:        data['createdAt']?.toDate?.()   ?? new Date(),
          updatedAt:        data['updatedAt']?.toDate?.()   ?? new Date(),
          submittedBy:      data['submittedBy']      ?? undefined,
          submittedByName:  data['submittedByName']  ?? undefined,
          submittedAt:      data['submittedAt']?.toDate?.() ?? undefined,
          projectId:        data['projectId']        ?? null,
          projectTitle:     data['projectTitle']     ?? null,
          projectNum:       data['projectNum']       ?? null,
          archived:         true,
          archivedAt:       data['archivedAt']?.toDate?.() ?? null,
        } as Task;
      });
      // Sort by most recently archived first
      loaded.sort((a, b) =>
        (b.archivedAt?.getTime() ?? 0) - (a.archivedAt?.getTime() ?? 0)
      );
      setArchivedTasks(loaded);
    } catch {
      setArchivedTasks([]);
    } finally {
      setLoadingArchived(false);
    }
  }

  // ── Restore a single archived task ────────────────────────────────────────
  async function handleRestoreTask(taskId: string) {
    try {
      await archiveTask(taskId, false);
      // Optimistic remove from archived list
      setArchivedTasks((prev) => prev.filter((t) => t.id !== taskId));
      showToast('Task restored', 'success');
    } catch {
      showToast('Failed to restore task', 'error');
    }
  }

  // ── Filtered / display tasks ──────────────────────────────────────────────
  const displayTasks = useMemo(() => {
    const source = showArchived ? archivedTasks : (tasks ?? []);
    let result = source;

    if (activeFilter !== 'all') {
      if (VALID_STATUS_FILTERS.includes(activeFilter)) {
        result = result.filter((t) => t.status === activeFilter);
      } else {
        result = result.filter((t) => t.type === activeFilter);
      }
    }

    if (selectedProjectId) {
      result = result.filter((t) => t.projectId === selectedProjectId);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (t) =>
          t.title.toLowerCase().includes(q) ||
          t.taskNum.toLowerCase().includes(q) ||
          (t.siteCode ?? '').toLowerCase().includes(q) ||
          (t.description ?? '').toLowerCase().includes(q)
      );
    }
    return result;
  }, [tasks, archivedTasks, showArchived, activeFilter, selectedProjectId, searchQuery]);

  if (!currentUser || !tasks) return null;

  const currentlyLoading = showArchived ? loadingArchived : isLoading;

  return (
    <div className="flex flex-col gap-4 max-w-2xl mx-auto">
      {/* Heading + count badge */}
      <div className="flex items-center gap-2">
        <h2 className="text-xl font-bold text-gray-900">
          {showArchived ? 'Archived Tasks' : 'Tasks'}
        </h2>
        <span className="rounded-full bg-brand-blue/10 text-brand-blue text-xs font-semibold px-2 py-0.5">
          {currentlyLoading ? '…' : displayTasks.length}
        </span>
      </div>

      <SearchBar value={searchQuery} onChange={setSearchQuery} />

      <FilterPills
        activeFilter={activeFilter}
        onFilterChange={setActiveFilter}
        taskTypes={taskTypes}
      />

      {/* Project filter row — only shown when projects exist and not in archive mode */}
      {!showArchived && safeProjects.length > 0 && (
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-gray-500 shrink-0">Project:</span>
          <div className="flex gap-1.5 overflow-x-auto pb-0.5 flex-wrap">
            <button
              type="button"
              onClick={() => setSelectedProjectId(null)}
              className={cn(
                'px-2.5 py-1 rounded-full text-xs font-medium border whitespace-nowrap transition-colors',
                selectedProjectId === null
                  ? 'bg-brand-blue text-white border-brand-blue'
                  : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'
              )}
            >
              All Projects
            </button>
            {safeProjects.map((p) => {
              const raw   = `${p.projectNum ?? ''} · ${p.title ?? ''}`;
              const label = raw.length > 25 ? `${raw.slice(0, 25)}…` : raw;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() =>
                    setSelectedProjectId((prev) => (prev === p.id ? null : p.id))
                  }
                  className={cn(
                    'px-2.5 py-1 rounded-full text-xs font-medium border whitespace-nowrap transition-colors',
                    selectedProjectId === p.id
                      ? 'bg-brand-blue text-white border-brand-blue'
                      : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'
                  )}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Show archived toggle — admin only */}
      {currentUser.role === 'admin' && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => {
              const next = !showArchived;
              setShowArchived(next);
              if (next) loadArchivedTasks();
              else setArchivedTasks([]);
            }}
            className={cn(
              'px-2.5 py-1 rounded-full text-xs font-medium border transition-colors',
              showArchived
                ? 'bg-gray-500 text-white border-gray-500'
                : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300 hover:bg-gray-50'
            )}
          >
            {showArchived ? 'Hide Archived' : 'Show Archived'}
          </button>
        </div>
      )}

      {/* Task list */}
      {currentlyLoading ? (
        <TaskSkeletons />
      ) : displayTasks.length === 0 ? (
        <p className="text-sm text-gray-400 py-8 text-center">
          {showArchived
            ? 'No archived tasks found.'
            : 'No tasks match your search.'}
        </p>
      ) : showArchived ? (
        <div className="flex flex-col gap-2 pb-24">
          {displayTasks.map((task) => (
            <ArchivedTaskCard
              key={task.id}
              task={task}
              onRestore={() => handleRestoreTask(task.id)}
            />
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-2 pb-24">
          {displayTasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              currentUserRole={currentUser.role}
              onUpdate={() => { setSelectedTask(task); setShowUpdate(true); }}
              onView={() => { setSelectedTask(task); setShowDetail(true); }}
            />
          ))}
        </div>
      )}

      {/* ── Site Tasks section ────────────────────────────────────────────── */}
      {/* Shown when the current user has site tasks assigned to them.       */}
      {/* Sits below the v2.1 task list so existing views are unchanged.     */}
      {!showArchived && assignedSiteTasks.length > 0 && (
        <div className="flex flex-col gap-2 pb-2">
          <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
            Site Tasks
          </h3>
          {assignedSiteTasks.map((task) => (
            <SiteTaskCard
              key={task.id}
              task={task}
              onUpdate={() => setSelectedSiteTask(task)}
            />
          ))}
        </div>
      )}

      {/* Floating "+ New Task" — admin only, not shown in archive view */}
      {currentUser.role === 'admin' && !showArchived && (
        <button
          onClick={() => { setCreateModalInitialData(undefined); setShowCreate(true); }}
          className="fixed bottom-20 right-4 md:bottom-6 z-30 flex items-center gap-1.5 rounded-full bg-brand-blue px-4 py-2.5 text-sm font-semibold text-white shadow-lg hover:bg-brand-navy active:scale-95 transition-all"
          aria-label="New task"
        >
          <Plus className="h-4 w-4" />
          New Task
        </button>
      )}

      {/* Modals / Drawers */}
      <CreateTaskModal
        open={showCreate}
        initialData={createModalInitialData}
        onClose={() => {
          setShowCreate(false);
          setCreateModalInitialData(undefined);
        }}
      />
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

      {/* Site task update drawer — field engineer's submission flow */}
      {selectedSiteTask && (
        <UpdateSiteTaskDrawer
          task={selectedSiteTask}
          open={!!selectedSiteTask}
          onClose={() => setSelectedSiteTask(null)}
        />
      )}
    </div>
  );
}
