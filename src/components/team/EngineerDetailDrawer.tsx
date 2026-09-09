/**
 * EngineerDetailDrawer
 *
 * Right-side sheet showing a field engineer's profile and all their assigned
 * site tasks grouped by site. Admins can:
 *  - Click a task row to open SiteTaskDetailDrawer for full task management
 *  - Unassign the engineer from any task (with inline confirmation)
 *
 * Uses useEngineerTasks which maintains a real-time Firestore listener, so
 * tasks disappear from the list the instant they are unassigned.
 */
import { useState, useMemo } from 'react';
import {
  doc,
  updateDoc,
  serverTimestamp,
} from 'firebase/firestore';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button }   from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { db }                     from '@/firebase/config';
import { useEngineerTasks }       from '@/hooks/useEngineerTasks';
import { useToast }               from '@/components/ui/toast';
import { useAuthStore }           from '@/store/authStore';
import { SiteTaskDetailDrawer }   from '@/components/siteTasks/SiteTaskDetailDrawer';
import type { User, SiteTask, TaskStatus } from '@/types';

// ─── Constants ────────────────────────────────────────────────────────────────

const TASK_STATUS_BADGE: Record<TaskStatus, string> = {
  pending:           'bg-gray-100 text-gray-600',
  in_progress:       'bg-amber-50 text-amber-700',
  pending_approval:  'bg-violet-50 text-violet-700',
  changes_requested: 'bg-orange-50 text-orange-700',
  completed:         'bg-green-50 text-green-700',
  blocked:           'bg-red-50 text-red-700',
};

const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  pending:           'Pending',
  in_progress:       'In Progress',
  pending_approval:  'Pending Approval',
  changes_requested: 'Changes Requested',
  completed:         'Completed',
  blocked:           'Blocked',
};

// ─── TaskRow ──────────────────────────────────────────────────────────────────

interface TaskRowProps {
  task:              SiteTask;
  engineerName:      string;
  /** False for a read-only viewer — Unassign is not rendered. */
  canUnassign:       boolean;
  isConfirming:      boolean;
  unassigning:       boolean;
  onView:            () => void;
  onRequestUnassign: () => void;
  onCancelUnassign:  () => void;
  onConfirmUnassign: () => void;
}

function TaskRow({
  task,
  engineerName,
  canUnassign,
  isConfirming,
  unassigning,
  onView,
  onRequestUnassign,
  onCancelUnassign,
  onConfirmUnassign,
}: TaskRowProps) {
  return (
    <div className="rounded-lg border border-gray-100 overflow-hidden">
      <div className="flex">
        {/* Colour stripe */}
        <div className="w-1 shrink-0" style={{ backgroundColor: task.taskColour }} />

        <div className="flex-1 p-2.5 min-w-0">
          {/* Label + status badge — clicking opens task detail */}
          <div
            className="flex items-center justify-between gap-2 flex-wrap cursor-pointer group"
            onClick={onView}
          >
            <span className="text-sm font-medium text-gray-900 leading-snug group-hover:text-brand-blue transition-colors">
              {task.taskLabel}
            </span>
            <span
              className={`text-xs font-medium px-2 py-0.5 rounded-full shrink-0 ${TASK_STATUS_BADGE[task.status]}`}
            >
              {TASK_STATUS_LABELS[task.status]}
            </span>
          </div>

          {/* taskKey in mono */}
          <span className="text-xs text-gray-400 font-mono mt-0.5 block">
            {task.taskKey}
          </span>

          {/* Due date */}
          {task.dueDate && (
            <p className="text-xs text-gray-400 mt-0.5">
              Due{' '}
              {task.dueDate.toLocaleDateString('en-GB', {
                day: '2-digit', month: 'short', year: 'numeric',
              })}
            </p>
          )}

          {/* Unassign button OR inline confirmation — admin only */}
          {!canUnassign ? null : !isConfirming ? (
            <div className="flex justify-end mt-2">
              <Button
                variant="outline"
                size="sm"
                className="h-6 text-xs px-2 text-gray-500 border-gray-200 hover:border-red-200 hover:text-red-500"
                onClick={(e) => { e.stopPropagation(); onRequestUnassign(); }}
              >
                Unassign
              </Button>
            </div>
          ) : (
            <div className="mt-2 rounded-md bg-gray-50 border border-gray-200 p-2">
              <p className="text-xs text-gray-600 mb-2">
                Unassign <span className="font-semibold">{engineerName}</span> from this task?
              </p>
              <div className="flex gap-1.5">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 text-xs px-2 flex-1"
                  onClick={onCancelUnassign}
                  disabled={unassigning}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  className="h-6 text-xs px-2 flex-1 bg-gray-700 hover:bg-gray-800 text-white border-0"
                  onClick={onConfirmUnassign}
                  disabled={unassigning}
                >
                  {unassigning ? 'Removing…' : 'Confirm'}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface EngineerDetailDrawerProps {
  engineer: User | null;   // null = closed
  open:     boolean;
  onClose:  () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function EngineerDetailDrawer({
  engineer,
  open,
  onClose,
}: EngineerDetailDrawerProps) {
  const { showToast }   = useToast();
  const { currentUser } = useAuthStore();

  // A viewer sees the engineer's full task list but cannot unassign them, and
  // gets the task drawer read-only.
  const canManage = currentUser?.role === 'admin';

  // Only subscribe when the drawer is open and we have an engineer
  const { tasks, loading } = useEngineerTasks(
    open && engineer ? engineer.id : ''
  );

  // Task detail drawer (stacks on top of this sheet)
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const selectedTask = tasks.find((t) => t.id === selectedTaskId) ?? null;

  // Unassign confirmation: which task is waiting for confirmation
  const [unassignTaskId, setUnassignTaskId]   = useState<string | null>(null);
  const [unassigning,     setUnassigning]     = useState(false);

  // ── Group tasks by siteCode, sorted alphabetically ───────────────────────
  const tasksBySite = useMemo(() => {
    const groups = new Map<
      string,
      { siteCode: string; siteName: string; tasks: SiteTask[] }
    >();

    for (const task of tasks) {
      if (!groups.has(task.siteCode)) {
        groups.set(task.siteCode, {
          siteCode: task.siteCode,
          siteName: task.siteName,
          tasks:    [],
        });
      }
      groups.get(task.siteCode)!.tasks.push(task);
    }

    return [...groups.values()].sort((a, b) =>
      a.siteCode.localeCompare(b.siteCode)
    );
  }, [tasks]);

  // ── Unassign ─────────────────────────────────────────────────────────────
  async function handleUnassign(task: SiteTask) {
    setUnassigning(true);
    try {
      await updateDoc(doc(db, 'siteTasks', task.id), {
        assignedTo:     null,
        assignedToName: null,
        assignedToCode: null,
        updatedAt:      serverTimestamp(),
      });
      setUnassignTaskId(null);
      showToast('Engineer unassigned', 'success');
    } catch {
      showToast('Failed to unassign — try again', 'error');
    } finally {
      setUnassigning(false);
    }
  }

  // ── Stats (derived from tasks) ────────────────────────────────────────────
  const completedCount = tasks.filter((t) => t.status === 'completed').length;
  const completionPct  = tasks.length > 0
    ? Math.round((completedCount / tasks.length) * 100)
    : 0;

  return (
    <>
      <Sheet open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
        <SheetContent
          side="right"
          className="flex flex-col w-full md:max-w-[480px] p-0 overflow-hidden"
          aria-describedby={undefined}
        >
          {/* ── Header ── */}
          <SheetHeader className="p-5 pb-4 border-b border-gray-100 shrink-0">
            <div className="flex items-center gap-3 mt-1">
              {/* Avatar */}
              <div className="h-11 w-11 rounded-full bg-teal-600 flex items-center justify-center text-white font-bold text-base shrink-0">
                {engineer?.name.trim().charAt(0).toUpperCase() ?? '?'}
              </div>

              <div className="min-w-0 flex-1">
                <SheetTitle className="text-base leading-snug">
                  {engineer?.name}
                </SheetTitle>

                {/* Badges */}
                <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                  {engineer?.engineerCode && (
                    <span className="text-xs font-mono font-semibold text-teal-700 bg-teal-50 rounded px-1.5 py-0.5">
                      {engineer.engineerCode}
                    </span>
                  )}
                  <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-teal-100 text-teal-700">
                    Field Expert
                  </span>
                  {engineer && !engineer.active && (
                    <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-red-50 text-red-600">
                      Disabled
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Email */}
            {engineer?.email && (
              <p className="text-xs text-gray-500 mt-1">{engineer.email}</p>
            )}

            {/* Stats summary */}
            {!loading && tasks.length > 0 && (
              <p className="text-xs text-gray-400 mt-1">
                <span className="font-medium text-gray-600">{tasks.length}</span> assigned
                {' · '}
                <span className="font-medium text-gray-600">{completedCount}</span> completed
                {' · '}
                <span className="font-medium text-gray-600">{completionPct}%</span>
              </p>
            )}
          </SheetHeader>

          {/* ── Scrollable body ── */}
          <div className="flex-1 overflow-y-auto px-5 py-4">

            {/* Assigned tasks section */}
            <div className="flex items-center gap-2 mb-3">
              <p className="text-sm font-semibold text-gray-700">Assigned Tasks</p>
              {!loading && (
                <span className="rounded-full bg-gray-100 text-gray-600 text-xs font-semibold px-2 py-0.5">
                  {tasks.length}
                </span>
              )}
            </div>

            {loading ? (
              <div className="flex flex-col gap-2">
                {[...Array(4)].map((_, i) => (
                  <Skeleton key={i} className="h-[72px] rounded-lg" />
                ))}
              </div>
            ) : tasksBySite.length === 0 ? (
              <p className="text-xs text-gray-400 text-center py-10">
                No tasks assigned to this engineer.
              </p>
            ) : (
              <div className="flex flex-col gap-5">
                {tasksBySite.map(({ siteCode, siteName, tasks: siteTasks }) => (
                  <div key={siteCode}>
                    {/* Site header */}
                    <div className="flex items-baseline gap-1.5 mb-2">
                      <span className="text-xs font-mono font-semibold text-gray-800">
                        {siteCode}
                      </span>
                      <span className="text-xs text-gray-400 truncate">
                        — {siteName}
                      </span>
                    </div>

                    {/* Task rows indented with a left border */}
                    <div className="flex flex-col gap-1.5 pl-3 border-l-2 border-gray-100">
                      {siteTasks.map((task) => (
                        <TaskRow
                          key={task.id}
                          task={task}
                          engineerName={engineer?.name ?? ''}
                          canUnassign={canManage}
                          isConfirming={unassignTaskId === task.id}
                          unassigning={unassigning && unassignTaskId === task.id}
                          onView={() => setSelectedTaskId(task.id)}
                          onRequestUnassign={() => setUnassignTaskId(task.id)}
                          onCancelUnassign={() => setUnassignTaskId(null)}
                          onConfirmUnassign={() => handleUnassign(task)}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* Task detail drawer — stacks on top of this sheet.
          readOnly for a viewer: no assignment / approver / archive controls. */}
      <SiteTaskDetailDrawer
        task={selectedTask}
        open={!!selectedTaskId}
        onClose={() => setSelectedTaskId(null)}
        readOnly={!canManage}
      />
    </>
  );
}
