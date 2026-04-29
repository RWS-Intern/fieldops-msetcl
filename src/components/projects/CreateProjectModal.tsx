/**
 * CreateProjectModal — v3.0
 *
 * Fields: Project Name · Project Code · Description · Task Templates
 * Replaces the v2.1 modal (which asked for engineers, dates, task rows).
 */
import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button }   from '@/components/ui/button';
import { Input }    from '@/components/ui/input';
import { Label }    from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useProjectActions } from '@/hooks/useProjectActions';
import { useToast }          from '@/components/ui/toast';
import { TaskTemplateEditor } from '@/components/projects/TaskTemplateEditor';
import type { TaskTemplate } from '@/types';

// ─── Props ────────────────────────────────────────────────────────────────────

interface CreateProjectModalProps {
  open:    boolean;
  onClose: () => void;
}

// ─── Validation helpers ───────────────────────────────────────────────────────

/** Project code: 1–6 uppercase letters only, no spaces or numbers. */
function validateProjectCode(code: string): string | null {
  if (!code.trim()) return 'Project code is required';
  if (!/^[A-Z]{1,6}$/.test(code.trim()))
    return 'Code must be 1–6 uppercase letters only (e.g. IOT)';
  return null;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function CreateProjectModal({ open, onClose }: CreateProjectModalProps) {
  const { createProject } = useProjectActions();
  const { showToast }     = useToast();

  const [name,        setName]        = useState('');
  const [code,        setCode]        = useState('');
  const [description, setDescription] = useState('');
  const [templates,   setTemplates]   = useState<TaskTemplate[]>([]);
  const [submitting,  setSubmitting]  = useState(false);
  const [errors,      setErrors]      = useState<Record<string, string>>({});

  // Reset on open
  useEffect(() => {
    if (!open) return;
    setName('');
    setCode('');
    setDescription('');
    setTemplates([]);
    setErrors({});
  }, [open]);

  // Force uppercase as user types
  function handleCodeChange(raw: string) {
    setCode(raw.toUpperCase().replace(/[^A-Z]/g, ''));
  }

  // ── Validation ─────────────────────────────────────────────────────────────
  function validate(): boolean {
    const errs: Record<string, string> = {};

    if (!name.trim()) errs['name'] = 'Project name is required';

    const codeErr = validateProjectCode(code);
    if (codeErr) errs['code'] = codeErr;

    templates.forEach((t, i) => {
      if (!t.label.trim()) errs[`tmpl_label_${i}`] = 'Task type name is required';
      if (!t.taskKey.trim()) errs[`tmpl_taskKey_${i}`] = 'Task key cannot be empty';
      const dupIdx = templates.findIndex(
        (t2, j) => j !== i && t2.taskKey.trim() === t.taskKey.trim() && !!t.taskKey.trim()
      );
      if (dupIdx !== -1)
        errs[`tmpl_taskKey_${i}`] = `Duplicate — same key as template ${dupIdx + 1}`;
      t.subtasks.forEach((s, j) => {
        if (!s.label.trim())
          errs[`subtask_label_${i}_${j}`] = `Subtask ${j + 1} label required`;
        if (s.collectionType === 'select' && s.options.length === 0)
          errs[`subtask_options_${i}_${j}`] = `Subtask ${j + 1} needs at least one option`;
      });
    });

    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  // ── Submit ─────────────────────────────────────────────────────────────────
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) {
      showToast('Please fix the errors before saving', 'error');
      return;
    }

    setSubmitting(true);
    try {
      // Normalise sortOrder to match array position before saving
      const finalTemplates: TaskTemplate[] = templates.map((t, i) => ({
        ...t,
        label:     t.label.trim(),
        taskKey:   t.taskKey.trim(),
        sortOrder: i,
        subtasks: t.subtasks.map((s, j) => ({
          ...s, sortOrder: j, label: s.label.trim(),
        })),
      }));

      const { projectNum } = await createProject({
        title:         name.trim(),
        projectCode:   code.trim(),
        description:   description.trim() || undefined,
        taskTemplates: finalTemplates,
      });

      showToast(`Project ${projectNum} created`, 'success');
      onClose();
    } catch {
      showToast('Failed to create project. Try again.', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  function handleClose() {
    if (!submitting) onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent
        className="max-h-[90dvh] overflow-y-auto sm:max-w-xl"
        aria-describedby={undefined}
      >
        <DialogHeader>
          <DialogTitle>New Project</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-5 mt-2">

          {/* Project Name */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cp-name">
              Project Name <span className="text-brand-red">*</span>
            </Label>
            <Input
              id="cp-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Rajasthan Solar Phase 1"
              disabled={submitting}
              className={errors['name'] ? 'border-brand-red' : ''}
            />
            {errors['name'] && <p className="text-xs text-brand-red">{errors['name']}</p>}
          </div>

          {/* Project Code */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cp-code">
              Project Code <span className="text-brand-red">*</span>
            </Label>
            <Input
              id="cp-code"
              value={code}
              onChange={(e) => handleCodeChange(e.target.value)}
              placeholder="e.g. IOT"
              disabled={submitting}
              maxLength={6}
              className={`font-mono uppercase tracking-wider ${errors['code'] ? 'border-brand-red' : ''}`}
            />
            <p className="text-xs text-gray-400">
              1–6 uppercase letters only. Used as prefix for task numbers (e.g. IOT-ST-001).
            </p>
            {errors['code'] && <p className="text-xs text-brand-red">{errors['code']}</p>}
          </div>

          {/* Description */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cp-desc">Description</Label>
            <Textarea
              id="cp-desc"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional project description…"
              disabled={submitting}
            />
          </div>

          {/* Task Templates */}
          <div className="flex flex-col gap-2">
            <div>
              <Label className="text-sm font-semibold">Task Types</Label>
              <p className="text-xs text-gray-400 mt-0.5">
                Define the task templates for this project. You can add more later.
              </p>
            </div>
            <TaskTemplateEditor
              templates={templates}
              onChange={setTemplates}
              disabled={submitting}
              errors={errors}
            />
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-1 border-t border-gray-100">
            <Button type="button" variant="outline" className="flex-1" onClick={handleClose} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" className="flex-1" disabled={submitting}>
              {submitting ? (
                <span className="flex items-center gap-2">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  Creating…
                </span>
              ) : 'Create Project'}
            </Button>
          </div>

        </form>
      </DialogContent>
    </Dialog>
  );
}
