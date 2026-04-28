import { useTaskStore } from '@/store/taskStore';
import type { TaskStats } from '@/types';

export function useRealtimeStats(): TaskStats {
  const tasks = useTaskStore((s) => s.tasks);

  return {
    all:         tasks.length,
    pending:     tasks.filter((t) => t.status === 'pending').length,
    in_progress: tasks.filter((t) => t.status === 'in_progress').length,
    completed:   tasks.filter((t) => t.status === 'completed').length,
    blocked:     tasks.filter((t) => t.status === 'blocked').length,
  };
}
