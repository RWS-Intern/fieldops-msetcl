import { cn } from '@/lib/utils';
import type { TaskType } from '@/types';

const STATIC_FILTERS = [
  { key: 'all',         label: 'All' },
  { key: 'pending',     label: 'Pending' },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'completed',   label: 'Completed' },
  { key: 'blocked',     label: 'Blocked' },
];

interface FilterPillsProps {
  activeFilter: string;
  onFilterChange: (filter: string) => void;
  taskTypes: TaskType[];
}

export function FilterPills({ activeFilter, onFilterChange, taskTypes }: FilterPillsProps) {
  const typeFilters = taskTypes.map((t) => ({ key: t.id, label: t.typeLabel }));
  const allFilters = [...STATIC_FILTERS, ...typeFilters];

  return (
    <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none" style={{ scrollbarWidth: 'none' }}>
      {allFilters.map(({ key, label }) => (
        <button
          key={key}
          onClick={() => onFilterChange(key)}
          className={cn(
            'shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors whitespace-nowrap',
            activeFilter === key
              ? 'bg-brand-blue text-white'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
