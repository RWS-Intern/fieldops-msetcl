import { useState, useEffect } from 'react';
import {
  collection,
  query,
  where,
  getDocs,
  doc,
  getDoc,
} from 'firebase/firestore';
import { Plus, ChevronRight, Archive } from 'lucide-react';
import { db } from '@/firebase/config';
import { useAuthStore } from '@/store/authStore';
import { useToast } from '@/components/ui/toast';
import { archiveProject } from '@/hooks/useProjectActions';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  formatDate,
  formatDateTime,
  getStatusColour,
  getStatusLabel,
  getTypeColour,
} from '@/lib/taskUtils';
import { TaskDetailDrawer } from '@/components/tasks/TaskDetailDrawer';
import type { Project, ProjectStatus, Task, TaskStatus, CollectionType } from '@/types';

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_STRIPE: Record<ProjectStatus, string> = {
  pending:     '#9CA3AF',
  in_progress: '#F4A261',
  completed:   '#2A9D8F',
  blocked:     '#E63946',
};

const STATUS_BADGE_CLASS: Record<ProjectStatus, string> = {
  pending:     'bg-gray-100 text-gray-600',
  in_progress: 'bg-amber-50 text-amber-700',
  completed:   'bg-teal-50 text-teal-700',
  blocked:     'bg-red-50 text-red-700',
};

const STATUS_LABELS: Record<ProjectStatus, string> = {
  pending:     'Pending',
  in_progress: 'In Progress',
  completed:   'Completed',
  blocked:     'Blocked',
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function MetaRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-1.5 border-b border-gray-50 last:border-0">
      <span className="text-xs text-gray-500 shrink-0">{label}</span>
      <span className="text-xs text-gray-800 text-right">{value}</span>
    </div>
  );
}

function TaskStatusBadge({ status }: { status: TaskStatus }) {
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold text-white shrink-0"
      style={{ backgroundColor: getStatusColour(status) }}
    >
      {getStatusLabel(status)}
    </span>
  );
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface ProjectDetailDrawerProps {
  project:      Project;
  open:         boolean;
  onClose:      () => void;
  onAddTask?:   () => void;
  refreshKey?:  number;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ProjectDetailDrawer({
  project,
  open,
  onClose,
  onAddTask,
  refreshKey = 0,
}: ProjectDetailDrawerProps) {
  const { currentUser } = useAuthStore();
  const { showToast }   = useToast();

  const [creatorName, setCreatorName]   = useState<string>('—');
  const [drawerTasks, setDrawerTasks]   = useState<Task[]>([]);
  const [loadingTasks, setLoadingTasks] = useState(false);

  // Task detail drill-down
  const [selectedTask, setSelectedTask]     = useState<Task | null>(null);
  const [showTaskDetail, setShowTaskDetail] = useState(false);

  // Archive confirmation
  const [archiveConfirm, setArchiveConfirm] = useState(false);
  const [archiving, setArchiving]           = useState(false);

  // Overdue check
  const isOverdue =
    project.status !== 'completed' && project.dueDate < new Date();

  // Progress
  const completedCount = project.completedTaskCount;
  const totalCount     = project.taskCount;
  const pct = totalCount > 0
    ? Math.round((completedCount / totalCount) * 100)
    : 0;

  // ── Creator name ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!open || !project.createdBy) return;
    getDoc(doc(db, 'users', project.createdBy))
      .then((snap) => {
        if (snap.exists()) setCreatorName((snap.data()['name'] as string) ?? '—');
      })
      .catch(() => {});
  }, [open, project.createdBy]);

  // ── Task list fetch ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!open || !project?.id) return;

    setLoadingTasks(true);
    setDrawerTasks([]);

    const fetchTasks = async () => {
      try {
        const q = query(
          collection(db, 'tasks'),
          where('projectId', '==', project.id)
        );
        const snap = await getDocs(q);

        if (snap.empty) {
          console.log('[ProjectDetailDrawer] No tasks found for projectId:', project.id);
        }

        const loaded: Task[] = snap.docs.map((d) => {
          const data = d.data();
          return {
            id:               d.id,
            taskNum:          (data['taskNum']          as string)      ?? '',
            title:            (data['title']            as string)      ?? '',
            type:             (data['type']             as string)      ?? '',
            description:      (data['description']      as string)      ?? '',
            assignedTo:       (data['assignedTo']       as string)      ?? '',
            assignedToName:   (data['assignedToName']   as string)      ?? '',
            createdBy:        (data['createdBy']        as string)      ?? '',
            siteCode:         (data['siteCode']         as string)      ?? '',
            startDate:        data['startDate']?.toDate?.()             ?? new Date(),
            dueDate:          data['dueDate']?.toDate?.()               ?? new Date(),
            status:           (data['status']           as TaskStatus)  ?? 'pending',
            blockedReason:    (data['blockedReason']    as string|null) ?? null,
            location:         (data['location'] as { lat: number; lng: number } | null) ?? null,
            subtaskAnswers:   (data['subtaskAnswers']   as Record<string, { value: string; type: CollectionType }>) ?? {},
            subtaskPhotos:    (data['subtaskPhotos']    as Record<string, string[]>)     ?? {},
            completionPhotos: (data['completionPhotos'] as string[])                     ?? [],
            createdAt:        data['createdAt']?.toDate?.()             ?? new Date(),
            updatedAt:        data['updatedAt']?.toDate?.()             ?? new Date(),
            submittedBy:      (data['submittedBy']      as string)      ?? undefined,
            submittedByName:  (data['submittedByName']  as string)      ?? undefined,
            submittedAt:      data['submittedAt']?.toDate?.()           ?? undefined,
            projectId:        (data['projectId']        as string|null) ?? null,
            projectTitle:     (data['projectTitle']     as string|null) ?? null,
            projectNum:       (data['projectNum']       as string|null) ?? null,
          };
        });

        // Sort client-side by taskNum so order is deterministic without an index
        loaded.sort((a, b) => a.taskNum.localeCompare(b.taskNum));
        setDrawerTasks(loaded);
      } catch (err) {
        console.error('[ProjectDetailDrawer] Error fetching tasks:', err);
        setDrawerTasks([]);
      } finally {
        setLoadingTasks(false);
      }
    };

    fetchTasks();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, project?.id, project?.completedTaskCount, project?.taskCount, project?.status, refreshKey]);

  // ── Reset on close ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!open) {
      setCreatorName('—');
      setDrawerTasks([]);
      setArchiveConfirm(false);
    }
  }, [open]);

  const blockedTasks  = drawerTasks.filter((t) => t.status === 'blocked');
  const stripeColour  = STATUS_STRIPE[project.status] ?? '#9CA3AF';

  async function handleArchiveProject() {
    setArchiving(true);
    try {
      await archiveProject(project.id, true);
      showToast('Project archived', 'success');
      onClose();
    } catch {
      showToast('Failed to archive project', 'error');
    } finally {
      setArchiving(false);
    }
  }

  return (
    <>
      <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
        <SheetContent
          side="right"
          className="flex flex-col w-full md:max-w-[520px] p-0 overflow-y-auto"
          aria-describedby={undefined}
        >
          {/* ── Header ── */}
          <SheetHeader className="p-5 pb-4 border-b border-gray-100 shrink-0">
            {/* Status colour accent strip at very top */}
            <div
              className="absolute top-0 left-0 right-0 h-1"
              style={{ backgroundColor: stripeColour }}
            />

            <p className="text-xs font-mono text-gray-400 mt-1">{project.projectNum}</p>

            <SheetTitle className="pr-8 text-lg leading-snug">
              {project.title}
            </SheetTitle>

            <div className="flex items-center gap-2 flex-wrap">
              <span
                className={`text-xs font-semibold px-2.5 py-1 rounded-full ${STATUS_BADGE_CLASS[project.status]}`}
              >
                {STATUS_LABELS[project.status]}
              </span>
              {project.siteCode && (
                <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
                  {project.siteCode}
                </span>
              )}
              {isOverdue && (
                <span className="text-xs font-semibold text-red-600">
                  ⚠ Overdue
                </span>
              )}
            </div>

            {/* Archive action — admin only */}
            {currentUser?.role === 'admin' && (
              <div className="mt-1">
                {!archiveConfirm ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs gap-1.5 text-gray-500 hover:text-gray-700"
                    onClick={() => setArchiveConfirm(true)}
                  >
                    <Archive className="h-3 w-3" />
                    Archive
                  </Button>
                ) : (
                  <div className="flex flex-col gap-2 pt-1">
                    <p className="text-xs text-gray-600">
                      Archive this project? All tasks in this project will remain
                      but the project will be hidden.
                    </p>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1 h-7 text-xs"
                        onClick={() => setArchiveConfirm(false)}
                        disabled={archiving}
                      >
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        className="flex-1 h-7 text-xs bg-gray-600 hover:bg-gray-700"
                        onClick={handleArchiveProject}
                        disabled={archiving}
                      >
                        {archiving ? 'Archiving…' : 'Archive'}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </SheetHeader>

          {/* ── Scrollable body ── */}
          <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-5">

            {/* ── Metadata grid ── */}
            <div className="rounded-lg border border-gray-100 bg-white p-3">
              <MetaRow label="Type"       value="Project" />
              <MetaRow label="Site Code"  value={project.siteCode || '—'} />
              <MetaRow
                label="Assigned To"
                value={
                  project.assignedToNames.length > 0
                    ? project.assignedToNames.join(', ')
                    : '—'
                }
              />
              <MetaRow label="Created By" value={creatorName} />
              <MetaRow label="Start Date" value={formatDate(project.startDate)} />
              <MetaRow
                label="Due Date"
                value={
                  <span className={isOverdue ? 'text-red-600 font-semibold' : ''}>
                    {formatDate(project.dueDate)}
                    {isOverdue && ' · Overdue'}
                  </span>
                }
              />
              <MetaRow label="Created At" value={formatDateTime(project.createdAt)} />
            </div>

            {/* ── Progress ── */}
            <div className="rounded-lg border border-gray-100 bg-white p-3">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
                Progress
              </p>
              {totalCount === 0 ? (
                <p className="text-xs text-gray-400">No tasks added yet.</p>
              ) : (
                <>
                  <div className="h-3 w-full rounded-full bg-gray-100 overflow-hidden mb-2">
                    <div
                      className="h-full rounded-full bg-green-500 transition-all duration-500"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <p className="text-xs text-gray-600">
                    <span className="font-semibold">{completedCount}</span>
                    {' '}of{' '}
                    <span className="font-semibold">{totalCount}</span>
                    {' '}tasks completed{' '}
                    <span className="text-gray-400">({pct}%)</span>
                  </p>
                </>
              )}
            </div>

            {/* ── Tasks ── */}
            <div>
              <div className="flex items-center justify-between gap-2 mb-2">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold text-gray-700">Tasks</p>
                  <span className="rounded-full bg-gray-100 text-gray-600 text-xs font-semibold px-2 py-0.5">
                    {loadingTasks ? '…' : drawerTasks.length}
                  </span>
                </div>
                {onAddTask && (
                  <button
                    type="button"
                    onClick={onAddTask}
                    className="flex items-center gap-1 text-xs font-medium text-brand-blue hover:text-brand-blue/80 transition-colors"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add Task
                  </button>
                )}
              </div>

              {loadingTasks ? (
                <div className="flex flex-col gap-2">
                  <Skeleton className="h-14 rounded-lg" />
                  <Skeleton className="h-14 rounded-lg" />
                  <Skeleton className="h-14 rounded-lg" />
                </div>
              ) : drawerTasks.length === 0 ? (
                <p className="text-xs text-gray-400 leading-relaxed">
                  No tasks linked to this project yet.{' '}
                  {onAddTask ? (
                    <>
                      Click{' '}
                      <button
                        type="button"
                        className="text-brand-blue underline"
                        onClick={onAddTask}
                      >
                        Add Task
                      </button>
                      {' '}above, or create tasks from the Tasks page and link them to this project.
                    </>
                  ) : (
                    'Create tasks from the Tasks page and link them to this project.'
                  )}
                </p>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {drawerTasks.map((t) => {
                    const typeColour  = getTypeColour(t.type);
                    const taskOverdue = t.status !== 'completed' && t.dueDate < new Date();
                    return (
                      <div
                        key={t.id}
                        role="button"
                        tabIndex={0}
                        className="flex overflow-hidden rounded-lg border border-gray-100 bg-white cursor-pointer hover:bg-gray-50 transition-colors"
                        onClick={() => {
                          setSelectedTask(t);
                          setShowTaskDetail(true);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setSelectedTask(t);
                            setShowTaskDetail(true);
                          }
                        }}
                      >
                        {/* Left type-colour stripe */}
                        <div
                          className="w-1 shrink-0"
                          style={{ backgroundColor: typeColour }}
                        />
                        <div className="flex-1 p-2.5 min-w-0">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <span className="text-xs font-mono text-gray-400">
                                {t.taskNum}
                              </span>
                              <p className="text-xs font-medium text-gray-800 leading-snug line-clamp-1">
                                {t.title}
                              </p>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <TaskStatusBadge status={t.status} />
                              <ChevronRight className="h-3.5 w-3.5 text-gray-300" />
                            </div>
                          </div>
                          <div className="flex items-center gap-3 mt-1">
                            <span className="text-xs text-gray-400">
                              {t.assignedToName}
                            </span>
                            <span
                              className={`text-xs ${taskOverdue ? 'text-red-500 font-medium' : 'text-gray-400'}`}
                            >
                              Due {formatDate(t.dueDate)}
                              {taskOverdue ? ' · Overdue' : ''}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Add Task button at bottom — also shown when tasks exist */}
              {onAddTask && drawerTasks.length > 0 && (
                <button
                  type="button"
                  onClick={onAddTask}
                  className="mt-2 w-full flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-brand-blue/40 py-2 text-xs font-medium text-brand-blue hover:bg-brand-blue/5 transition-colors"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add Task to Project
                </button>
              )}
            </div>

            {/* ── Blocked tasks panel ── */}
            {blockedTasks.length > 0 && (
              <div className="rounded-lg bg-red-50 border border-red-100 p-3">
                <p className="text-xs font-semibold text-red-700 mb-2">
                  ⚠ {blockedTasks.length} task{blockedTasks.length !== 1 ? 's' : ''} blocked
                </p>
                <div className="flex flex-col gap-2">
                  {blockedTasks.map((t) => (
                    <div key={t.id} className="flex flex-col gap-0.5">
                      <p className="text-xs font-medium text-gray-800">
                        {t.taskNum} — {t.title}
                      </p>
                      {t.blockedReason ? (
                        <p className="text-xs text-gray-600 bg-white/60 rounded px-2 py-1">
                          {t.blockedReason}
                        </p>
                      ) : (
                        <p className="text-xs text-gray-400 italic">
                          No reason provided
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

          </div>
        </SheetContent>
      </Sheet>

      {/* Task detail drill-down — renders on top of this drawer */}
      {selectedTask && (
        <TaskDetailDrawer
          task={selectedTask}
          open={showTaskDetail}
          onClose={() => {
            setShowTaskDetail(false);
            setSelectedTask(null);
          }}
        />
      )}
    </>
  );
}
