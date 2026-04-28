import { TaskCard } from '@/components/tasks/TaskCard';
import type { Task, UserRole } from '@/types';

interface RecentTasksListProps {
  tasks: Task[];
  currentUserRole: UserRole;
  onUpdate?: (task: Task) => void;
  onView?: (task: Task) => void;
}

export function RecentTasksList({
  tasks,
  currentUserRole,
  onUpdate,
  onView,
}: RecentTasksListProps) {
  const recent = tasks.slice(0, 10);

  return (
    <div>
      <h3 className="text-base font-semibold text-gray-900 mb-3">Recent Tasks</h3>
      {recent.length === 0 ? (
        <p className="text-sm text-gray-400 py-4 text-center">No tasks yet.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {recent.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              currentUserRole={currentUserRole}
              onUpdate={onUpdate ? () => onUpdate(task) : undefined}
              onView={onView ? () => onView(task) : undefined}
            />
          ))}
        </div>
      )}
    </div>
  );
}
