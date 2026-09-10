import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, MapPin, ClipboardCheck, ClipboardList, ChevronRight } from 'lucide-react';
import { useSiteLifecycle, summariseStages } from '@/hooks/useSiteLifecycle';
import { useSiteTasks } from '@/hooks/useSiteTasks';
import { SiteTaskDetailDrawer } from '@/components/siteTasks/SiteTaskDetailDrawer';
import { Button }   from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type { LifecycleEntry } from '@/hooks/useSiteLifecycle';
import type { Site, TaskStatus, WorkOrderStatus } from '@/types';

// ─── Constants ────────────────────────────────────────────────────────────────
// Local badge/label maps, matching how every other list surface in this app
// carries its own (AdminSurveyOversightPage, SiteWorkOrdersSection, …). The two
// status unions don't overlap fully, so a timeline row picks its map by `kind`.

const WORK_ORDER_STATUS_BADGE: Record<WorkOrderStatus, string> = {
  open:              'bg-gray-100 text-gray-600',
  in_progress:       'bg-amber-50 text-amber-700',
  pending_approval:  'bg-violet-50 text-violet-700',
  changes_requested: 'bg-orange-50 text-orange-700',
  approved:          'bg-green-50 text-green-700',
  closed:            'bg-gray-200 text-gray-600',
};

const WORK_ORDER_STATUS_LABEL: Record<WorkOrderStatus, string> = {
  open:              'Open',
  in_progress:       'In Progress',
  pending_approval:  'Pending Approval',
  changes_requested: 'Changes Requested',
  approved:          'Approved',
  closed:            'Closed',
};

const TASK_STATUS_BADGE: Record<TaskStatus, string> = {
  pending:           'bg-gray-100 text-gray-600',
  in_progress:       'bg-amber-50 text-amber-700',
  pending_approval:  'bg-violet-50 text-violet-700',
  changes_requested: 'bg-orange-50 text-orange-700',
  completed:         'bg-green-50 text-green-700',
  blocked:           'bg-red-50 text-red-700',
};

const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  pending:           'Pending',
  in_progress:       'In Progress',
  pending_approval:  'Pending Approval',
  changes_requested: 'Changes Requested',
  completed:         'Completed',
  blocked:           'Blocked',
};

function statusBadgeClass(entry: LifecycleEntry): string {
  return entry.kind === 'workOrder'
    ? WORK_ORDER_STATUS_BADGE[entry.status as WorkOrderStatus] ?? 'bg-gray-100 text-gray-600'
    : TASK_STATUS_BADGE[entry.status as TaskStatus] ?? 'bg-gray-100 text-gray-600';
}

function statusLabel(entry: LifecycleEntry): string {
  return entry.kind === 'workOrder'
    ? WORK_ORDER_STATUS_LABEL[entry.status as WorkOrderStatus] ?? entry.status
    : TASK_STATUS_LABEL[entry.status as TaskStatus] ?? entry.status;
}

function formatDateTime(d: Date): string {
  return d.toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

// ─── Header ───────────────────────────────────────────────────────────────────

function InfoCell({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wide text-gray-400">{label}</span>
      <span className="truncate text-sm text-gray-800">{value}</span>
    </div>
  );
}

function SiteHeader({ site }: { site: Site }) {
  // site.location can be a truthy object with lat/lng undefined (a malformed
  // location map written by an older bulk upload) — guard on finite numbers,
  // not truthiness, before calling .toFixed(). Same check as SiteDetailDrawer.
  const validLocation =
    site.location && Number.isFinite(site.location.lat) && Number.isFinite(site.location.lng)
      ? site.location
      : null;

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs text-gray-400">{site.siteCode}</span>
        {site.projectCode && (
          <span className="rounded bg-blue-50 px-1.5 py-0.5 font-mono text-xs font-semibold text-brand-blue">
            {site.projectCode}
          </span>
        )}
        {site.archived && (
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">
            Archived
          </span>
        )}
      </div>

      <div>
        <h2 className="text-xl font-bold leading-snug text-gray-900">{site.siteName}</h2>
        <p className="mt-0.5 text-xs text-gray-500">
          {site.projectName}
          {site.city ? ` · ${site.city}` : ''}{site.state ? `, ${site.state}` : ''}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 border-t border-gray-100 pt-3 sm:grid-cols-4">
        <InfoCell label="SAP Code" value={site.sapCode || '—'} />
        <InfoCell label="Zone"     value={site.zone || '—'} />
        <InfoCell
          label="Voltage Class"
          value={site.voltageClass ? `${site.voltageClass} kV` : '—'}
        />
        <InfoCell
          label="GPS"
          value={
            validLocation ? (
              <a
                href={`https://www.google.com/maps?q=${validLocation.lat},${validLocation.lng}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-brand-blue hover:underline"
              >
                <MapPin className="h-3 w-3 shrink-0" />
                {validLocation.lat.toFixed(5)}, {validLocation.lng.toFixed(5)}
              </a>
            ) : '—'
          }
        />
      </div>
    </div>
  );
}

// ─── Stage summary ────────────────────────────────────────────────────────────

function StageSummaryGrid({ entries }: { entries: LifecycleEntry[] }) {
  const stages = summariseStages(entries);

  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">
        Contract Lifecycle
      </h3>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {stages.map((s) => (
          <div
            key={s.stage}
            className={cn(
              'flex flex-col gap-1 rounded-lg border p-3',
              s.status ? 'border-gray-200 bg-white' : 'border-dashed border-gray-200 bg-gray-50',
            )}
          >
            <span className="text-xs font-semibold text-gray-700">{s.label}</span>
            {s.status ? (
              <>
                <span className={cn(
                  'w-fit rounded-full px-2 py-0.5 text-[10px] font-medium',
                  WORK_ORDER_STATUS_BADGE[s.status],
                )}>
                  {WORK_ORDER_STATUS_LABEL[s.status]}
                </span>
                {s.count > 1 && (
                  <span className="text-[10px] text-gray-400">{s.count} work orders</span>
                )}
              </>
            ) : (
              <span className="text-[10px] text-gray-400">Not started</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Timeline ─────────────────────────────────────────────────────────────────

function TimelineRow({ entry, onOpen }: { entry: LifecycleEntry; onOpen: () => void }) {
  const isWorkOrder = entry.kind === 'workOrder';
  // A row is only interactive when there is somewhere to go: a survey record
  // page, or the site-task drawer. Future stages have neither yet.
  const openable = isWorkOrder ? !!entry.linkTo : true;

  return (
    <div
      className={cn(
        'flex items-start gap-3 rounded-lg border border-gray-100 bg-white p-3 shadow-sm transition-all',
        openable && 'cursor-pointer hover:border-blue-300 hover:shadow',
      )}
      onClick={openable ? onOpen : undefined}
    >
      <div className={cn(
        'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full',
        isWorkOrder ? 'bg-violet-50 text-violet-600' : 'bg-blue-50 text-brand-blue',
      )}>
        {isWorkOrder
          ? <ClipboardCheck className="h-3.5 w-3.5" />
          : <ClipboardList  className="h-3.5 w-3.5" />}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-sm font-semibold text-gray-900">{entry.label}</span>
          <span className="rounded bg-gray-100 px-1.5 py-px text-[10px] font-medium text-gray-500">
            {isWorkOrder ? 'Work Order' : 'Site Task'}
          </span>
        </div>
        {entry.code && (
          <p className="font-mono text-xs text-gray-400">{entry.code}</p>
        )}
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-gray-500">
          <span>{entry.assignedToName ?? <span className="italic text-gray-400">Unassigned</span>}</span>
          <span>{formatDateTime(entry.updatedAt)}</span>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        <span className={cn(
          'rounded-full px-2 py-0.5 text-xs font-medium',
          statusBadgeClass(entry),
        )}>
          {statusLabel(entry)}
        </span>
        {openable && <ChevronRight className="h-4 w-4 text-gray-300" />}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

/**
 * Substation Lifecycle — one site, its whole story in one place.
 *
 * READ-ONLY BY DESIGN. There are deliberately no write actions here: this is
 * the monitoring surface that answers "what has happened at this substation",
 * and anyone who needs to act follows a row through to SiteDetailDrawer or the
 * survey record screen, which own creating, assigning and reviewing. Adding an
 * action here would duplicate those surfaces and their guards.
 *
 * Admin and viewer both get full access — an unscoped read-only oversight
 * account is exactly what this page is for.
 */
export function SubstationLifecyclePage() {
  const { siteId } = useParams<{ siteId: string }>();
  const navigate = useNavigate();
  const { site, entries, loading, error } = useSiteLifecycle(siteId);

  // Site tasks have no route of their own — they open the EXISTING drawer,
  // read-only. useSiteTasks gives the full SiteTask the drawer needs (the
  // lifecycle hook only carries the handful of fields the timeline renders).
  const { siteTasks } = useSiteTasks(siteId ?? '');
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const openTask = siteTasks.find((t) => t.id === openTaskId) ?? null;

  function openEntry(entry: LifecycleEntry) {
    if (entry.kind === 'siteTask') { setOpenTaskId(entry.id); return; }
    if (entry.linkTo) navigate(entry.linkTo);
  }

  if (loading) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-4 pb-24">
        <Skeleton className="h-40 rounded-xl" />
        <Skeleton className="h-24 rounded-xl" />
        <Skeleton className="h-56 rounded-xl" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 text-center text-sm text-brand-red">
        Failed to load this substation: {error}
      </div>
    );
  }

  if (!site) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col items-center gap-3 p-6 text-center">
        <p className="text-sm text-gray-400">
          Substation not found, or you don&apos;t have access to it.
        </p>
        <Button type="button" variant="outline" size="sm" onClick={() => navigate('/sites')}>
          Back to Sites
        </Button>
      </div>
    );
  }

  return (
    <>
      <div className="mx-auto flex max-w-3xl flex-col gap-4 pb-24">
        <div className="flex items-start gap-2">
          <Button
            type="button" variant="outline" size="sm"
            onClick={() => navigate('/sites')}
            aria-label="Back to sites"
            className="shrink-0"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-wide text-gray-400">Substation Lifecycle</p>
            <p className="text-xs text-gray-500">Read-only overview</p>
          </div>
        </div>

        <SiteHeader site={site} />

        <StageSummaryGrid entries={entries} />

        <div>
          <div className="mb-2 flex items-center gap-2">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
              Timeline
            </h3>
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-600">
              {entries.length}
            </span>
          </div>

          {entries.length === 0 ? (
            <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 py-12 text-center">
              <p className="text-sm text-gray-400">No activity recorded at this substation yet.</p>
              <p className="mt-1 text-xs text-gray-400">
                Work orders and site tasks will appear here as they are created.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {entries.map((entry) => (
                <TimelineRow
                  key={`${entry.kind}-${entry.id}`}
                  entry={entry}
                  onOpen={() => openEntry(entry)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* The existing site-task viewer, read-only — this page never edits.
          readOnly hides the assignment form, approver form, Archive Task and
          Refresh Subtasks, leaving checklist / photos / GPS / history. */}
      <SiteTaskDetailDrawer
        task={openTask}
        open={!!openTaskId}
        onClose={() => setOpenTaskId(null)}
        readOnly
      />
    </>
  );
}
