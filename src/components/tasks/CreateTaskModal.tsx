import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { Camera, Plus } from 'lucide-react';
import { db } from '@/firebase/config';
import { useTaskActions } from '@/hooks/useTaskActions';
import { useTaskMaster } from '@/hooks/useTaskMaster';
import { useProjectStore } from '@/store/projectStore';
import { useToast } from '@/components/ui/toast';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import type { CreateTaskFormState } from '@/pages/TasksPage';
import type { SubtaskDefinition, Project } from '@/types';

interface CreateTaskModalProps {
  open:                boolean;
  onClose:             () => void;
  /** Pre-fills and locks the project dropdown when opening from a project drawer. */
  preselectedProject?: Project;
  /** Called immediately after a task is successfully created (before modal closes). */
  onSuccess?:          () => void;
  /** When provided, pre-populates form fields (used after "create new task type" flow). */
  initialData?:        CreateTaskFormState;
}

interface FieldUser {
  uid: string;
  name: string;
}

function todayStr(): string {
  return new Date().toISOString().split('T')[0];
}

function SubtaskPreview({ subtasks }: { subtasks: SubtaskDefinition[] }) {
  if (subtasks.length === 0) return null;
  return (
    <div className="rounded-lg border border-gray-100 bg-gray-50 p-3">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
        Field checklist preview
      </p>
      <div className="flex flex-col gap-1.5">
        {subtasks.map((s) => (
          <div key={s.subtaskId} className="flex items-center justify-between gap-2">
            <span className="text-sm text-gray-700 flex items-center gap-1">
              {s.isRequired && <span className="text-brand-red">*</span>}
              {s.label}
              {s.imageRequired && (
                <Camera className="h-3 w-3 text-gray-400 inline ml-1" />
              )}
            </span>
            <span className="text-xs bg-gray-200 text-gray-600 rounded px-1.5 py-0.5 shrink-0">
              {s.collectionType}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

interface FormErrors {
  title?: string;
  type?: string;
  assignedTo?: string;
  startDate?: string;
  dueDate?: string;
}

export function CreateTaskModal({
  open,
  onClose,
  preselectedProject,
  onSuccess,
  initialData,
}: CreateTaskModalProps) {
  const navigate                       = useNavigate();
  const { createTask }                 = useTaskActions();
  const { taskTypes }                  = useTaskMaster();
  const { showToast, ToastComponent }  = useToast();
  const { projects }                   = useProjectStore();

  const safeProjects = projects ?? [];

  const [title, setTitle]             = useState('');
  const [typeId, setTypeId]           = useState('');
  const [assignedTo, setAssignedTo]   = useState('');
  const [startDate, setStartDate]     = useState(todayStr());
  const [dueDate, setDueDate]         = useState('');
  const [siteCode, setSiteCode]       = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting]   = useState(false);
  const [errors, setErrors]           = useState<FormErrors>({});

  const [fieldUsers, setFieldUsers]           = useState<FieldUser[]>([]);
  const [linkedProjectId, setLinkedProjectId] = useState<string>(
    preselectedProject?.id ?? '__none__'
  );

  const selectedType = taskTypes.find((t) => t.id === typeId);

  // Sync the project selection whenever preselectedProject or open changes
  useEffect(() => {
    setLinkedProjectId(preselectedProject?.id ?? '__none__');
  }, [preselectedProject, open]);

  // Restore form state from initialData when the modal opens
  // (runs after the preselectedProject sync so linkedProjectId is correctly overridden)
  useEffect(() => {
    if (!open || !initialData) return;
    if (initialData.title     !== undefined) setTitle(initialData.title);
    if (initialData.typeId    !== undefined) setTypeId(initialData.typeId);
    if (initialData.description !== undefined) setDescription(initialData.description);
    if (initialData.assignedTo  !== undefined) setAssignedTo(initialData.assignedTo);
    if (initialData.startDate   !== undefined) setStartDate(initialData.startDate);
    if (initialData.dueDate     !== undefined) setDueDate(initialData.dueDate);
    if (initialData.siteCode    !== undefined) setSiteCode(initialData.siteCode);
    // Only restore linked project if there's no preselected project
    if (initialData.linkedProjectId !== undefined && !preselectedProject) {
      setLinkedProjectId(initialData.linkedProjectId);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Load field users
  useEffect(() => {
    if (!open) return;
    async function load() {
      try {
        const q = query(
          collection(db, 'users'),
          where('role', '==', 'field'),
          where('active', '==', true)
        );
        const snap = await getDocs(q);
        const users: FieldUser[] = snap.docs
          .filter((d) => d.data()['deletedAt'] == null)
          .map((d) => ({ uid: d.id, name: d.data()['name'] as string }));
        setFieldUsers(users);
      } catch {
        // non-critical
      }
    }
    load();
  }, [open]);

  function reset() {
    setTitle(''); setTypeId(''); setAssignedTo('');
    setStartDate(todayStr()); setDueDate('');
    setSiteCode(''); setDescription('');
    setLinkedProjectId(preselectedProject?.id ?? '__none__');
    setErrors({});
  }

  function validate(): FormErrors {
    const e: FormErrors = {};
    if (!title.trim())     e.title      = 'Title is required';
    if (!typeId)           e.type       = 'Task type is required';
    if (!assignedTo)       e.assignedTo = 'Assign to is required';
    if (!startDate)        e.startDate  = 'Start date is required';
    if (!dueDate)          e.dueDate    = 'Due date is required';
    if (startDate && dueDate && dueDate < startDate)
      e.dueDate = 'Due date must be on or after start date';
    return e;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length > 0) { setErrors(errs); return; }

    setSubmitting(true);
    try {
      const user = fieldUsers.find((u) => u.uid === assignedTo);

      const linkedProject =
        linkedProjectId && linkedProjectId !== '__none__'
          ? (preselectedProject?.id === linkedProjectId
              ? preselectedProject
              : safeProjects.find((p) => p.id === linkedProjectId) ?? null)
          : null;

      const { taskNum } = await createTask({
        title:          title.trim(),
        description:    description.trim() || undefined,
        type:           typeId,
        assignedTo,
        assignedToName: user?.name ?? '',
        siteCode:       siteCode.trim() || undefined,
        startDate:      new Date(startDate),
        dueDate:        new Date(dueDate),
        projectId:    linkedProject?.id,
        projectTitle: linkedProject?.title,
        projectNum:   linkedProject?.projectNum,
      });

      onSuccess?.();
      showToast(`Task ${taskNum} created successfully`, 'success');
      reset();
      onClose();
    } catch {
      showToast('Failed to create task. Try again.', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  function handleClose() {
    if (!submitting) { reset(); onClose(); }
  }

  /**
   * Save current form state to sessionStorage and navigate to Task Master
   * with ?openNew=true so the new-task-type modal opens automatically.
   * Does NOT call reset() — state is preserved in sessionStorage.
   */
  function handleCreateNewType() {
    const formState: CreateTaskFormState = {
      title,
      typeId,
      description,
      assignedTo,
      startDate,
      dueDate,
      siteCode,
      linkedProjectId,
    };
    sessionStorage.setItem('pendingTaskForm', JSON.stringify(formState));
    // Close without resetting — component unmounts on navigation anyway
    onClose();
    navigate('/task-master?openNew=true');
  }

  function handleTypeChange(value: string) {
    if (value === '__create_new__') {
      handleCreateNewType();
      return;
    }
    setTypeId(value);
  }

  return (
    <>
      {ToastComponent}
      <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
        <DialogContent className="max-h-screen overflow-y-auto sm:max-w-lg" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>Create New Task</DialogTitle>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4 mt-2">
            {/* Title */}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ct-title">Title <span className="text-brand-red">*</span></Label>
              <Input
                id="ct-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Task title"
              />
              {errors.title && <p className="text-xs text-brand-red">{errors.title}</p>}
            </div>

            {/* Task Type */}
            <div className="flex flex-col gap-1.5">
              <Label>Task Type <span className="text-brand-red">*</span></Label>
              <Select value={typeId} onValueChange={handleTypeChange}>
                <SelectTrigger>
                  <SelectValue placeholder="Select task type…" />
                </SelectTrigger>
                <SelectContent>
                  {taskTypes.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.typeLabel}
                    </SelectItem>
                  ))}
                  {/* ── Create new task type shortcut ── */}
                  <SelectSeparator />
                  <SelectItem
                    value="__create_new__"
                    className="text-brand-blue font-medium focus:text-brand-blue"
                  >
                    <span className="flex items-center gap-1.5">
                      <Plus className="h-3.5 w-3.5 shrink-0" />
                      Create new task type →
                    </span>
                  </SelectItem>
                </SelectContent>
              </Select>
              {errors.type && <p className="text-xs text-brand-red">{errors.type}</p>}
            </div>

            {/* Subtask preview */}
            {selectedType && (
              <SubtaskPreview
                subtasks={[...selectedType.subtasks].sort(
                  (a, b) => a.sortOrder - b.sortOrder
                )}
              />
            )}

            {/* Assign To */}
            <div className="flex flex-col gap-1.5">
              <Label>Assign To <span className="text-brand-red">*</span></Label>
              <Select value={assignedTo} onValueChange={setAssignedTo}>
                <SelectTrigger>
                  <SelectValue placeholder="Select field engineer…" />
                </SelectTrigger>
                <SelectContent>
                  {fieldUsers.map((u) => (
                    <SelectItem key={u.uid} value={u.uid}>
                      {u.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.assignedTo && <p className="text-xs text-brand-red">{errors.assignedTo}</p>}
            </div>

            {/* Start Date / Due Date */}
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ct-start">Start Date <span className="text-brand-red">*</span></Label>
                <Input
                  id="ct-start"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
                {errors.startDate && <p className="text-xs text-brand-red">{errors.startDate}</p>}
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ct-due">Due Date <span className="text-brand-red">*</span></Label>
                <Input
                  id="ct-due"
                  type="date"
                  value={dueDate}
                  min={startDate}
                  onChange={(e) => setDueDate(e.target.value)}
                />
                {errors.dueDate && <p className="text-xs text-brand-red">{errors.dueDate}</p>}
              </div>
            </div>

            {/* Site Code */}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ct-site">Site Code</Label>
              <Input
                id="ct-site"
                value={siteCode}
                onChange={(e) => setSiteCode(e.target.value)}
                placeholder="e.g. RS-SITE-001"
              />
            </div>

            {/* Description */}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ct-desc">Description</Label>
              <Textarea
                id="ct-desc"
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional task description…"
              />
            </div>

            {/* Link to Project (optional) */}
            {preselectedProject ? (
              <div className="flex flex-col gap-1.5">
                <Label>Project</Label>
                <div className="flex h-10 w-full items-center rounded-md border border-input bg-gray-50 px-3 text-sm text-gray-700">
                  {preselectedProject.projectNum} — {preselectedProject.title}
                </div>
              </div>
            ) : safeProjects.length > 0 ? (
              <div className="flex flex-col gap-1.5">
                <Label>Link to Project</Label>
                <Select value={linkedProjectId} onValueChange={setLinkedProjectId}>
                  <SelectTrigger>
                    <SelectValue placeholder="No project (standalone task)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">No project (standalone task)</SelectItem>
                    {safeProjects.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.projectNum} — {p.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}

            {/* Actions */}
            <div className="flex gap-3 pt-1">
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                onClick={handleClose}
                disabled={submitting}
              >
                Cancel
              </Button>
              <Button type="submit" className="flex-1" disabled={submitting}>
                {submitting ? (
                  <span className="flex items-center gap-2">
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    Creating…
                  </span>
                ) : (
                  'Create Task'
                )}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
