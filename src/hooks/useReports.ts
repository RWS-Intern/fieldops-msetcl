import { useMemo } from 'react';
import { useUserStore } from '@/store/userStore';
import type { SiteTask } from '@/types';

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

/**
 * Derives chart-ready datasets from a pre-filtered array of SiteTasks.
 * The caller (ReportsPage) owns the filter logic and passes the result in;
 * this hook just computes the aggregations.
 */
export function useReports(siteTasks: SiteTask[]) {
  const { users } = useUserStore();

  // Tasks by status — doughnut chart
  const byStatus = useMemo((): StatusCount[] => [
    {
      name:   'Pending',
      value:  siteTasks.filter((t) => t.status === 'pending').length,
      colour: '#9CA3AF',
    },
    {
      name:   'In Progress',
      value:  siteTasks.filter((t) => t.status === 'in_progress').length,
      colour: '#F4A261',
    },
    {
      name:   'Completed',
      value:  siteTasks.filter((t) => t.status === 'completed').length,
      colour: '#2A9D8F',
    },
    {
      name:   'Blocked',
      value:  siteTasks.filter((t) => t.status === 'blocked').length,
      colour: '#E63946',
    },
  ], [siteTasks]);

  // Tasks by task label — bar chart
  const byType = useMemo((): TypeCount[] => {
    const counts: Record<string, { count: number; colour: string }> = {};
    siteTasks.forEach((t) => {
      const key = t.taskLabel || t.taskKey || 'Unknown';
      if (!counts[key]) {
        counts[key] = { count: 0, colour: t.taskColour || '#0077B6' };
      }
      counts[key].count++;
    });
    return Object.entries(counts)
      .map(([name, { count, colour }]) => ({ name, count, colour }))
      .sort((a, b) => b.count - a.count);
  }, [siteTasks]);

  // Completion rate per active field engineer
  const byEngineer = useMemo((): EngineerStat[] => {
    const fieldUsers = users.filter((u) => u.role === 'field' && u.active);
    return fieldUsers
      .map((user) => {
        const assigned  = siteTasks.filter((t) => t.assignedTo === user.id);
        const completed = assigned.filter((t) => t.status === 'completed').length;
        return {
          name:      user.name,
          completed,
          total:     assigned.length,
          rate:      assigned.length > 0
            ? Math.round((completed / assigned.length) * 100)
            : 0,
        };
      })
      .filter((e) => e.total > 0); // only engineers with at least one task in view
  }, [siteTasks, users]);

  // Summary KPI cards
  const summary = useMemo(() => {
    const now       = new Date();
    const completed = siteTasks.filter((t) => t.status === 'completed').length;
    return {
      total:          siteTasks.length,
      completed,
      inProgress:     siteTasks.filter((t) => t.status === 'in_progress').length,
      blocked:        siteTasks.filter((t) => t.status === 'blocked').length,
      overdue:        siteTasks.filter(
        (t) => t.status !== 'completed' && t.dueDate != null && t.dueDate < now,
      ).length,
      completionRate: siteTasks.length > 0
        ? Math.round((completed / siteTasks.length) * 100)
        : 0,
    };
  }, [siteTasks]);

  return { byStatus, byType, byEngineer, summary };
}
