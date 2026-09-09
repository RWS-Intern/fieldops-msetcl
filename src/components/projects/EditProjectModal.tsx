/**
 * EditProjectModal — v3.0
 *
 * Edits an existing project: Name · Code · Description · Active toggle ·
 * Task Templates (full add/edit/reorder/delete).
 * Overwrites the project document atomically on save.
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useProjectActions } from '@/hooks/useProjectActions';
import { useApprovers, approverLabel } from '@/hooks/useApprovers';
import { useToast }          from '@/components/ui/toast';
import { TaskTemplateEditor } from '@/components/projects/TaskTemplateEditor';
import type { Project, TaskTemplate } from '@/types';

// ─── Props ────────────────────────────────────────────────────────────────────

interface EditProjectModalProps {
  project: Project | null;   // null = closed
  onClose: () => void;
}

// ─── Validation helpers ───────────────────────────────────────────────────────

function validateProjectCode(code: string): string | null {
  if (!code.trim()) return 'Project code is required';
  if (!/^[A-Z]{1,6}$/.test(code.trim()))
    return 'Code must be 1–6 uppercase letters only (e.g. IOT)';
  return null;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function EditProjectModal({ project, onClose }: EditProjectModalProps) {
  const { updateProject } = useProjectActions();
  const { approvers }     = useApprovers();
  const { showToast }     = useToast();

  const [name,             setName]             = useState('');
  const [code,             setCode]             = useState('');
  const [description,      setDescription]      = useState('');
  const [active,           setActive]           = useState(true);
  const [templates,        setTemplates]        = useState<TaskTemplate[]>([]);
  const [defaultApproverId, setDefaultApproverId] = useState('none');
  const [saving,           setSaving]           = useState(false);
  const [errors,           setErrors]           = useState<Record<string, string>>({});

  const open = project !== null;

  // Pre-populate from project when opening
  useEffect(() => {
    if (!project) return;
    setName(project.title);
    setCode(project.projectCode ?? '');
    setDescription(project.description ?? '');
    setActive(project.active !== false);
    setTemplates(
      [...(project.taskTemplates ?? [])].sort((a, b) => a.sortOrder - b.sortOrder)
    );
    setDefaultApproverId(project.defaultApproverUid ?? 'none');
    setErrors({});
  }, [project]);

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
  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!project) return;
    if (!validate()) {
      showToast('Please fix the errors before saving', 'error');
      return;
    }

    setSaving(true);
    try {
      const finalTemplates: TaskTemplate[] = templates.map((t, i) => ({
        ...t,
        label:     t.label.trim(),
        taskKey:   t.taskKey.trim(),
        sortOrder: i,
        subtasks:  t.subtasks.map((s, j) => ({
          ...s, sortOrder: j, label: s.label.trim(),
        })),
      }));

      const approver = defaultApproverId === 'none'
        ? null
        : approvers.find((a) => a.uid === defaultApproverId);

      await updateProject(project.id, {
        title:         name.trim(),
        projectCode:   code.trim(),
        description:   description.trim() || undefined,
        active,
        taskTemplates: finalTemplates,
        defaultApproverUid:  approver?.uid         ?? null,
        defaultApproverName: approver?.displayName ?? null,
      });

      showToast('Project saved', 'success');
      onClose();
    } catch {
      showToast('Failed to save project. Try again.', 'error');
    } finally {
      setSaving(false);
    }
  }

  function handleClose() {
    if (!saving) onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent
        className="max-h-[90dvh] overflow-y-auto sm:max-w-xl"
        aria-describedby={undefined}
      >
        <DialogHeader>
          <DialogTitle>
            Edit Project
            {project?.projectNum && (
              <span className="ml-2 font-mono text-xs text-gray-400 font-normal">
                {project.projectNum}
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSave} className="flex flex-col gap-5 mt-2">

          {/* Project Name */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ep-name">
              Project Name <span className="text-brand-red">*</span>
            </Label>
            <Input
              id="ep-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Rajasthan Solar Phase 1"
              disabled={saving}
              className={errors['name'] ? 'border-brand-red' : ''}
            />
            {errors['name'] && <p className="text-xs text-brand-red">{errors['name']}</p>}
          </div>

          {/* Project Code */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ep-code">
              Project Code <span className="text-brand-red">*</span>
            </Label>
            <Input
              id="ep-code"
              value={code}
              onChange={(e) => handleCodeChange(e.target.value)}
              placeholder="e.g. IOT"
              disabled={saving}
              maxLength={6}
              className={`font-mono uppercase tracking-wider ${errors['code'] ? 'border-brand-red' : ''}`}
            />
            <p className="text-xs text-gray-400">
              1–6 uppercase letters only.
            </p>
            {errors['code'] && <p className="text-xs text-brand-red">{errors['code']}</p>}
          </div>

          {/* Description */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ep-desc">Description</Label>
            <Textarea
              id="ep-desc"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional project description…"
              disabled={saving}
            />
          </div>

          {/* Active toggle */}
          <label className="flex items-center gap-3 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
              disabled={saving}
              className="h-4 w-4 rounded accent-brand-blue"
            />
            <div>
              <span className="text-sm font-medium text-gray-700">Active</span>
              <p className="text-xs text-gray-400">
                Inactive projects are hidden from site creation.
              </p>
            </div>
          </label>

          {/* Default Approver */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ep-approver">Default Approver</Label>
            <Select value={defaultApproverId} onValueChange={setDefaultApproverId}>
              <SelectTrigger id="ep-approver" disabled={saving}>
                <SelectValue placeholder="Select approver…" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Unassigned (any admin may approve)</SelectItem>
                {approvers.map((a) => (
                  <SelectItem key={a.uid} value={a.uid}>
                    {approverLabel(a)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-gray-400">
              Inherited by every site task created under this project going forward. Existing tasks keep their current approver.
            </p>
          </div>

          {/* Task Templates */}
          <div className="flex flex-col gap-2">
            <div>
              <Label className="text-sm font-semibold">Task Types</Label>
              <p className="text-xs text-gray-400 mt-0.5">
                Changes take effect immediately for all connected devices.
              </p>
            </div>
            <TaskTemplateEditor
              templates={templates}
              onChange={setTemplates}
              disabled={saving}
              isEditing={true}
              errors={errors}
            />
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-1 border-t border-gray-100">
            <Button type="button" variant="outline" className="flex-1" onClick={handleClose} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" className="flex-1" disabled={saving}>
              {saving ? (
                <span className="flex items-center gap-2">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  Saving…
                </span>
              ) : 'Save Changes'}
            </Button>
          </div>

        </form>
      </DialogContent>
    </Dialog>
  );
}
