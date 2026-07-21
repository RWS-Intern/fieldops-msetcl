import { Button }             from '@/components/ui/button';
import type { SiteTask, TaskStatus } from '@/types';

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_BADGE: Record<TaskStatus, string> = {
  pending:           'bg-gray-100 text-gray-600',
  in_progress:       'bg-amber-50 text-amber-700',
  pending_approval:  'bg-violet-50 text-violet-700',
  changes_requested: 'bg-orange-50 text-orange-700',
  completed:         'bg-green-50 text-green-700',
  blocked:           'bg-red-50 text-red-700',
};

const STATUS_LABELS: Record<TaskStatus, string> = {
  pending:           'Pending',
  in_progress:       'In Progress',
  pending_approval:  'Pending Approval',
  changes_requested: 'Changes Requested',
  completed:         'Completed',
  blocked:           'Blocked',
};

// ─── Props ────────────────────────────────────────────────────────────────────

interface SiteTaskCardProps {
  task:     SiteTask;
  /** Opens the field-engineer Update drawer for this task. */
  onUpdate: () => void;
  /** Overrides the footer button label (defaults to Update/View). */
  actionLabel?: string;
}

// ─── Component ────────────────────────────────────────────────────────────────
//
// Layout (per SRS §7.2 + Build Plan Phase F):
//
//   [colour stripe] │ SUB-PUNE-047 · Pune        ← Line 1: siteCode + city (prominent)
//                   │ IoT Substation              ← Line 2: projectName (muted)
//                   │ Solar Addition              ← Line 3: taskLabel (bold)
//                   │ [In Progress]  Due 25 Apr   ← Line 4: status badge + due date
//                   │                  [Update]   ← Footer: action button

export function SiteTaskCard({ task, onUpdate, actionLabel }: SiteTaskCardProps) {
  return (
    <div
      className="flex rounded-lg border border-gray-100 bg-white shadow-sm overflow-hidden cursor-pointer hover:border-brand-blue transition-colors"
      onClick={onUpdate}
    >
      {/* Left colour stripe — taskColour from project template */}
      <div className="w-1.5 shrink-0" style={{ backgroundColor: task.taskColour }} />

      <div className="flex-1 p-3 min-w-0">

        {/* Line 1 — site code · city (prominent) */}
        <p className="text-sm font-bold text-gray-900 font-mono leading-snug">
          {task.siteCode}
          <span className="font-normal text-gray-500 mx-1">·</span>
          {task.city}
        </p>

        {/* Line 2 — project name (muted) */}
        <p className="text-xs text-gray-400 mt-0.5 leading-snug">
          {task.projectName}
        </p>

        {/* Line 3 — task label (bold) */}
        <p className="text-sm font-semibold text-gray-800 mt-1 leading-snug">
          {task.taskLabel}
        </p>

        {/* Line 4 — status badge + due date */}
        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
          <span
            className={`text-xs font-medium px-2 py-0.5 rounded-full shrink-0 ${STATUS_BADGE[task.status]}`}
          >
            {STATUS_LABELS[task.status]}
          </span>
          {task.dueDate && (
            <span className="text-xs text-gray-400">
              Due{' '}
              {task.dueDate.toLocaleDateString('en-GB', {
                day: '2-digit', month: 'short', year: 'numeric',
              })}
            </span>
          )}
        </div>

        {/* Footer — action button */}
        <div className="flex justify-end mt-2">
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs px-3 shrink-0"
          >
            {actionLabel ?? (task.status === 'completed' ? 'View' : 'Update')}
          </Button>
        </div>

      </div>
    </div>
  );
}
