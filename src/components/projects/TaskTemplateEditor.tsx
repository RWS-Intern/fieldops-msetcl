/**
 * TaskTemplateEditor
 *
 * Inline editor for the taskTemplates array on a project document.
 * Each template row has:
 *   • label input
 *   • colour swatch picker
 *   • expand/collapse toggle to reveal the subtask checklist
 *   • up / down reorder arrows
 *   • delete button
 * The subtask checklist is the same SubtaskChecklist component used by
 * the Task Master page — reused directly, not rebuilt.
 */
import { useState } from 'react';
import { Plus, X, ChevronUp, ChevronDown } from 'lucide-react';
import { Input } from '@/components/ui/input';
import {
  SubtaskChecklist,
  emptySubtask,
  PRESET_COLOURS,
} from '@/components/taskmaster/SubtaskChecklist';
import { cn } from '@/lib/utils';
import type { TaskTemplate, SubtaskDefinition } from '@/types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function newTemplate(sortOrder: number): TaskTemplate {
  return {
    taskKey:  `tk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    label:    '',
    colour:   PRESET_COLOURS[0].hex,
    sortOrder,
    subtasks: [emptySubtask(0)],
  };
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface TaskTemplateEditorProps {
  templates:  TaskTemplate[];
  onChange:   (templates: TaskTemplate[]) => void;
  disabled?:  boolean;
  /** Validation error keys: tmpl_label_N, subtask_label_N_M, subtask_options_N_M */
  errors?:    Record<string, string>;
}

// ─── TemplateRow ──────────────────────────────────────────────────────────────

interface TemplateRowProps {
  template:   TaskTemplate;
  index:      number;
  total:      number;
  onUpdate:   (index: number, patch: Partial<TaskTemplate>) => void;
  onDelete:   (index: number) => void;
  onMoveUp:   (index: number) => void;
  onMoveDown: (index: number) => void;
  disabled:   boolean;
  errors:     Record<string, string>;
}

function TemplateRow({
  template, index, total, onUpdate, onDelete, onMoveUp, onMoveDown, disabled, errors,
}: TemplateRowProps) {
  const [expanded, setExpanded] = useState(false);

  // Build subtask-level error keys scoped to this template row:
  // e.g. errors["subtask_label_2_1"] → subtask_label_1 for SubtaskChecklist
  const subtaskErrors: Record<string, string> = {};
  for (const [k, v] of Object.entries(errors)) {
    const match = k.match(new RegExp(`^subtask_(.+)_${index}_(.+)$`));
    if (match) subtaskErrors[`subtask_${match[1]}_${match[2]}`] = v;
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
      {/* Colour stripe */}
      <div className="flex">
        <div className="w-1 shrink-0 rounded-l-xl" style={{ backgroundColor: template.colour }} />

        <div className="flex-1 p-3 min-w-0">
          {/* Header row: up/down · swatch · label · subtask count · delete */}
          <div className="flex items-center gap-2">
            {/* Up / Down */}
            <div className="flex flex-col gap-0.5 shrink-0">
              <button
                type="button"
                disabled={index === 0 || disabled}
                onClick={() => onMoveUp(index)}
                className="rounded p-0.5 text-gray-300 hover:text-gray-600 disabled:opacity-20 transition-colors"
                aria-label="Move up"
              >
                <ChevronUp className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                disabled={index === total - 1 || disabled}
                onClick={() => onMoveDown(index)}
                className="rounded p-0.5 text-gray-300 hover:text-gray-600 disabled:opacity-20 transition-colors"
                aria-label="Move down"
              >
                <ChevronDown className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* Colour swatch (click to expand and change colour) */}
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="h-5 w-5 rounded-full shrink-0 border border-black/10 hover:ring-2 hover:ring-brand-blue/30 transition-all"
              style={{ backgroundColor: template.colour }}
              aria-label="Toggle expand"
            />

            {/* Label input */}
            <Input
              value={template.label}
              onChange={(e) => onUpdate(index, { label: e.target.value })}
              placeholder="Task type name…"
              disabled={disabled}
              className={cn(
                'flex-1 h-8 text-sm',
                errors[`tmpl_label_${index}`] ? 'border-brand-red' : '',
              )}
            />

            {/* Subtask count / expand toggle */}
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="flex items-center gap-1 shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600 hover:bg-gray-200 transition-colors"
            >
              {template.subtasks.length} subtask{template.subtasks.length !== 1 ? 's' : ''}
              {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </button>

            {/* Delete */}
            <button
              type="button"
              onClick={() => onDelete(index)}
              disabled={disabled}
              className="shrink-0 rounded p-1 text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors disabled:opacity-40"
              aria-label="Remove task type"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Label error */}
          {errors[`tmpl_label_${index}`] && (
            <p className="text-xs text-brand-red mt-1 pl-7">
              {errors[`tmpl_label_${index}`]}
            </p>
          )}

          {/* Expanded panel: colour picker + subtask checklist */}
          {expanded && (
            <div className="mt-3 flex flex-col gap-4 pt-3 border-t border-gray-100">

              {/* Colour picker */}
              <div>
                <p className="text-xs font-medium text-gray-600 mb-2">Colour</p>
                <div className="flex items-center gap-2 flex-wrap">
                  {PRESET_COLOURS.map(({ hex, label }) => (
                    <button
                      key={hex}
                      type="button"
                      onClick={() => onUpdate(index, { colour: hex })}
                      aria-label={label}
                      className={cn(
                        'h-6 w-6 rounded-full border-2 transition-transform hover:scale-110 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-brand-blue',
                        template.colour === hex ? 'border-gray-700 scale-110' : 'border-transparent',
                      )}
                      style={{ backgroundColor: hex }}
                    >
                      {template.colour === hex && (
                        <span className="flex items-center justify-center h-full text-white text-[9px] font-bold">✓</span>
                      )}
                    </button>
                  ))}
                </div>
              </div>

              {/* Subtask checklist */}
              <div>
                <p className="text-xs font-medium text-gray-600 mb-2">Subtasks</p>
                <SubtaskChecklist
                  subtasks={template.subtasks}
                  onChange={(updated: SubtaskDefinition[]) =>
                    onUpdate(index, { subtasks: updated })
                  }
                  errors={subtaskErrors}
                  disabled={disabled}
                  minItems={1}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── TaskTemplateEditor ───────────────────────────────────────────────────────

export function TaskTemplateEditor({
  templates,
  onChange,
  disabled = false,
  errors   = {},
}: TaskTemplateEditorProps) {

  function handleUpdate(index: number, patch: Partial<TaskTemplate>) {
    onChange(templates.map((t, i) => (i === index ? { ...t, ...patch } : t)));
  }

  function handleDelete(index: number) {
    onChange(templates.filter((_, i) => i !== index));
  }

  function handleMoveUp(index: number) {
    if (index === 0) return;
    const next = [...templates];
    [next[index - 1], next[index]] = [next[index], next[index - 1]];
    // Re-assign sortOrder to match array position
    onChange(next.map((t, i) => ({ ...t, sortOrder: i })));
  }

  function handleMoveDown(index: number) {
    if (index === templates.length - 1) return;
    const next = [...templates];
    [next[index], next[index + 1]] = [next[index + 1], next[index]];
    onChange(next.map((t, i) => ({ ...t, sortOrder: i })));
  }

  function handleAdd() {
    onChange([...templates, newTemplate(templates.length)]);
  }

  return (
    <div className="flex flex-col gap-2">
      {templates.length === 0 && (
        <p className="text-xs text-gray-400 text-center py-3">
          No task types yet — add one below.
        </p>
      )}

      {templates.map((t, i) => (
        <TemplateRow
          key={t.taskKey}
          template={t}
          index={i}
          total={templates.length}
          onUpdate={handleUpdate}
          onDelete={handleDelete}
          onMoveUp={handleMoveUp}
          onMoveDown={handleMoveDown}
          disabled={disabled}
          errors={errors}
        />
      ))}

      <button
        type="button"
        onClick={handleAdd}
        disabled={disabled}
        className="flex items-center justify-center gap-2 w-full rounded-xl border-2 border-dashed border-gray-200 py-3 text-sm font-medium text-gray-500 hover:border-brand-blue hover:text-brand-blue transition-colors disabled:opacity-50"
      >
        <Plus className="h-4 w-4" />
        Add Task Type
      </button>
    </div>
  );
}
