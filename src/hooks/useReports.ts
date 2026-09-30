import { useMemo } from 'react';
import { useUserStore } from '@/store/userStore';
import type { SiteTask, SurveyReport } from '@/types';

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
export function useReports(siteTasks: SiteTask[], surveys: SurveyReport[] = []) {
  const { users } = useUserStore();

  /**
   * Tasks by status — doughnut chart. Counts surveys alongside site tasks,
   * so its centre total equals the Total tile.
   *
   * EVERY status has a segment. Pending Approval and Changes Requested used
   * to be missing, which meant the centre silently under-reported whenever
   * anything sat in review — the chart summed four buckets while the tile
   * counted all six. Adding work in those states (surveys routinely are)
   * made the gap obvious, but it was wrong for tasks alone too.
   *
   * One fixed segment set regardless of the Task Type filter: the labels are
   * shared wording, so 'open' joins Pending and 'approved'/'closed' join
   * Completed. Blocked stays task-only — no work order can be blocked.
   *
   * Colours match the StatCard accents on ReportsPage, so a segment and its
   * tile read as the same thing.
   */
  const byStatus = useMemo((): StatusCount[] => {
    const t = (...st: string[]) => siteTasks.filter((x) => st.includes(x.status)).length;
    const v = (...st: string[]) => surveys.filter((x) => st.includes(x.status)).length;

    return [
      { name: 'Pending',           value: t('pending') + v('open'),                        colour: '#9CA3AF' },
      { name: 'In Progress',       value: t('in_progress') + v('in_progress'),             colour: '#F4A261' },
      { name: 'Pending Approval',  value: t('pending_approval') + v('pending_approval'),   colour: '#8B5CF6' },
      { name: 'Changes Requested', value: t('changes_requested') + v('changes_requested'), colour: '#F97316' },
      { name: 'Completed',         value: t('completed') + v('approved', 'closed'),        colour: '#2A9D8F' },
      { name: 'Blocked',           value: t('blocked'),                                    colour: '#E63946' },
    ];
  }, [siteTasks, surveys]);

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

  /**
   * Summary KPI cards — site tasks PLUS surveys.
   *
   * A survey is work assigned to a field engineer just as a site task is, so
   * the headline numbers count both. Matches the My Tasks tiles on
   * DashboardPage, which fold assigned surveys in for the same reason.
   *
   * The charts above stay TASK-ONLY on purpose: "Tasks by Type" is keyed on
   * taskLabel, which a survey has no equivalent of, and the per-engineer
   * completion chart compares like with like. Only the tiles are combined.
   *
   * Status mapping, mirroring DashboardPage:
   *   approved | closed  → completed
   *   in_progress        → in progress
   *   pending_approval   → pending approval
   *   changes_requested  → changes requested
   *   open               → counted in the total only, like a pending task
   *
   * Two tiles gain nothing from surveys, and that is a property of the data,
   * not an oversight: WorkOrderStatus has no blocked state, and a survey
   * carries no due date, so neither Blocked nor Overdue can move.
   */
  const summary = useMemo(() => {
    const now = new Date();

    const taskCompleted   = siteTasks.filter((t) => t.status === 'completed').length;
    const surveyCompleted = surveys.filter(
      (s) => s.status === 'approved' || s.status === 'closed',
    ).length;

    const total     = siteTasks.length + surveys.length;
    const completed = taskCompleted + surveyCompleted;

    return {
      total,
      completed,
      inProgress:
        siteTasks.filter((t) => t.status === 'in_progress').length +
        surveys.filter((s) => s.status === 'in_progress').length,
      pendingApproval:
        siteTasks.filter((t) => t.status === 'pending_approval').length +
        surveys.filter((s) => s.status === 'pending_approval').length,
      changesRequested:
        siteTasks.filter((t) => t.status === 'changes_requested').length +
        surveys.filter((s) => s.status === 'changes_requested').length,
      blocked: siteTasks.filter((t) => t.status === 'blocked').length,
      overdue: siteTasks.filter(
        (t) => t.status !== 'completed' && t.dueDate != null && t.dueDate < now,
      ).length,
      completionRate: total > 0 ? Math.round((completed / total) * 100) : 0,
      /** How many of `total` are surveys — lets the UI explain the tiles. */
      surveyCount: surveys.length,
    };
  }, [siteTasks, surveys]);

  return { byStatus, byType, byEngineer, summary };
}
