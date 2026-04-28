/**
 * SubtaskChecklist — shared subtask-list editor used by:
 *   - EditTaskTypeModal  (Task Master)
 *   - TaskTemplateEditor (Project task templates)
 *
 * Exports: SubtaskChecklist, SubtaskRow, emptySubtask,
 *          COLLECTION_TYPE_OPTIONS, PRESET_COLOURS
 */
import { useState, useEffect } from 'react';
import { GripVertical, ChevronUp, ChevronDown, X, Plus } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { _emitToast } from '@/components/ui/toast';
import type { SubtaskDefinition, CollectionType } from '@/types';

// ─── Shared constants ─────────────────────────────────────────────────────────

export const PRESET_COLOURS = [
  { hex: '#0077B6', label: 'Blue'   },
  { hex: '#023E6B', label: 'Navy'   },
  { hex: '#00B4D8', label: 'Teal'   },
  { hex: '#2A9D8F', label: 'Green'  },
  { hex: '#F4A261', label: 'Amber'  },
  { hex: '#E63946', label: 'Red'    },
  { hex: '#9CA3AF', label: 'Grey'   },
  { hex: '#7C3AED', label: 'Purple' },
];

export const COLLECTION_TYPE_OPTIONS: { value: CollectionType; label: string }[] = [
  { value: 'yesno',      label: 'Yes / No'         },
  { value: 'text',       label: 'Text'              },
  { value: 'number',     label: 'Number'            },
  { value: 'select',     label: 'Select (dropdown)' },
  { value: 'image_only', label: 'Photo only'        },
];

export function emptySubtask(sortOrder: number): SubtaskDefinition {
  return {
    subtaskId:      `subtask_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    label:          '',
    collectionType: 'yesno',
    isRequired:     true,
    imageRequired:  false,
    options:        [],
    sortOrder,
  };
}

// ─── SubtaskRow ───────────────────────────────────────────────────────────────

interface SubtaskRowProps {
  subtask:    SubtaskDefinition;
  index:      number;
  total:      number;
  onChange:   (index: number, patch: Partial<SubtaskDefinition>) => void;
  onDelete:   (index: number) => void;
  onMoveUp:   (index: number) => void;
  onMoveDown: (index: number) => void;
  disabled?:  boolean;
}

export function SubtaskRow({
  subtask, index, total, onChange, onDelete, onMoveUp, onMoveDown, disabled,
}: SubtaskRowProps) {
  const [optionsStr, setOptionsStr] = useState(subtask.options.join('|'));

  useEffect(() => {
    setOptionsStr(subtask.options.join('|'));
  }, [subtask.options]);

  function commitOptions(raw: string) {
    const parsed = raw.split('|').map((s) => s.trim()).filter(Boolean);
    onChange(index, { options: parsed });
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 flex flex-col gap-2">
      {/* Row 1: handle · number · label · type · delete */}
      <div className="flex items-start gap-2">
        <GripVertical className="h-4 w-4 text-gray-300 mt-2 shrink-0 cursor-grab" />
        <span className="mt-2 text-xs font-mono text-gray-400 shrink-0 w-5 text-right">
          {index + 1}.
        </span>
        <Input
          value={subtask.label}
          onChange={(e) => onChange(index, { label: e.target.value })}
          placeholder="e.g. Panels Installed"
          className="flex-1 h-8 text-sm"
          disabled={disabled}
        />
        <select
          value={subtask.collectionType}
          onChange={(e) => onChange(index, { collectionType: e.target.value as CollectionType })}
          disabled={disabled}
          className="h-8 rounded-md border border-input bg-white px-2 text-xs focus:outline-none focus:ring-2 focus:ring-brand-blue/30 shrink-0"
        >
          {COLLECTION_TYPE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => onDelete(index)}
          disabled={disabled}
          className="mt-1.5 rounded p-1 text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors shrink-0 disabled:opacity-40"
          aria-label="Remove subtask"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Row 2: Required · Photo · Up/Down */}
      <div className="flex items-center gap-4 pl-9">
        <label className="flex items-center gap-1.5 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={subtask.isRequired}
            onChange={(e) => onChange(index, { isRequired: e.target.checked })}
            disabled={disabled}
            className="h-3.5 w-3.5 rounded accent-brand-blue"
          />
          <span className="text-xs text-gray-600">Required</span>
        </label>

        <label className="flex items-center gap-1.5 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={subtask.imageRequired}
            onChange={(e) => onChange(index, { imageRequired: e.target.checked })}
            disabled={disabled}
            className="h-3.5 w-3.5 rounded accent-brand-blue"
          />
          <span className="text-xs text-gray-600">Photo required</span>
        </label>

        <div className="flex-1" />

        <div className="flex gap-1">
          <button
            type="button"
            disabled={index === 0 || disabled}
            onClick={() => onMoveUp(index)}
            className="rounded p-0.5 text-gray-400 hover:text-gray-700 disabled:opacity-25 transition-colors"
            aria-label="Move up"
          >
            <ChevronUp className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            disabled={index === total - 1 || disabled}
            onClick={() => onMoveDown(index)}
            className="rounded p-0.5 text-gray-400 hover:text-gray-700 disabled:opacity-25 transition-colors"
            aria-label="Move down"
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Row 3: Options (select type only) */}
      {subtask.collectionType === 'select' && (
        <div className="pl-9">
          <Input
            value={optionsStr}
            onChange={(e) => setOptionsStr(e.target.value)}
            onBlur={(e) => commitOptions(e.target.value)}
            placeholder="Options separated by | e.g. Good|Fair|Poor"
            className="h-8 text-xs"
            disabled={disabled}
          />
          <p className="mt-1 text-[10px] text-gray-400">
            Separate options with a pipe character |
          </p>
        </div>
      )}
    </div>
  );
}

// ─── SubtaskChecklist ─────────────────────────────────────────────────────────

interface SubtaskChecklistProps {
  subtasks:   SubtaskDefinition[];
  onChange:   (subtasks: SubtaskDefinition[]) => void;
  /** Validation error keys: subtask_label_N, subtask_options_N */
  errors?:    Record<string, string>;
  disabled?:  boolean;
  /** Minimum allowed subtasks — shows toast if user tries to go below. Default 1. */
  minItems?:  number;
}

export function SubtaskChecklist({
  subtasks,
  onChange,
  errors    = {},
  disabled  = false,
  minItems  = 1,
}: SubtaskChecklistProps) {

  function handleChange(index: number, patch: Partial<SubtaskDefinition>) {
    onChange(subtasks.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  }

  function handleDelete(index: number) {
    if (subtasks.length <= minItems) {
      _emitToast(
        `At least ${minItems} subtask${minItems !== 1 ? 's' : ''} required`,
        'error',
      );
      return;
    }
    onChange(subtasks.filter((_, i) => i !== index));
  }

  function handleMoveUp(index: number) {
    if (index === 0) return;
    const next = [...subtasks];
    [next[index - 1], next[index]] = [next[index], next[index - 1]];
    onChange(next);
  }

  function handleMoveDown(index: number) {
    if (index === subtasks.length - 1) return;
    const next = [...subtasks];
    [next[index], next[index + 1]] = [next[index + 1], next[index]];
    onChange(next);
  }

  function handleAdd() {
    onChange([...subtasks, emptySubtask(subtasks.length)]);
  }

  return (
    <div className="flex flex-col gap-2">
      {subtasks.map((s, i) => (
        <div key={s.subtaskId}>
          <SubtaskRow
            subtask={s}
            index={i}
            total={subtasks.length}
            onChange={handleChange}
            onDelete={handleDelete}
            onMoveUp={handleMoveUp}
            onMoveDown={handleMoveDown}
            disabled={disabled}
          />
          {errors[`subtask_label_${i}`] && (
            <p className="text-xs text-brand-red mt-1 pl-2">
              {errors[`subtask_label_${i}`]}
            </p>
          )}
          {errors[`subtask_options_${i}`] && (
            <p className="text-xs text-brand-red mt-1 pl-2">
              {errors[`subtask_options_${i}`]}
            </p>
          )}
        </div>
      ))}

      <button
        type="button"
        onClick={handleAdd}
        disabled={disabled}
        className="flex items-center justify-center gap-2 w-full rounded-lg border-2 border-dashed border-gray-200 py-2.5 text-sm font-medium text-gray-500 hover:border-brand-blue hover:text-brand-blue transition-colors disabled:opacity-50"
      >
        <Plus className="h-4 w-4" />
        Add Subtask
      </button>
    </div>
  );
}
