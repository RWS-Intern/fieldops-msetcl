import { useState }               from 'react';
import { MapPin, Building2, Archive, RotateCcw } from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button }        from '@/components/ui/button';
import { Skeleton }      from '@/components/ui/skeleton';
import { archiveSite }              from '@/hooks/useSiteActions';
import { useSiteTasks }             from '@/hooks/useSiteTasks';
import { useToast }                 from '@/components/ui/toast';
import { SiteTaskDetailDrawer }     from '@/components/siteTasks/SiteTaskDetailDrawer';
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
  pending:     'bg-gray-100 text-gray-600',
  in_progress: 'bg-amber-50 text-amber-700',
  completed:   'bg-green-50 text-green-700',
  blocked:     'bg-red-50 text-red-700',
};

const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  pending:     'Pending',
  in_progress: 'In Progress',
  completed:   'Completed',
  blocked:     'Blocked',
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
      className="flex rounded-lg border border-gray-100 overflow-hidden cursor-pointer hover:border-brand-blue transition-colors"
      onClick={onClick}
    >
      {/* Colour stripe */}
      <div className="w-1 shrink-0" style={{ backgroundColor: task.taskColour }} />
      <div className="flex-1 p-2.5 min-w-0">
        {/* Label + status badge */}
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <span className="text-sm font-semibold text-gray-900 leading-snug">
            {task.taskLabel}
          </span>
          <span
            className={`text-xs font-medium px-2 py-0.5 rounded-full shrink-0 ${TASK_STATUS_BADGE[task.status]}`}
          >
            {TASK_STATUS_LABELS[task.status]}
          </span>
        </div>
        {/* taskKey — shown so admins know the exact string for bulk assignment CSV */}
        <span className="text-xs text-gray-400 font-mono mt-0.5 block">
          {task.taskKey}
        </span>
        {/* Assignee + Assign/View button */}
        <div className="flex items-center justify-between mt-1.5 gap-2">
          <span className={`text-xs ${task.assignedTo ? 'text-gray-600' : 'text-gray-400'}`}>
            {task.assignedTo
              ? `${task.assignedToName ?? ''}${task.assignedToCode ? ` (${task.assignedToCode})` : ''}`
              : 'Unassigned'}
          </span>
          <Button
            variant="outline"
            size="sm"
            className="h-6 text-xs px-2 shrink-0"
          >
            {task.assignedTo ? 'View' : 'Assign'}
          </Button>
        </div>
        {/* Due date */}
        {task.dueDate && (
          <p className="text-xs text-gray-400 mt-1">
            Due{' '}
            {task.dueDate.toLocaleDateString('en-GB', {
              day: '2-digit', month: 'short', year: 'numeric',
            })}
          </p>
        )}
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
  const { siteTasks, loading: tasksLoading } = useSiteTasks(site.id);

  // Task detail drawer
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const selectedTask = siteTasks.find((t) => t.id === selectedTaskId) ?? null;

  const progressPct =
    site.taskCount > 0
      ? Math.round((site.completedTaskCount / site.taskCount) * 100)
      : 0;

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
            <div className="h-2 w-full rounded-full bg-gray-100 overflow-hidden">
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
            {site.location && (
              <InfoRow
                label="GPS"
                value={
                  <a
                    href={`https://www.google.com/maps?q=${site.location.lat},${site.location.lng}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: '#00B4D8' }}
                    className="hover:underline"
                  >
                    📍 {site.location.lat.toFixed(5)}, {site.location.lng.toFixed(5)}
                  </a>
                }
              />
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
              <div className="flex flex-col gap-2">
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
