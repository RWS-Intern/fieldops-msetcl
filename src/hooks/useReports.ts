import { useMemo } from 'react';
import { useTaskStore } from '@/store/taskStore';
import { useUserStore } from '@/store/userStore';

// ─── Exported types ───────────────────────────────────────────────────────────

export interface StatusCount {
  name:   string;
  value:  number;
  colour: string;
}

export interface TypeCount {
  name:   string;
  count:  number;
  colour: string;
}

export interface EngineerStat {
  name:      string;
  completed: number;
  total:     number;
  rate:      number;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useReports() {
  const { tasks } = useTaskStore();
  const { users } = useUserStore();

  // Tasks by status — used by doughnut chart
  const byStatus = useMemo((): StatusCount[] => [
    {
      name:   'Pending',
      value:  tasks.filter((t) => t.status === 'pending').length,
      colour: '#9CA3AF',
    },
    {
      name:   'In Progress',
      value:  tasks.filter((t) => t.status === 'in_progress').length,
      colour: '#F4A261',
    },
    {
      name:   'Completed',
      value:  tasks.filter((t) => t.status === 'completed').length,
      colour: '#2A9D8F',
    },
    {
      name:   'Blocked',
      value:  tasks.filter((t) => t.status === 'blocked').length,
      colour: '#E63946',
    },
  ], [tasks]);

  // Tasks by type — used by bar chart
  const byType = useMemo((): TypeCount[] => {
    const counts: Record<string, { count: number; colour: string }> = {};
    tasks.forEach((t) => {
      if (!counts[t.type]) {
        counts[t.type] = { count: 0, colour: '#0077B6' };
      }
      counts[t.type].count++;
    });
    return Object.entries(counts)
      .map(([name, { count, colour }]) => ({ name, count, colour }))
      .sort((a, b) => b.count - a.count);
  }, [tasks]);

  // Completion rate per field engineer
  const byEngineer = useMemo((): EngineerStat[] => {
    const fieldUsers = users.filter((u) => u.role === 'field' && u.active);
    return fieldUsers.map((user) => {
      const assigned  = tasks.filter((t) => t.assignedTo === user.id);
      const completed = assigned.filter((t) => t.status === 'completed').length;
      return {
        name:      user.name,
        completed,
        total:     assigned.length,
        rate:      assigned.length > 0
          ? Math.round((completed / assigned.length) * 100)
          : 0,
      };
    });
  }, [tasks, users]);

  // Summary KPI cards
  const summary = useMemo(() => {
    const now = new Date();
    const completed = tasks.filter((t) => t.status === 'completed').length;
    return {
      total:          tasks.length,
      completed,
      inProgress:     tasks.filter((t) => t.status === 'in_progress').length,
      blocked:        tasks.filter((t) => t.status === 'blocked').length,
      overdue:        tasks.filter(
        (t) => t.status !== 'completed' && t.dueDate < now,
      ).length,
      completionRate: tasks.length > 0
        ? Math.round((completed / tasks.length) * 100)
        : 0,
    };
  }, [tasks]);

  return { byStatus, byType, byEngineer, summary, tasks };
}
