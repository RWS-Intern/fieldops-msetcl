import { ToggleLeft, Type, Hash, List, Camera } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { TaskType, CollectionType } from '@/types';

interface TaskTypeCardProps {
  taskType:        TaskType;
  onEdit:          (taskType: TaskType) => void;
  onToggleActive:  (typeId: string, active: boolean) => void;
}

// ─── Collection type icon map ─────────────────────────────────────────────────

const COLLECTION_ICONS: Record<CollectionType, React.ReactNode> = {
  yesno:      <ToggleLeft className="h-3.5 w-3.5 shrink-0 text-gray-400" />,
  text:       <Type       className="h-3.5 w-3.5 shrink-0 text-gray-400" />,
  number:     <Hash       className="h-3.5 w-3.5 shrink-0 text-gray-400" />,
  select:     <List       className="h-3.5 w-3.5 shrink-0 text-gray-400" />,
  image_only: <Camera     className="h-3.5 w-3.5 shrink-0 text-gray-400" />,
};

// ─── Component ────────────────────────────────────────────────────────────────

export function TaskTypeCard({ taskType, onEdit, onToggleActive }: TaskTypeCardProps) {
  const { id, typeLabel, colour, active, subtasks } = taskType;
  const sorted   = [...subtasks].sort((a, b) => a.sortOrder - b.sortOrder);
  const preview  = sorted.slice(0, 3);
  const overflow = sorted.length - 3;

  return (
    <div className="relative rounded-xl border border-gray-100 bg-white shadow-sm overflow-hidden">
      {/* Left colour stripe */}
      <div
        className="absolute left-0 top-0 bottom-0 w-1 rounded-l-xl"
        style={{ backgroundColor: colour }}
      />

      <div className="pl-5 pr-4 py-4 flex flex-col gap-3">
        {/* Header row */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Colour swatch */}
          <div
            className="h-4 w-4 rounded-full shrink-0 border border-black/10"
            style={{ backgroundColor: colour }}
          />
          {/* Label */}
          <span className="font-semibold text-gray-900 text-sm flex-1 min-w-0 truncate">
            {typeLabel}
          </span>
          {/* ID pill */}
          <span className="font-mono text-[10px] text-gray-400 bg-gray-50 rounded px-1.5 py-0.5 border border-gray-100 shrink-0">
            {id}
          </span>
          {/* Active badge */}
          <span className={cn(
            'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium shrink-0',
            active
              ? 'bg-green-100 text-green-700'
              : 'bg-gray-100 text-gray-500',
          )}>
            {active ? 'Active' : 'Inactive'}
          </span>
          {/* Subtask count */}
          <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-600 shrink-0">
            {subtasks.length} subtask{subtasks.length !== 1 ? 's' : ''}
          </span>
        </div>

        {/* Subtask preview */}
        {sorted.length > 0 && (
          <div className="flex flex-col gap-1">
            {preview.map((s) => (
              <div key={s.subtaskId} className="flex items-center gap-2">
                {COLLECTION_ICONS[s.collectionType]}
                <span className="text-xs text-gray-600 flex-1 truncate">{s.label}</span>
                {s.isRequired && (
                  <span className="text-[10px] font-medium text-brand-red shrink-0">
                    Required
                  </span>
                )}
              </div>
            ))}
            {overflow > 0 && (
              <p className="text-xs text-gray-400 pl-5">+ {overflow} more</p>
            )}
          </div>
        )}

        {/* Footer actions */}
        <div className="flex items-center gap-2 pt-1 border-t border-gray-50 justify-end">
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs px-3"
            onClick={() => onEdit(taskType)}
          >
            Edit
          </Button>
          <Button
            size="sm"
            variant="outline"
            className={cn(
              'h-7 text-xs px-3',
              active
                ? 'text-gray-600 border-gray-200 hover:bg-gray-50'
                : 'text-green-700 border-green-200 hover:bg-green-50',
            )}
            onClick={() => onToggleActive(id, !active)}
          >
            {active ? 'Deactivate' : 'Activate'}
          </Button>
        </div>
      </div>
    </div>
  );
}
