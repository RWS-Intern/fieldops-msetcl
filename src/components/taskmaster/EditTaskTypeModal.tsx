import { useState, useEffect } from 'react';
import {
  Camera,
  ChevronDown as CollapseIcon,
  ChevronUp  as ExpandIcon,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input }  from '@/components/ui/input';
import { Label }  from '@/components/ui/label';
import { useTaskMasterActions } from '@/hooks/useTaskMasterActions';
import { useToast }             from '@/components/ui/toast';
import {
  SubtaskChecklist,
  emptySubtask,
  PRESET_COLOURS,
} from '@/components/taskmaster/SubtaskChecklist';
import { cn } from '@/lib/utils';
import type { TaskType, SubtaskDefinition } from '@/types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function slugify(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface EditTaskTypeModalProps {
  taskType: TaskType | null;   // null = creating new
  open:     boolean;
  onClose:  () => void;
}

// ─── PreviewSection ───────────────────────────────────────────────────────────

interface PreviewSectionProps { subtasks: SubtaskDefinition[] }

function PreviewSection({ subtasks }: PreviewSectionProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-lg border border-gray-200 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-2.5 bg-gray-50 text-sm font-medium text-gray-700 hover:bg-gray-100 transition-colors"
      >
        <span>Preview (field view)</span>
        {open ? <CollapseIcon className="h-4 w-4" /> : <ExpandIcon className="h-4 w-4" />}
      </button>

      {open && (
        <div className="p-4 flex flex-col gap-2 bg-white">
          {subtasks.length === 0 ? (
            <p className="text-xs text-gray-400 text-center py-4">No subtasks yet.</p>
          ) : (
            subtasks.map((s) => (
              <div
                key={s.subtaskId}
                className="rounded-lg border border-gray-100 bg-white p-3 border-l-4 border-l-gray-200"
              >
                <p className="text-sm font-medium text-gray-800 mb-2">
                  {s.label || <span className="text-gray-300 italic">Untitled subtask</span>}
                  {s.isRequired && <span className="text-brand-red ml-1">*</span>}
                </p>

                {s.collectionType === 'yesno' && (
                  <div className="flex gap-2">
                    {['Yes', 'No', 'N/A'].map((opt) => (
                      <button key={opt} type="button" disabled
                        className="flex-1 rounded-md border border-gray-200 bg-white py-1.5 text-xs font-medium text-gray-500 opacity-60 cursor-not-allowed"
                      >{opt}</button>
                    ))}
                  </div>
                )}
                {s.collectionType === 'text' && (
                  <input disabled placeholder="Enter value…"
                    className="w-full rounded-md border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs text-gray-400 cursor-not-allowed"
                  />
                )}
                {s.collectionType === 'number' && (
                  <input type="number" disabled placeholder="0"
                    className="w-32 rounded-md border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs text-gray-400 cursor-not-allowed"
                  />
                )}
                {s.collectionType === 'select' && (
                  <div className="flex flex-wrap gap-1.5">
                    {s.options.length > 0 ? s.options.map((opt) => (
                      <button key={opt} type="button" disabled
                        className="rounded-md border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-gray-500 opacity-60 cursor-not-allowed"
                      >{opt}</button>
                    )) : (
                      <span className="text-xs text-gray-300 italic">No options defined</span>
                    )}
                  </div>
                )}
                {s.collectionType === 'image_only' && (
                  <div className="flex items-center gap-2 rounded-lg border-2 border-dashed border-gray-200 bg-gray-50 py-3 px-4">
                    <Camera className="h-4 w-4 text-gray-300" />
                    <span className="text-xs text-gray-400">Photo required</span>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main modal ───────────────────────────────────────────────────────────────

export function EditTaskTypeModal({ taskType, open, onClose }: EditTaskTypeModalProps) {
  const { saveTaskType } = useTaskMasterActions();
  const { showToast }    = useToast();
  const isNew = taskType === null;

  const [typeLabel,    setTypeLabel]    = useState('');
  const [typeId,       setTypeId]       = useState('');
  const [typeIdEdited, setTypeIdEdited] = useState(false);
  const [colour,       setColour]       = useState(PRESET_COLOURS[0].hex);
  const [activeFlag,   setActiveFlag]   = useState(true);
  const [subtasks,     setSubtasks]     = useState<SubtaskDefinition[]>([]);
  const [saving,       setSaving]       = useState(false);
  const [errors,       setErrors]       = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    if (taskType) {
      const sorted = [...taskType.subtasks].sort((a, b) => a.sortOrder - b.sortOrder);
      setTypeLabel(taskType.typeLabel);
      setTypeId(taskType.id);
      setTypeIdEdited(false);
      setColour(taskType.colour);
      setActiveFlag(taskType.active);
      setSubtasks(sorted);
    } else {
      setTypeLabel('');
      setTypeId('');
      setTypeIdEdited(false);
      setColour(PRESET_COLOURS[0].hex);
      setActiveFlag(true);
      setSubtasks([emptySubtask(0)]);
    }
    setErrors({});
  }, [open, taskType]);

  useEffect(() => {
    if (isNew && !typeIdEdited) setTypeId(slugify(typeLabel));
  }, [typeLabel, isNew, typeIdEdited]);

  function validate(): boolean {
    const errs: Record<string, string> = {};
    if (!typeLabel.trim()) errs['typeLabel'] = 'Task type label is required';
    if (isNew) {
      if (!typeId.trim()) {
        errs['typeId'] = 'Type ID is required';
      } else if (!/^[a-z0-9_]+$/.test(typeId)) {
        errs['typeId'] = 'ID must be lowercase letters, numbers and underscores only';
      }
    }
    if (subtasks.length === 0) errs['subtasks'] = 'At least one subtask is required';
    subtasks.forEach((s, i) => {
      if (!s.label.trim()) errs[`subtask_label_${i}`] = `Subtask ${i + 1} label is required`;
      if (s.collectionType === 'select' && s.options.length === 0)
        errs[`subtask_options_${i}`] = `Subtask ${i + 1} needs at least one option`;
    });
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleSave() {
    if (!validate()) {
      showToast('Please fix the errors before saving', 'error');
      return;
    }
    setSaving(true);
    try {
      const finalSubtasks: SubtaskDefinition[] = subtasks.map((s, i) => ({
        ...s, sortOrder: i, label: s.label.trim(),
      }));
      const data: Omit<TaskType, 'id'> = {
        typeLabel:            typeLabel.trim(),
        colour,
        sortOrder:            taskType?.sortOrder ?? 999,
        active:               activeFlag,
        subtasks:             finalSubtasks,
        lastSyncedFromSheets: taskType?.lastSyncedFromSheets ?? null,
      };
      await saveTaskType(typeId, data);
      onClose();
    } catch {
      // Error toast already shown by saveTaskType
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !saving) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>
            {isNew ? 'New Task Type' : `Edit — ${taskType?.typeLabel}`}
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-6 mt-1">

          {/* ── Task Type Details ── */}
          <section className="flex flex-col gap-4">
            <h3 className="text-sm font-semibold text-gray-700 border-b border-gray-100 pb-1">
              Task Type Details
            </h3>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="tm-label">
                Type Label <span className="text-brand-red">*</span>
              </Label>
              <Input
                id="tm-label"
                value={typeLabel}
                onChange={(e) => setTypeLabel(e.target.value)}
                placeholder="e.g. Solar Feeder Addition"
                disabled={saving}
                className={errors['typeLabel'] ? 'border-brand-red focus-visible:ring-brand-red' : ''}
              />
              {errors['typeLabel'] && <p className="text-xs text-brand-red">{errors['typeLabel']}</p>}
            </div>

            {isNew ? (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="tm-id">Type ID <span className="text-brand-red">*</span></Label>
                <Input
                  id="tm-id"
                  value={typeId}
                  onChange={(e) => { setTypeId(e.target.value); setTypeIdEdited(true); }}
                  placeholder="e.g. solar_feeder"
                  disabled={saving}
                  className={cn('font-mono', errors['typeId'] ? 'border-brand-red focus-visible:ring-brand-red' : '')}
                />
                <p className="text-xs text-gray-400">Cannot be changed after creation. Auto-generated from label.</p>
                {errors['typeId'] && <p className="text-xs text-brand-red">{errors['typeId']}</p>}
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                <Label className="text-gray-500">Type ID (read-only)</Label>
                <div className="rounded-md border border-gray-100 bg-gray-50 px-3 py-2 font-mono text-sm text-gray-400">{typeId}</div>
              </div>
            )}

            {/* Colour picker */}
            <div className="flex flex-col gap-2">
              <Label>Colour</Label>
              <div className="flex items-center gap-2 flex-wrap">
                {PRESET_COLOURS.map(({ hex, label }) => (
                  <button
                    key={hex} type="button" onClick={() => setColour(hex)} aria-label={label}
                    className={cn(
                      'h-7 w-7 rounded-full border-2 transition-transform hover:scale-110 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-brand-blue',
                      colour === hex ? 'border-gray-800 scale-110' : 'border-transparent',
                    )}
                    style={{ backgroundColor: hex }}
                  >
                    {colour === hex && (
                      <span className="flex items-center justify-center h-full text-white text-[10px] font-bold">✓</span>
                    )}
                  </button>
                ))}
                <div className="ml-2 h-5 w-5 rounded-full border border-black/10 shrink-0" style={{ backgroundColor: colour }} />
                <span className="font-mono text-xs text-gray-400">{colour}</span>
              </div>
            </div>

            <label className="flex items-center gap-3 cursor-pointer select-none">
              <input
                type="checkbox" checked={activeFlag}
                onChange={(e) => setActiveFlag(e.target.checked)}
                disabled={saving}
                className="h-4 w-4 rounded accent-brand-blue"
              />
              <div>
                <span className="text-sm font-medium text-gray-700">Active</span>
                <p className="text-xs text-gray-400">
                  Inactive types are hidden from field engineers and cannot be assigned to tasks.
                </p>
              </div>
            </label>
          </section>

          {/* ── Subtask Checklist ── */}
          <section className="flex flex-col gap-3">
            <div>
              <h3 className="text-sm font-semibold text-gray-700">Subtask Checklist</h3>
              <p className="text-xs text-gray-400 mt-0.5">
                Define the steps field engineers must complete for this task type.
              </p>
            </div>
            {errors['subtasks'] && <p className="text-xs text-brand-red">{errors['subtasks']}</p>}
            <SubtaskChecklist
              subtasks={subtasks}
              onChange={setSubtasks}
              errors={errors}
              disabled={saving}
              minItems={1}
            />
          </section>

          {/* ── Preview ── */}
          <section>
            <PreviewSection subtasks={subtasks} />
          </section>

          {/* ── Submit ── */}
          <div className="flex gap-2 pt-2 border-t border-gray-100">
            <Button variant="outline" className="flex-1" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button className="flex-1" onClick={handleSave} disabled={saving}>
              {saving ? (
                <span className="flex items-center gap-2">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  Saving…
                </span>
              ) : 'Save Task Type'}
            </Button>
          </div>

        </div>
      </DialogContent>
    </Dialog>
  );
}
