import { Button }             from '@/components/ui/button';
import type { SiteTask, TaskStatus } from '@/types';

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_BADGE: Record<TaskStatus, string> = {
  pending:     'bg-gray-100 text-gray-600',
  in_progress: 'bg-amber-50 text-amber-700',
  completed:   'bg-green-50 text-green-700',
  blocked:     'bg-red-50 text-red-700',
};

const STATUS_LABELS: Record<TaskStatus, string> = {
  pending:     'Pending',
  in_progress: 'In Progress',
  completed:   'Completed',
  blocked:     'Blocked',
};

// ─── Props ────────────────────────────────────────────────────────────────────

interface SiteTaskCardProps {
  task:     SiteTask;
  /** Opens the field-engineer Update drawer for this task. */
  onUpdate: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function SiteTaskCard({ task, onUpdate }: SiteTaskCardProps) {
  return (
    <div
      className="flex rounded-lg border border-gray-100 bg-white shadow-sm overflow-hidden cursor-pointer hover:border-brand-blue transition-colors"
      onClick={onUpdate}
    >
      {/* Colour stripe */}
      <div className="w-1.5 shrink-0" style={{ backgroundColor: task.taskColour }} />

      <div className="flex-1 p-3 min-w-0">
        {/* Site code + status badge */}
        <div className="flex items-center justify-between gap-2 mb-0.5">
          <span className="text-sm font-bold text-gray-900 font-mono leading-snug">
            {task.siteCode}
          </span>
          <span
            className={`text-xs font-medium px-2 py-0.5 rounded-full shrink-0 ${STATUS_BADGE[task.status]}`}
          >
            {STATUS_LABELS[task.status]}
          </span>
        </div>

        {/* City */}
        <p className="text-xs text-gray-500">{task.city}</p>

        {/* Task label */}
        <p className="text-sm font-semibold text-gray-800 mt-1 leading-snug">
          {task.taskLabel}
        </p>

        {/* Project name */}
        <p className="text-xs text-gray-400 mt-0.5">{task.projectName}</p>

        {/* Due date + action button */}
        <div className="flex items-center justify-between mt-2 gap-2">
          {task.dueDate ? (
            <span className="text-xs text-gray-400">
              Due{' '}
              {task.dueDate.toLocaleDateString('en-GB', {
                day: '2-digit', month: 'short', year: 'numeric',
              })}
            </span>
          ) : (
            <span />
          )}
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs px-3 shrink-0"
          >
            {task.status === 'completed' ? 'View' : 'Update'}
          </Button>
        </div>
      </div>
    </div>
  );
}
