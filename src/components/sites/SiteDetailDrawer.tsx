import { useState, useMemo }      from 'react';
import { MapPin, Building2, Archive, RotateCcw, Pencil, Navigation, XCircle } from 'lucide-react';
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
import { Button }        from '@/components/ui/button';
import { Input }         from '@/components/ui/input';
import { Skeleton }      from '@/components/ui/skeleton';
import { archiveSite, updateSiteLocation } from '@/hooks/useSiteActions';
import { useSiteTasks }             from '@/hooks/useSiteTasks';
import { useToast }                 from '@/components/ui/toast';
import { useAuthStore }             from '@/store/authStore';
import { SiteTaskDetailDrawer }     from '@/components/siteTasks/SiteTaskDetailDrawer';
import type { Site, SiteStatus, SiteTask, TaskStatus } from '@/types';

// ─── GPS input parsing ─────────────────────────────────────────────────────────
//
// Accepts, in priority order:
//   1. A Google Maps URL with an "@<lat>,<lng>" viewport centre, e.g.
//      https://www.google.com/maps/@21.1458,79.0882,15z
//   2. A Google Maps URL with a "?q=<lat>,<lng>" query param.
//   3. A Google Maps URL with a "!3d<lat>!4d<lng>" place-pin segment.
//   4. A plain "<lat>, <lng>" pair (comma and/or whitespace separated).
// Shortened share links (maps.app.goo.gl/...) can't be expanded client-side
// without a network request, so they intentionally fall through to "no match".

const NUM = String.raw`-?\d+(?:\.\d+)?`;
const MAPS_AT_RE    = new RegExp(`@(${NUM}),(${NUM})`);
const MAPS_Q_RE     = new RegExp(`[?&]q=(${NUM}),(${NUM})`);
const MAPS_3D4D_RE  = new RegExp(`!3d(${NUM})!4d(${NUM})`);
const PLAIN_PAIR_RE = new RegExp(`^\\s*(${NUM})\\s*[,\\s]\\s*(${NUM})\\s*$`);

function parseCoordinatesInput(raw: string): { lat: number; lng: number } | null {
  const input = raw.trim();
  if (!input) return null;

  for (const re of [MAPS_AT_RE, MAPS_Q_RE, MAPS_3D4D_RE, PLAIN_PAIR_RE]) {
    const match = input.match(re);
    if (match) {
      return { lat: parseFloat(match[1]), lng: parseFloat(match[2]) };
    }
  }

  return null;
}

function isValidLatLng(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) && Number.isFinite(lng) &&
    lat >= -90 && lat <= 90 &&
    lng >= -180 && lng <= 180
  );
}

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
  onClick,
}: {
  task:    SiteTask;
  onClick: () => void;
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
            {task.assignedTo ? 'View' : 'Assign'}
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
  const { showToast }          = useToast();
  const { currentUser }        = useAuthStore();
  const { siteTasks, loading: tasksLoading } = useSiteTasks(site.id);
  const isAdmin = currentUser?.role === 'admin';

  // Task detail drawer
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const selectedTask = siteTasks.find((t) => t.id === selectedTaskId) ?? null;

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
                No tasks created yet. Tasks will be created automatically in the next phase.
              </p>
            ) : (
              <div className="flex flex-col gap-3">
                {siteTasks.map((task) => (
                  <SiteTaskRow
                    key={task.id}
                    task={task}
                    onClick={() => setSelectedTaskId(task.id)}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Archive action */}
          <div className="flex justify-end pt-1">
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 text-xs text-gray-500 border-gray-200 hover:border-red-200 hover:text-red-500"
              onClick={handleArchive}
            >
              <Archive className="h-3.5 w-3.5" />
              Archive Site
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>

    {/* Task detail drawer — stacks on top of this sheet */}
    <SiteTaskDetailDrawer
      task={selectedTask}
      open={!!selectedTaskId}
      onClose={() => setSelectedTaskId(null)}
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
