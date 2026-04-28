import type { Task, TaskStatus } from '@/types';

export function isOverdue(task: Task): boolean {
  if (task.status === 'completed') return false;
  return new Date(task.dueDate) < new Date();
}

export function getStatusLabel(status: TaskStatus): string {
  const map: Record<TaskStatus, string> = {
    pending:     'Pending',
    in_progress: 'In Progress',
    completed:   'Completed',
    blocked:     'Blocked',
  };
  return map[status];
}

export function getStatusColour(status: TaskStatus): string {
  const map: Record<TaskStatus, string> = {
    pending:     '#9CA3AF',
    in_progress: '#F4A261',
    completed:   '#2A9D8F',
    blocked:     '#E63946',
  };
  return map[status];
}

export function getTypeColour(typeId: string): string {
  const map: Record<string, string> = {
    new_config:          '#0077B6',
    solar_feeder:        '#F59E0B',
    ea_rectification:    '#E63946',
    routine_maintenance: '#2A9D8F',
  };
  return map[typeId] ?? '#6B7280';
}

export function formatDate(date: Date): string {
  return date.toLocaleDateString('en-GB', {
    day:   '2-digit',
    month: 'short',
    year:  'numeric',
  });
}

export function formatDateTime(date: Date): string {
  return date.toLocaleString('en-GB', {
    day:    '2-digit',
    month:  'short',
    year:   'numeric',
    hour:   '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}
