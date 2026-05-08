/**
 * TaskTemplateEditor
 *
 * Inline editor for the taskTemplates array on a project document.
 * Each template row has:
 *   • label input (auto-suggests a taskKey while the key hasn't been manually edited)
 *   • task key input (monospace, sanitised to a-z 0-9 _)
 *   • colour swatch picker
 *   • expand/collapse toggle to reveal the subtask checklist
 *   • up / down reorder arrows
 *   • delete button
 * The subtask checklist is the same SubtaskChecklist component used by
 * the Task Master page — reused directly, not rebuilt.
 */
import { useState, useEffect } from 'react';
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

/**
 * Derive a URL-safe task key from a label string.
 * e.g. "Solar Addition" → "solar_addition"
 *      "New Feeder #2"  → "new_feeder_2"
 */
function suggestTaskKey(label: string): string {
  return label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s_]/g, '')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_');
}

/** True if the key matches the auto-generated placeholder pattern tk_xxx_yyy. */
const AUTO_GEN_RE = /^tk_[a-z0-9]+_[a-z0-9]+$/;

// ─── Props ────────────────────────────────────────────────────────────────────

interface TaskTemplateEditorProps {
  templates:  TaskTemplate[];
  onChange:   (templates: TaskTemplate[]) => void;
  disabled?:  boolean;
  /**
   * Pass true when editing an existing project (EditProjectModal).
   * Displays a warning in the Task Key field for templates that were originally
   * loaded from Firestore, reminding admins that changing a key does not
   * back-fill existing site task records.
   */
  isEditing?: boolean;
  /** Validation error keys: tmpl_label_N, tmpl_taskKey_N, subtask_label_N_M, subtask_options_N_M */
  errors?:    Record<string, string>;
}

// ─── TemplateRow ──────────────────────────────────────────────────────────────

interface TemplateRowProps {
  template:      TaskTemplate;
  index:         number;
  total:         number;
  /** All other templates' taskKeys (for duplicate detection). */
  otherTaskKeys: string[];
  isEditing:     boolean;
  onUpdate:      (index: number, patch: Partial<TaskTemplate>) => void;
  onDelete:      (index: number) => void;
  onMoveUp:      (index: number) => void;
  onMoveDown:    (index: number) => void;
  disabled:      boolean;
  errors:        Record<string, string>;
}

function TemplateRow({
  template, index, total, otherTaskKeys, isEditing,
  onUpdate, onDelete, onMoveUp, onMoveDown, disabled, errors,
}: TemplateRowProps) {
  const [expanded, setExpanded] = useState(false);

  // Capture on mount whether this template's key looked auto-generated.
  // Firestore-loaded templates have human-readable keys (e.g. "solar_addition")
  // while newly-added templates start with the tk_xxx placeholder.
  // We only show the "changing this key won't update existing records" warning
  // for templates that were loaded from Firestore (i.e. NOT auto-gen at mount).
  const [wasAutoGenOnMount] = useState(
    () => AUTO_GEN_RE.test(template.taskKey)
  );

  // If the admin has manually typed in the Task Key field, stop auto-suggesting
  // from the label. Initialise to true for templates with a real (non-auto-gen)
  // key so we never clobber an existing key when the label is edited.
  const [manuallyEdited, setManuallyEdited] = useState(
    () => !AUTO_GEN_RE.test(template.taskKey)
  );

  // Auto-expand the row when the parent's validation fires a taskKey error here,
  // so the error is visible without the admin needing to manually expand.
  useEffect(() => {
    if (errors[`tmpl_taskKey_${index}`]) setExpanded(true);
  }, [errors, index]);

  // ── Inline task-key validation ────────────────────────────────────────────
  const taskKeyError: string | null =
    !template.taskKey.trim()
      ? 'Task key cannot be empty'
      : otherTaskKeys.includes(template.taskKey.trim())
      ? 'Task key must be unique within this project'
      : (errors[`tmpl_taskKey_${index}`] ?? null);

  // ── Subtask error keys scoped to this row ─────────────────────────────────
  const subtaskErrors: Record<string, string> = {};
  for (const [k, v] of Object.entries(errors)) {
    const match = k.match(new RegExp(`^subtask_(.+)_${index}_(.+)$`));
    if (match) subtaskErrors[`subtask_${match[1]}_${match[2]}`] = v;
  }

  // ── Condition helpers ─────────────────────────────────────────────────────
  // Patch a single subtask inside template.subtasks and propagate via onUpdate.
  function updateSubtaskField(subtaskId: string, patch: Partial<SubtaskDefinition>) {
    const updated = template.subtasks.map((s) =>
      s.subtaskId === subtaskId ? { ...s, ...patch } : s,
    );
    onUpdate(index, { subtasks: updated });
  }

  function addCondition(subtaskId: string) {
    updateSubtaskField(subtaskId, { showWhen: { subtaskId: '', value: '' } });
  }

  function removeCondition(subtaskId: string) {
    updateSubtaskField(subtaskId, { showWhen: undefined });
  }

  function updateCondition(subtaskId: string, field: 'subtaskId' | 'value', val: string) {
    const subtask = template.subtasks.find((s) => s.subtaskId === subtaskId);
    if (!subtask?.showWhen) return;
    updateSubtaskField(subtaskId, { showWhen: { ...subtask.showWhen, [field]: val } });
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
      {/* Colour stripe */}
      <div className="flex">
        <div className="w-1 shrink-0 rounded-l-xl" style={{ backgroundColor: template.colour }} />

        <div className="flex-1 p-3 min-w-0">
          {/* Header row: up/down · swatch · label input · subtask count · delete */}
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

            {/* Colour swatch — click to expand */}
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="h-5 w-5 rounded-full shrink-0 border border-black/10 hover:ring-2 hover:ring-brand-blue/30 transition-all"
              style={{ backgroundColor: template.colour }}
              aria-label="Toggle expand"
            />

            {/* Label input — drives taskKey auto-suggest while not manually edited */}
            <Input
              value={template.label}
              onChange={(e) => {
                const newLabel = e.target.value;
                const patch: Partial<TaskTemplate> = { label: newLabel };
                if (!manuallyEdited) {
                  const suggested = suggestTaskKey(newLabel);
                  // Only apply suggestion if it's non-empty (avoids wiping a good key)
                  if (suggested) patch.taskKey = suggested;
                }
                onUpdate(index, patch);
              }}
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

          {/* Expanded panel: colour picker · task key · subtask checklist */}
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

              {/* Task Key */}
              <div>
                <p className="text-xs font-medium text-gray-600 mb-1">
                  Task Key{' '}
                  <span className="font-normal text-gray-400">(used in CSV uploads)</span>
                </p>
                <Input
                  value={template.taskKey}
                  onChange={(e) => {
                    // Sanitise to lowercase a-z, 0-9, underscore only
                    const raw = e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '');
                    setManuallyEdited(true);
                    onUpdate(index, { taskKey: raw });
                  }}
                  placeholder="e.g. solar_addition"
                  disabled={disabled}
                  className={cn(
                    'h-8 text-sm font-mono',
                    taskKeyError ? 'border-brand-red' : '',
                  )}
                />
                {/* Inline error */}
                {taskKeyError && (
                  <p className="text-xs text-brand-red mt-1">{taskKeyError}</p>
                )}
                {/* Warning: only for Firestore-loaded templates in edit mode */}
                {isEditing && !wasAutoGenOnMount && (
                  <p className="text-xs text-amber-600 mt-1.5">
                    ⚠️ Changing this key won&apos;t update existing site task records — only new site assignments will use the updated key.
                  </p>
                )}
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

              {/* Subtask conditions — only available when there are 2+ subtasks */}
              {template.subtasks.length > 1 && (
                <div>
                  <p className="text-xs font-medium text-gray-600 mb-1">
                    Subtask Conditions
                    <span className="font-normal text-gray-400 ml-1">
                      (show a subtask only when another has a specific answer)
                    </span>
                  </p>
                  <div className="flex flex-col gap-3 mt-2">
                    {template.subtasks.map((subtask, idx) => {
                      // The first subtask cannot depend on anything.
                      if (idx === 0) return null;
                      return (
                        <div key={subtask.subtaskId} className="text-xs">
                          <p className="text-gray-500 mb-1 font-medium truncate">
                            {subtask.label || <span className="italic text-gray-300">Unnamed subtask</span>}
                          </p>
                          {!subtask.showWhen ? (
                            <button
                              type="button"
                              onClick={() => addCondition(subtask.subtaskId)}
                              disabled={disabled}
                              className="text-xs text-gray-400 hover:text-blue-600 mt-1 flex items-center gap-1"
                            >
                              <Plus className="w-3 h-3" />
                              Add condition
                            </button>
                          ) : (
                            <div className="mt-2 p-2 bg-gray-50 border border-gray-200 rounded-md text-xs">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-gray-500">Show only when:</span>
                                <select
                                  value={subtask.showWhen.subtaskId}
                                  onChange={(e) =>
                                    updateCondition(subtask.subtaskId, 'subtaskId', e.target.value)
                                  }
                                  disabled={disabled}
                                  className="border border-gray-300 rounded px-1.5 py-0.5 text-xs bg-white"
                                >
                                  <option value="">Select question…</option>
                                  {template.subtasks
                                    .filter((s, sIdx) => s.subtaskId !== subtask.subtaskId && sIdx < idx)
                                    .map((s) => (
                                      <option key={s.subtaskId} value={s.subtaskId}>
                                        {s.label}
                                      </option>
                                    ))}
                                </select>
                                <span className="text-gray-500">=</span>
                                <input
                                  type="text"
                                  value={subtask.showWhen.value}
                                  onChange={(e) =>
                                    updateCondition(subtask.subtaskId, 'value', e.target.value)
                                  }
                                  disabled={disabled}
                                  placeholder="e.g. yes"
                                  className="border border-gray-300 rounded px-1.5 py-0.5 text-xs w-20 bg-white"
                                />
                                <button
                                  type="button"
                                  onClick={() => removeCondition(subtask.subtaskId)}
                                  disabled={disabled}
                                  className="text-gray-400 hover:text-red-500 ml-1"
                                >
                                  <X className="w-3 h-3" />
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
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
  disabled  = false,
  isEditing = false,
  errors    = {},
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
          // Use index as key so the row component isn't remounted when the
          // taskKey is edited — this preserves manuallyEdited / wasAutoGenOnMount state.
          key={i}
          template={t}
          index={i}
          total={templates.length}
          otherTaskKeys={templates.filter((_, j) => j !== i).map((t2) => t2.taskKey.trim())}
          isEditing={isEditing}
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
