import { MapPin, Folder } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useAuthStore } from '@/store/authStore';
import type { Task, UserRole } from '@/types';

const TYPE_COLOURS: Record<string, string> = {
  new_config:          '#0077B6',
  solar_feeder:        '#F59E0B',
  ea_rectification:    '#E63946',
  routine_maintenance: '#2A9D8F',
};

const TYPE_LABELS: Record<string, string> = {
  new_config:          'New Config',
  solar_feeder:        'Solar Feeder',
  ea_rectification:    'EA Rectification',
  routine_maintenance: 'Routine Maint.',
};

const STATUS_STYLES: Record<string, string> = {
  pending:     'bg-gray-100 text-gray-600',
  in_progress: 'bg-amber-50 text-amber-700',
  completed:   'bg-green-50 text-green-700',
  blocked:     'bg-red-50 text-red-700',
};

const STATUS_LABELS: Record<string, string> = {
  pending:     'Pending',
  in_progress: 'In Progress',
  completed:   'Completed',
  blocked:     'Blocked',
};

function isOverdue(task: Task): boolean {
  if (task.status === 'completed') return false;
  return task.dueDate < new Date();
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-GB', {
    day:   '2-digit',
    month: 'short',
    year:  'numeric',
  });
}

interface TaskCardProps {
  task: Task;
  currentUserRole: UserRole;
  onUpdate?: () => void;
  onView?: () => void;
}

export function TaskCard({ task, currentUserRole, onUpdate, onView }: TaskCardProps) {
  const { currentUser } = useAuthStore();
  const colour = TYPE_COLOURS[task.type] ?? '#6B7280';
  const overdue = isOverdue(task);

  const showUpdate =
    currentUserRole === 'field' &&
    task.assignedTo === currentUser?.uid &&
    task.status !== 'completed';

  const showView = currentUserRole === 'admin';

  return (
    <Card className="overflow-hidden border-0 shadow-sm">
      <div className="flex">
        {/* Left colour stripe */}
        <div className="w-1 shrink-0" style={{ backgroundColor: colour }} />

        <div className="flex-1 p-3 min-w-0">
          {/* Task number + site code */}
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-mono text-gray-400">{task.taskNum}</span>
            {task.siteCode && (
              <span className="text-xs text-gray-400">· {task.siteCode}</span>
            )}
            {(task.location || overdue) && (
              <div className="flex items-center gap-2 ml-auto shrink-0">
                {task.location && <MapPin className="h-3 w-3 text-gray-400" />}
                {overdue && (
                  <span className="text-xs font-semibold text-brand-red">Overdue</span>
                )}
              </div>
            )}
          </div>

          {/* Project label — shown only when task is linked to a project */}
          {task.projectNum && (
            <div className="flex items-center gap-1 mb-0.5">
              <Folder className="h-3 w-3 text-brand-blue/70 shrink-0" />
              <span className="text-[11px] font-medium text-brand-blue/80 leading-none">
                {task.projectNum}
                {task.projectTitle ? ` · ${task.projectTitle}` : ''}
              </span>
            </div>
          )}

          {/* Title */}
          <h3 className="text-sm font-semibold text-gray-900 leading-snug line-clamp-1">
            {task.title}
          </h3>

          {/* Description */}
          {task.description && (
            <p className="text-xs text-gray-500 mt-0.5 line-clamp-2 leading-relaxed">
              {task.description}
            </p>
          )}

          {/* Type chip + assignee */}
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <span
              className="text-xs font-medium px-1.5 py-0.5 rounded text-white"
              style={{ backgroundColor: colour }}
            >
              {TYPE_LABELS[task.type] ?? task.type}
            </span>
            <span className="text-xs text-gray-500">{task.assignedToName}</span>
          </div>

          {/* Due date + status */}
          <div className="flex items-center justify-between mt-2 gap-2 flex-wrap">
            <span className="text-xs text-gray-500">
              Due {formatDate(task.dueDate)}
            </span>
            <span
              className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_STYLES[task.status] ?? STATUS_STYLES['pending']}`}
            >
              {STATUS_LABELS[task.status] ?? task.status}
            </span>
          </div>

          {/* Blocked reason */}
          {task.status === 'blocked' && task.blockedReason && (
            <p className="mt-1.5 text-xs text-brand-red bg-red-50 rounded px-2 py-1">
              {task.blockedReason}
            </p>
          )}

          {/* Action buttons */}
          {(showUpdate || showView) && (
            <div className="flex justify-end mt-2">
              {showUpdate && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={onUpdate}
                >
                  Update
                </Button>
              )}
              {showView && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={onView}
                >
                  View
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
