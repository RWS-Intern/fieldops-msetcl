import { useState, useMemo }      from 'react';
import { useNavigate }            from 'react-router-dom';
import { MapPin, Building2, Archive, RotateCcw, Pencil, Navigation, XCircle, FileText, History } from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
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
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button }        from '@/components/ui/button';
import { Input }         from '@/components/ui/input';
import { Skeleton }      from '@/components/ui/skeleton';
import { archiveSite, updateSiteLocation, useSiteActions } from '@/hooks/useSiteActions';
import { useSiteTasks }             from '@/hooks/useSiteTasks';
import { useToast }                 from '@/components/ui/toast';
import { useAuthStore }             from '@/store/authStore';
import { useFieldEngineers }        from '@/hooks/useFieldEngineers';
import { useApprovers, approverLabel } from '@/hooks/useApprovers';
import { useWorkOrderActions }      from '@/hooks/useWorkOrderActions';
import { SiteTaskDetailDrawer }     from '@/components/siteTasks/SiteTaskDetailDrawer';
import { useProjectStore }           from '@/store/projectStore';
import { SiteWorkOrdersSection }    from '@/components/sites/SiteWorkOrdersSection';
import { SURVEY_APPROVAL_STAGES } from '@/lib/approvalStages';
import { parseCoordinatesInput, isValidLatLng } from '@/lib/coordinates';
import { cn } from '@/lib/utils';
import type { Site, SiteStatus, SiteTask, TaskStatus } from '@/types';

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<SiteStatus, string> = {
  active:    'Active',
  completed: 'Completed',
  on_hold:   'On Hold',
};

const STATUS_BADGE: Record<SiteStatus, string> = {
  active:    'bg-blue-50 text-brand-blue',
  completed: 'bg-green-50 text-green-700',
  on_hold:   'bg-gray-100 text-gray-500',
};

// ─── Row helper ───────────────────────────────────────────────────────────────

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 py-2 border-b border-gray-100 last:border-0">
      <span className="text-xs text-gray-400 w-28 shrink-0 pt-0.5">{label}</span>
      <span className="text-sm text-gray-800 leading-snug">{value}</span>
    </div>
  );
}

// ─── Task row ─────────────────────────────────────────────────────────────────

const TASK_STATUS_BADGE: Record<TaskStatus, string> = {
  pending:           'bg-gray-100 text-gray-600',
  in_progress:       'bg-amber-50 text-amber-700',
  pending_approval:  'bg-violet-50 text-violet-700',
  changes_requested: 'bg-orange-50 text-orange-700',
  completed:         'bg-green-50 text-green-700',
  blocked:           'bg-red-50 text-red-700',
};

const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  pending:           'Pending',
  in_progress:       'In Progress',
  pending_approval:  'Pending Approval',
  changes_requested: 'Changes Requested',
  completed:         'Completed',
  blocked:           'Blocked',
};

function SiteTaskRow({
  task,
  canAssign,
  onClick,
}: {
  task:      SiteTask;
  /** False for a read-only viewer — the button always reads "View". */
  canAssign: boolean;
  onClick:   () => void;
}) {
  return (
    <div
      className="border rounded-lg p-4 hover:border-blue-300 hover:shadow-sm transition-all cursor-pointer"
      onClick={onClick}
    >
      <div className="flex items-start gap-3">
        {/* Left colour stripe */}
        <div
          className="w-1 rounded-full self-stretch flex-shrink-0"
          style={{ backgroundColor: task.taskColour }}
        />
        <div className="flex-1 min-w-0">
          {/* Task label + taskKey */}
          <p className="font-semibold text-gray-900 text-sm leading-snug">{task.taskLabel}</p>
          <p className="text-xs text-gray-400 font-mono mb-2">{task.taskKey}</p>
          {/* Assignee row */}
          {task.assignedTo ? (
            <div className="flex items-center gap-2 flex-wrap">
              <div className="w-6 h-6 rounded-full bg-blue-100 flex items-center justify-center text-xs font-bold text-blue-700 shrink-0">
                {task.assignedToName?.charAt(0).toUpperCase()}
              </div>
              <span className="text-sm text-gray-700">{task.assignedToName}</span>
              {task.assignedToCode && (
                <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-mono">
                  {task.assignedToCode}
                </span>
              )}
            </div>
          ) : (
            <span className="text-sm text-gray-400 italic">Unassigned</span>
          )}
          {/* Due date */}
          {task.dueDate && (
            <p className="text-xs text-gray-500 mt-1">
              Due {task.dueDate.toLocaleDateString('en-GB', {
                day: '2-digit', month: 'short', year: 'numeric',
              })}
            </p>
          )}
        </div>
        {/* Right side: status badge + action button */}
        <div className="flex flex-col items-end gap-2 flex-shrink-0">
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${TASK_STATUS_BADGE[task.status]}`}>
            {TASK_STATUS_LABELS[task.status]}
          </span>
          <button
            onClick={(e) => { e.stopPropagation(); onClick(); }}
            className="text-xs border border-gray-300 rounded px-3 py-1 hover:border-blue-400 hover:text-blue-600 transition-colors"
          >
            {task.assignedTo || !canAssign ? 'View' : 'Assign'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface SiteDetailDrawerProps {
  site:    Site;
  open:    boolean;
  onClose: () => void;
  onArchived?: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function SiteDetailDrawer({
  site,
  open,
  onClose,
  onArchived,
}: SiteDetailDrawerProps) {
  const navigate               = useNavigate();
  const { showToast }          = useToast();
  const { currentUser }        = useAuthStore();
  const { siteTasks, loading: tasksLoading } = useSiteTasks(site.id);
  const { engineers, loading: engLoading }   = useFieldEngineers();
  const { approvers, loading: apprLoading }  = useApprovers();
  const { createWorkOrder }                  = useWorkOrderActions();
  const { addSiteTask }                      = useSiteActions();
  const { projects }                         = useProjectStore();
  const isAdmin = currentUser?.role === 'admin';

  // Task detail drawer
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  const selectedTask = siteTasks.find((t) => t.id === selectedTaskId) ?? null;

  // ── Add Task ──────────────────────────────────────────────────────────────
  const [showAddTask,  setShowAddTask]  = useState(false);
  const [pickedKeys,   setPickedKeys]   = useState<Set<string>>(new Set());
  const [taskQuery,    setTaskQuery]    = useState('');
  const [assigning,    setAssigning]    = useState(false);

  // Templates come from the site's PROJECT — the catalogue of work this
  // project defines, with their subtasks already authored on it. Ordered by
  // sortOrder so the list reads as the sequence the project intends rather
  // than however the array happens to sit.
  const projectTemplates = useMemo(() => {
    const project = projects.find((p) => p.id === site.projectId);
    return [...(project?.taskTemplates ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);
  }, [projects, site.projectId]);

  // Tasks in the PROJECT's order (its templates' sortOrder) — never alphabetical.
  // useSiteTasks returns them sorted by taskKey, which put "Site Commissioning"
  // ahead of "Site Installation". A task whose template has since been removed
  // from the project goes last, in the order it was added.
  const orderedSiteTasks = useMemo(() => {
    const position = new Map(projectTemplates.map((t, i) => [t.taskKey, i]));
    const rank = (key: string) => position.get(key) ?? projectTemplates.length;
    return [...siteTasks].sort((a, b) =>
      rank(a.taskKey) - rank(b.taskKey) || a.createdAt.getTime() - b.createdAt.getTime());
  }, [siteTasks, projectTemplates]);

  // A template already on this site can never be added again — one Material
  // Delivery per site, not two. Keyed on taskKey, which is what addSiteTask
  // derives its document id from, so this mirrors the structural guard there.
  const usedTaskKeys = useMemo(
    () => new Set(siteTasks.map((t) => t.taskKey)),
    [siteTasks],
  );

  const availableCount = projectTemplates.filter((t) => !usedTaskKeys.has(t.taskKey)).length;

  const visibleTemplates = useMemo(() => {
    const q = taskQuery.trim().toLowerCase();
    if (!q) return projectTemplates;
    return projectTemplates.filter((t) => t.label.toLowerCase().includes(q));
  }, [projectTemplates, taskQuery]);

  function openAddTask() {
    setPickedKeys(new Set());
    setTaskQuery('');
    setShowAddTask(true);
  }

  function closeAddTask() {
    if (assigning) return;
    setShowAddTask(false);
    setPickedKeys(new Set());
    setTaskQuery('');
  }

  function togglePicked(taskKey: string) {
    setPickedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(taskKey)) next.delete(taskKey); else next.add(taskKey);
      return next;
    });
  }

  /**
   * Creates every picked task, then closes.
   *
   * One addSiteTask call per template rather than a single batch: each needs
   * its own transaction to hold the "this template is on this site exactly
   * once" guarantee. A failure part-way leaves the successful ones in place —
   * they are independent tasks, so that is a partial success worth keeping
   * rather than something to roll back.
   */
  async function handleCompleteAssignment() {
    const picked = projectTemplates.filter((t) => pickedKeys.has(t.taskKey));
    if (picked.length === 0) { closeAddTask(); return; }

    setAssigning(true);
    let added = 0;
    let failed = 0;

    for (const template of picked) {
      try {
        if (await addSiteTask(
          {
            id: site.id, siteCode: site.siteCode, siteName: site.siteName,
            city: site.city, projectId: site.projectId,
            projectName: site.projectName, projectCode: site.projectCode,
          },
          template,
        )) added++;
        else failed++;   // already present — the race guard caught it
      } catch {
        failed++;
      }
    }

    setAssigning(false);
    setShowAddTask(false);
    setPickedKeys(new Set());
    setTaskQuery('');

    if (added > 0) {
      showToast(
        `${added} task${added !== 1 ? 's' : ''} added${failed > 0 ? `, ${failed} failed` : ''}`,
        failed > 0 ? 'warning' : 'success',
      );
    } else {
      showToast('No tasks were added. Try again.', 'error');
    }
  }

  const progressPct =
    site.taskCount > 0
      ? Math.round((site.completedTaskCount / site.taskCount) * 100)
      : 0;

  // site.location can be a truthy object with lat/lng undefined (e.g. a
  // malformed/empty location map written by an older bulk upload) — guard on
  // finite numbers, not just truthiness, before ever calling .toFixed() on it.
  const validLocation =
    site.location && Number.isFinite(site.location.lat) && Number.isFinite(site.location.lng)
      ? site.location
      : null;

  async function handleArchive() {
    try {
      await archiveSite(site.id, true);
      showToast('Site archived', 'success');
      onClose();
      onArchived?.();
    } catch {
      showToast('Failed to archive site', 'error');
    }
  }

  // ── GPS editor state ────────────────────────────────────────────────────
  const [gpsDialogOpen, setGpsDialogOpen] = useState(false);
  const [gpsInput,      setGpsInput]      = useState('');
  const [savingGps,     setSavingGps]     = useState(false);
  const [removeConfirm, setRemoveConfirm] = useState(false);
  const [removingGps,   setRemovingGps]   = useState(false);

  const parsedGps = useMemo(() => parseCoordinatesInput(gpsInput), [gpsInput]);
  const gpsValid  = parsedGps !== null && isValidLatLng(parsedGps.lat, parsedGps.lng);
  const gpsShowError = gpsInput.trim() !== '' && !gpsValid;

  function openGpsDialog() {
    setGpsInput(validLocation ? `${validLocation.lat}, ${validLocation.lng}` : '');
    setGpsDialogOpen(true);
  }

  function handleUseCurrentLocation() {
    if (!navigator.geolocation) {
      showToast('Geolocation is not supported on this device', 'error');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => setGpsInput(`${pos.coords.latitude}, ${pos.coords.longitude}`),
      (err) => {
        showToast(
          err.code === err.PERMISSION_DENIED
            ? 'Location permission denied.'
            : 'Could not get current location.',
          'error',
        );
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 0 },
    );
  }

  async function handleSaveGps() {
    if (!parsedGps || !gpsValid) return;
    setSavingGps(true);
    try {
      await updateSiteLocation(site.id, parsedGps);
      showToast('GPS location updated', 'success');
      setGpsDialogOpen(false);
    } catch {
      showToast('Failed to update GPS location', 'error');
    } finally {
      setSavingGps(false);
    }
  }

  async function handleRemoveGps() {
    setRemovingGps(true);
    try {
      await updateSiteLocation(site.id, null);
      showToast('GPS pin removed', 'success');
      setRemoveConfirm(false);
      setGpsDialogOpen(false);
    } catch {
      showToast('Failed to remove GPS pin', 'error');
    } finally {
      setRemovingGps(false);
    }
  }

  // ── Create Survey Work Order — admin only, plain entry point for testing ──
  // The engineer and ALL THREE approval stages are required: a stage with no
  // owner is a chain that can never complete, and unlike siteTasks there is no
  // unassigned-approver admin fallback for surveys (see useSurveyActions.ts's
  // reviewSurvey guard).
  //
  // All three pickers draw on the SAME pool — every user with role in
  // ('approver', 'admin'). No stage is typed differently from another; MSETCL
  // reviewers hold ordinary `approver` accounts, distinguished only by the
  // organisation shown next to their name.
  const [surveyDialogOpen,  setSurveyDialogOpen]  = useState(false);
  const [surveyEngineerId,  setSurveyEngineerId]  = useState('');
  /** stageKey -> chosen owner uid. */
  const [stageOwnerIds,     setStageOwnerIds]     = useState<Record<string, string>>({});
  const [creatingSurvey,    setCreatingSurvey]    = useState(false);

  const allStagesChosen = SURVEY_APPROVAL_STAGES.every((s) => !!stageOwnerIds[s.key]);
  const canCreateSurvey = !!surveyEngineerId && allStagesChosen;

  function openSurveyDialog() {
    setSurveyEngineerId('');
    setStageOwnerIds({});
    setSurveyDialogOpen(true);
  }

  async function handleCreateSurveyWorkOrder() {
    if (!canCreateSurvey) {
      showToast('Select a field expert and an owner for all three approval stages', 'error');
      return;
    }
    const engineer = engineers.find((e) => e.uid === surveyEngineerId);

    // Ordered to match SURVEY_APPROVAL_STAGES — createWorkOrder zips the two
    // together by position, and rejects the call if any owner is missing.
    const stageOwners = SURVEY_APPROVAL_STAGES.map((stage) => {
      const chosen = approvers.find((a) => a.uid === stageOwnerIds[stage.key]);
      return { ownerUid: chosen?.uid ?? '', ownerName: chosen?.displayName ?? '' };
    });

    setCreatingSurvey(true);
    try {
      const { workOrderCode } = await createWorkOrder({
        siteId:       site.id,
        siteCode:     site.siteCode,
        siteName:     site.siteName,
        sapCode:      site.sapCode      ?? null,
        zone:         site.zone         ?? null,
        voltageClass: site.voltageClass ?? null,
        assignedTo:      engineer?.uid         ?? null,
        assignedToName:  engineer?.displayName ?? null,
        stageOwners,
      });
      showToast(`Survey work order created: ${workOrderCode}`, 'success');
      setSurveyDialogOpen(false);
    } catch (err) {
      console.error('[SiteDetailDrawer] createWorkOrder failed:', err);
      const msg = err instanceof Error ? err.message : 'Failed to create survey work order';
      showToast(msg, 'error');
    } finally {
      setCreatingSurvey(false);
    }
  }

  return (
    <>
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="bottom" aria-describedby={undefined}>
        <SheetHeader>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-xs font-mono text-gray-400">{site.siteCode}</span>
            {site.projectCode && (
              <span className="text-xs font-mono font-semibold text-brand-blue bg-blue-50 rounded px-1.5 py-0.5">
                {site.projectCode}
              </span>
            )}
            <span
              className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_BADGE[site.status]}`}
            >
              {STATUS_LABELS[site.status]}
            </span>
          </div>
          <SheetTitle className="mt-1">{site.siteName}</SheetTitle>
          <p className="text-xs text-gray-500 mt-0.5">{site.projectName}</p>
        </SheetHeader>

        <div className="p-5 pt-4 flex flex-col gap-4">
          {/* Progress */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-gray-500">
                {site.completedTaskCount} of {site.taskCount} task
                {site.taskCount !== 1 ? 's' : ''} completed
              </span>
              <span className="text-xs font-medium text-gray-600">{progressPct}%</span>
            </div>
            <div className="h-3 w-full rounded-full bg-gray-100 overflow-hidden">
              <div
                className="h-full rounded-full bg-green-500 transition-all duration-300"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>

          {/* Details */}
          <div className="rounded-lg border border-gray-100 px-3 py-1">
            <InfoRow
              label="Location"
              value={
                <span className="flex items-center gap-1">
                  <MapPin className="h-3 w-3 text-gray-400 shrink-0" />
                  {site.city}{site.state ? `, ${site.state}` : ''}
                </span>
              }
            />
            {site.address && (
              <InfoRow label="Address" value={site.address} />
            )}
            <InfoRow
              label="Project"
              value={
                <span className="flex items-center gap-1">
                  <Building2 className="h-3 w-3 text-gray-400 shrink-0" />
                  {site.projectName}
                </span>
              }
            />
            <InfoRow
              label="Added"
              value={site.createdAt.toLocaleDateString('en-GB', {
                day:   '2-digit',
                month: 'short',
                year:  'numeric',
              })}
            />
            {validLocation ? (
              <InfoRow
                label="GPS"
                value={
                  <span className="flex items-center gap-2 flex-wrap">
                    <a
                      href={`https://www.google.com/maps?q=${validLocation.lat},${validLocation.lng}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: '#00B4D8' }}
                      className="hover:underline"
                    >
                      📍 {validLocation.lat.toFixed(5)}, {validLocation.lng.toFixed(5)}
                    </a>
                    {isAdmin && (
                      <button
                        type="button"
                        onClick={openGpsDialog}
                        className="inline-flex items-center gap-1 text-xs text-brand-blue hover:underline"
                      >
                        <Pencil className="h-3 w-3" />
                        Edit GPS
                      </button>
                    )}
                  </span>
                }
              />
            ) : (
              isAdmin && (
                <InfoRow
                  label="GPS"
                  value={
                    <button
                      type="button"
                      onClick={openGpsDialog}
                      className="inline-flex items-center gap-1 text-xs text-brand-blue hover:underline"
                    >
                      <MapPin className="h-3 w-3" />
                      Add GPS
                    </button>
                  }
                />
              )
            )}
          </div>

          {/* Tasks section */}
          <div>
            <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
              Tasks
            </h4>
            {tasksLoading ? (
              <div className="flex flex-col gap-2">
                {[...Array(3)].map((_, i) => (
                  <Skeleton key={i} className="h-16 rounded-lg" />
                ))}
              </div>
            ) : siteTasks.length === 0 ? (
              <p className="text-xs text-gray-400 text-center py-4">
                No tasks added yet.{isAdmin ? ' Use Add Task to pick one from this project.' : ''}
              </p>
            ) : (
              <div className="flex flex-col gap-3">
                {orderedSiteTasks.map((task) => (
                  <SiteTaskRow
                    key={task.id}
                    task={task}
                    canAssign={isAdmin}
                    onClick={() => setSelectedTaskId(task.id)}
                  />
                ))}
              </div>
            )}

            {/* Add Task — admin only; a viewer never creates work. Tasks are no
                longer spawned wholesale at site creation, so this is the only
                way one gets onto a site. */}
            {isAdmin && !tasksLoading && (
              <div className="mt-3">
                {projectTemplates.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-gray-200 px-3 py-2 text-center text-xs text-gray-400">
                    This project defines no task types yet — add them under Projects.
                  </p>
                ) : (
                  <button
                    type="button"
                    onClick={openAddTask}
                    disabled={availableCount === 0}
                    className="w-full rounded-lg border border-dashed border-gray-300 px-3 py-2 text-xs font-medium text-brand-blue transition-colors hover:border-brand-blue hover:bg-blue-50 disabled:cursor-not-allowed disabled:text-gray-400 disabled:hover:border-gray-300 disabled:hover:bg-transparent"
                  >
                    {availableCount === 0 ? 'All task types added' : '+ Add Task'}
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Work Orders section — per-site survey history + reassignment */}
          <SiteWorkOrdersSection siteId={site.id} onNavigateAway={onClose} />

          {/* Read-only companion view: work orders AND site tasks in one
              timeline. This drawer stays the management surface; that page is
              the comprehensive read-only one. Closes the sheet first, so the
              overlay never renders over the page being navigated to. */}
          <button
            type="button"
            onClick={() => { onClose(); navigate(`/sites/${site.id}`); }}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-gray-200 py-2 text-xs font-medium text-brand-blue transition-colors hover:bg-blue-50"
          >
            <History className="h-3.5 w-3.5" />
            View full lifecycle
          </button>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-1">
            {isAdmin && (
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 text-xs"
                onClick={openSurveyDialog}
              >
                <FileText className="h-3.5 w-3.5" />
                Create Survey Work Order
              </Button>
            )}
            {isAdmin && (
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 text-xs text-gray-500 border-gray-200 hover:border-red-200 hover:text-red-500"
                onClick={handleArchive}
              >
                <Archive className="h-3.5 w-3.5" />
                Archive Site
              </Button>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>

      {/* ── Add Task popup ──────────────────────────────────────────────────
          Multi-select: tick every task this site needs, then commit them in
          one go. Scrolls and filters so a project with many task types stays
          usable rather than turning into an unbounded list. */}
      <Dialog open={showAddTask} onOpenChange={(o) => { if (!o) closeAddTask(); }}>
        <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-lg" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>Add Tasks</DialogTitle>
          </DialogHeader>

          <p className="-mt-1 text-xs text-gray-500">
            Pick the tasks for <span className="font-medium text-gray-700">{site.siteName}</span>.
            They are listed in the order this project defines them.
          </p>

          {/* Filter appears only once the list is long enough to need it. */}
          {projectTemplates.length > 8 && (
            <Input
              value={taskQuery}
              onChange={(e) => setTaskQuery(e.target.value)}
              placeholder="Filter tasks…"
              autoComplete="off"
            />
          )}

          {/* The scroll region — the dialog itself never grows past 85vh. */}
          <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
            {visibleTemplates.length === 0 ? (
              <p className="py-8 text-center text-xs text-gray-400">
                No task types match that filter.
              </p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {visibleTemplates.map((t) => {
                  // Numbered by position in the PROJECT order, not in the
                  // filtered view, so the step number means the same thing
                  // whether or not a filter is active.
                  const step   = projectTemplates.findIndex((p) => p.taskKey === t.taskKey) + 1;
                  const used   = usedTaskKeys.has(t.taskKey);
                  const picked = pickedKeys.has(t.taskKey);
                  return (
                    <button
                      key={t.taskKey}
                      type="button"
                      disabled={used || assigning}
                      onClick={() => togglePicked(t.taskKey)}
                      className={cn(
                        'flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-colors',
                        used
                          ? 'border-gray-200 bg-gray-50 opacity-60'
                          : picked
                            ? 'border-brand-blue bg-blue-50'
                            : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50',
                      )}
                    >
                      <span
                        className={cn(
                          'flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] font-bold text-white',
                          picked ? 'border-brand-blue bg-brand-blue' : 'border-gray-300 bg-white',
                        )}
                      >
                        {picked ? '✓' : ''}
                      </span>
                      <span className="w-4 shrink-0 text-[10px] font-semibold text-gray-400">
                        {step}
                      </span>
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: t.colour }}
                      />
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-gray-800">
                        {t.label}
                      </span>
                      <span className="shrink-0 text-[10px] text-gray-400">
                        {used
                          ? 'Added'
                          : `${t.subtasks.length} subtask${t.subtasks.length !== 1 ? 's' : ''}`}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="flex shrink-0 gap-2 border-t border-gray-100 pt-3">
            <Button
              variant="outline"
              className="flex-1"
              onClick={closeAddTask}
              disabled={assigning}
            >
              Cancel
            </Button>
            <Button
              className="flex-1"
              onClick={handleCompleteAssignment}
              disabled={assigning || pickedKeys.size === 0}
            >
              {assigning ? (
                <span className="flex items-center gap-2">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  Assigning…
                </span>
              ) : (
                `Complete Task Assignment${pickedKeys.size > 0 ? ` (${pickedKeys.size})` : ''}`
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

    {/* Task detail drawer — stacks on top of this sheet.
        readOnly for a viewer: hides the assignment form, the approver form,
        Archive Task and Refresh Subtasks, leaving the checklist/photos/GPS/
        history the viewer is meant to see. */}
    <SiteTaskDetailDrawer
      task={selectedTask}
      open={!!selectedTaskId}
      onClose={() => setSelectedTaskId(null)}
      readOnly={!isAdmin}
    />

    {/* Edit GPS dialog — admin only */}
    {isAdmin && (
      <Dialog open={gpsDialogOpen} onOpenChange={(v) => { if (!v && !savingGps && !removingGps) { setGpsDialogOpen(false); setRemoveConfirm(false); } }}>
        <DialogContent className="max-w-sm" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>{validLocation ? 'Edit GPS' : 'Add GPS'}</DialogTitle>
          </DialogHeader>

          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="gps-input" className="text-xs font-medium text-gray-600">
                Paste coordinates or Google Maps link
              </label>
              <Input
                id="gps-input"
                value={gpsInput}
                onChange={(e) => setGpsInput(e.target.value)}
                placeholder="21.1458, 79.0882 or a Google Maps link"
                className={gpsShowError ? 'border-brand-red focus-visible:ring-brand-red' : ''}
                disabled={savingGps || removingGps}
                autoFocus
              />
              {gpsShowError && (
                <p className="text-xs text-brand-red">
                  Couldn&apos;t parse a valid coordinate pair from that input.
                </p>
              )}
            </div>

            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5 text-xs self-start"
              onClick={handleUseCurrentLocation}
              disabled={savingGps || removingGps}
            >
              <Navigation className="h-3.5 w-3.5" />
              Use my current location
            </Button>

            {validLocation && !removeConfirm && (
              <button
                type="button"
                onClick={() => setRemoveConfirm(true)}
                className="inline-flex items-center gap-1 text-xs text-brand-red hover:underline self-start"
                disabled={savingGps || removingGps}
              >
                <XCircle className="h-3.5 w-3.5" />
                Remove pin
              </button>
            )}

            {removeConfirm && (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 flex flex-col gap-2">
                <p className="text-xs text-red-700">
                  Remove this site&apos;s GPS pin? It will no longer appear on the map.
                </p>
                <div className="flex gap-2 justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="text-xs"
                    onClick={() => setRemoveConfirm(false)}
                    disabled={removingGps}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    className="text-xs bg-brand-red hover:bg-red-700"
                    onClick={handleRemoveGps}
                    disabled={removingGps}
                  >
                    {removingGps ? 'Removing…' : 'Remove Pin'}
                  </Button>
                </div>
              </div>
            )}

            <div className="flex gap-2 justify-end pt-1 border-t border-gray-100">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => { setGpsDialogOpen(false); setRemoveConfirm(false); }}
                disabled={savingGps || removingGps}
              >
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={handleSaveGps}
                disabled={!gpsValid || savingGps || removingGps}
              >
                {savingGps ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    )}

    {/* Create Survey Work Order dialog — admin only */}
    {isAdmin && (
      <Dialog
        open={surveyDialogOpen}
        onOpenChange={(v) => { if (!v && !creatingSurvey) setSurveyDialogOpen(false); }}
      >
        <DialogContent className="max-w-sm" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>Create Survey Work Order</DialogTitle>
          </DialogHeader>

          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-gray-600">
                Field Expert <span className="text-brand-red">*</span>
              </label>
              {engLoading ? (
                <Skeleton className="h-9 rounded-md" />
              ) : (
                <Select value={surveyEngineerId} onValueChange={setSurveyEngineerId}>
                  <SelectTrigger disabled={creatingSurvey}>
                    <SelectValue placeholder="Select engineer…" />
                  </SelectTrigger>
                  <SelectContent>
                    {engineers.map((e) => (
                      <SelectItem key={e.uid} value={e.uid}>
                        {e.displayName}
                        {e.engineerCode ? ` (${e.engineerCode})` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            {/* One picker per approval stage, in chain order. All required. */}
            <div className="flex flex-col gap-3 pt-1 border-t border-gray-100">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                Approval Chain
              </p>
              {SURVEY_APPROVAL_STAGES.map((stage, i) => (
                <div key={stage.key} className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-gray-600">
                    {i + 1}. {stage.label} <span className="text-brand-red">*</span>
                  </label>
                  {apprLoading ? (
                    <Skeleton className="h-9 rounded-md" />
                  ) : (
                    <Select
                      value={stageOwnerIds[stage.key] ?? ''}
                      onValueChange={(v) =>
                        setStageOwnerIds((prev) => ({ ...prev, [stage.key]: v }))
                      }
                    >
                      <SelectTrigger disabled={creatingSurvey}>
                        <SelectValue placeholder="Select approver…" />
                      </SelectTrigger>
                      <SelectContent>
                        {approvers.map((a) => (
                          <SelectItem key={a.uid} value={a.uid}>
                            {approverLabel(a)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              ))}
              <p className="text-xs text-gray-400">
                Reviewed in this order — each stage hands over to the next once
                approved. A stage with no owner cannot be reviewed by anyone.
              </p>
            </div>

            <div className="flex gap-2 justify-end pt-1 border-t border-gray-100">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setSurveyDialogOpen(false)}
                disabled={creatingSurvey}
              >
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={handleCreateSurveyWorkOrder}
                disabled={creatingSurvey || !canCreateSurvey}
              >
                {creatingSurvey ? 'Creating…' : 'Create'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    )}
    </>
  );
}

// ─── Archived variant ─────────────────────────────────────────────────────────

interface ArchivedSiteDetailDrawerProps {
  site:       Site;
  open:       boolean;
  onClose:    () => void;
  onRestored: () => void;
}

export function ArchivedSiteDetailDrawer({
  site,
  open,
  onClose,
  onRestored,
}: ArchivedSiteDetailDrawerProps) {
  const { showToast } = useToast();

  async function handleRestore() {
    try {
      await archiveSite(site.id, false);
      showToast('Site restored', 'success');
      onClose();
      onRestored();
    } catch {
      showToast('Failed to restore site', 'error');
    }
  }

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="bottom" aria-describedby={undefined}>
        <SheetHeader>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-xs font-mono text-gray-400">{site.siteCode}</span>
            {site.projectCode && (
              <span className="text-xs font-mono font-semibold text-brand-blue bg-blue-50 rounded px-1.5 py-0.5">
                {site.projectCode}
              </span>
            )}
            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">
              Archived
            </span>
          </div>
          <SheetTitle className="mt-1">{site.siteName}</SheetTitle>
          <p className="text-xs text-gray-500 mt-0.5">{site.projectName}</p>
        </SheetHeader>

        <div className="p-5 pt-4 flex flex-col gap-4">
          <div className="rounded-lg border border-gray-100 px-3 py-1">
            <InfoRow label="Location" value={`${site.city}${site.state ? `, ${site.state}` : ''}`} />
            {site.address && <InfoRow label="Address" value={site.address} />}
            <InfoRow label="Project" value={site.projectName} />
            {site.archivedAt && (
              <InfoRow
                label="Archived"
                value={site.archivedAt.toLocaleDateString('en-GB', {
                  day:   '2-digit',
                  month: 'short',
                  year:  'numeric',
                })}
              />
            )}
          </div>

          <div className="flex justify-end pt-1">
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 text-xs"
              onClick={handleRestore}
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Restore Site
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
