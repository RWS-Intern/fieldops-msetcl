import { useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, ChevronRight, MapPin, Search, SlidersHorizontal,
  ClipboardList, ClipboardCheck, ExternalLink, FileText,
  Database, Clock, User, Calendar, X,
} from 'lucide-react';
import { useSiteLifecycle } from '@/hooks/useSiteLifecycle';
import { useSiteTasks } from '@/hooks/useSiteTasks';
import { useSiteTaskUpdates } from '@/hooks/useSiteTaskUpdates';
import { useSurveyReport } from '@/hooks/useSurveyReport';
import { useSurveyUpdates } from '@/hooks/useSurveyUpdates';
import { findApprovalStage } from '@/lib/approvalStages';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type { LifecycleEntry } from '@/hooks/useSiteLifecycle';
import type { SiteTask, SurveyUpdate } from '@/types';

/**
 * Full lifecycle detail for one substation — a master/detail view of every
 * task and work order at the site.
 *
 * Deliberately a SEPARATE screen from SubstationLifecyclePage, which stays a
 * quick-glance timeline: this one trades scannability for completeness.
 *
 * READ-ONLY throughout. Nothing here assigns, submits, reviews or archives —
 * the existing drawers own every one of those, and this page duplicates none
 * of their write paths.
 */

// ─── Status presentation ──────────────────────────────────────────────────────

const TASK_BADGE: Record<string, string> = {
  pending:           'bg-amber-50 text-amber-700',
  in_progress:       'bg-amber-50 text-amber-700',
  pending_approval:  'bg-violet-50 text-violet-700',
  changes_requested: 'bg-orange-50 text-orange-700',
  completed:         'bg-green-50 text-green-700',
  blocked:           'bg-red-50 text-red-700',
};

const WORK_ORDER_BADGE: Record<string, string> = {
  open:              'bg-blue-50 text-blue-700',
  in_progress:       'bg-amber-50 text-amber-700',
  pending_approval:  'bg-violet-50 text-violet-700',
  changes_requested: 'bg-orange-50 text-orange-700',
  approved:          'bg-green-50 text-green-700',
  closed:            'bg-gray-100 text-gray-600',
};

/**
 * Audit-trail wording, kept identical to ApproverSurveyReviewPage's
 * ACTION_LABEL. 'agree'/'disagree' are escalation-review decisions — a stage
 * agreeing or disagreeing with a flag raised above it — and are deliberately
 * distinct from approve/request_changes so the history says what happened.
 */
const SURVEY_ACTION_LABEL: Record<SurveyUpdate['action'], string> = {
  submit:          'Submitted',
  approve:         'Approved',
  request_changes: 'Changes Requested',
  agree:           'Agreed With Flag',
  disagree:        'Disagreed With Flag',
};

const SURVEY_ACTION_BADGE: Record<SurveyUpdate['action'], string> = {
  submit:          'bg-blue-50 text-blue-700',
  approve:         'bg-green-50 text-green-700',
  request_changes: 'bg-orange-50 text-orange-700',
  agree:           'bg-orange-50 text-orange-700',
  disagree:        'bg-violet-50 text-violet-700',
};

function prettyStatus(status: string): string {
  if (!status) return '—';
  return status.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function badgeClass(entry: LifecycleEntry): string {
  const map = entry.kind === 'workOrder' ? WORK_ORDER_BADGE : TASK_BADGE;
  return map[entry.status] ?? 'bg-gray-100 text-gray-600';
}

function formatDateTime(d: Date | null | undefined): string {
  if (!d || Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

// ─── Shared pieces ────────────────────────────────────────────────────────────

/** One cell of the four-up metadata strip under the panel header. */
function MetaCell({
  icon: Icon, label, value,
}: {
  icon:  typeof Database;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-start gap-2.5 px-4 py-3">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
      <div className="min-w-0">
        <p className="text-xs text-gray-500">{label}</p>
        <div className="break-words text-sm font-semibold leading-snug text-gray-900">
          {value || '—'}
        </div>
      </div>
    </div>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-2.5 text-xs font-semibold uppercase tracking-wide text-gray-500">
      {children}
    </h3>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-gray-500">{label}</p>
      <div className="mt-0.5 break-words text-sm font-medium text-gray-900">{value || '—'}</div>
    </div>
  );
}

function PhotoGrid({ urls, label }: { urls: string[]; label: string }) {
  if (urls.length === 0) return null;
  return (
    <div>
      <p className="mb-2 text-xs text-gray-500">{label}</p>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {urls.map((url, i) => (
          <a
            key={i}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="aspect-square overflow-hidden rounded-xl border border-gray-200 transition-colors hover:border-brand-blue"
          >
            <img src={url} alt={`${label} ${i + 1}`} className="h-full w-full object-cover" />
          </a>
        ))}
      </div>
    </div>
  );
}

/** The bordered row used for "Survey Record" and similar navigations. */
function LinkCard({
  icon: Icon, title, description, onClick,
}: {
  icon: typeof FileText;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-4 rounded-xl bg-gray-50 px-4 py-4 text-left transition-colors hover:bg-gray-100"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-gray-500 shadow-sm">
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-gray-900">{title}</span>
        <span className="mt-0.5 block text-xs text-gray-500">{description}</span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-gray-400" />
    </button>
  );
}

// ─── Detail body: a site task ─────────────────────────────────────────────────

function SiteTaskBody({ task }: { task: SiteTask }) {
  // Mounted only while its row is selected, so this opens exactly one history
  // listener — the one the user is looking at.
  const { updates, loading } = useSiteTaskUpdates(task.id);

  const checklistPhotos = useMemo(
    () => Object.values(task.subtaskPhotos ?? {}).flat(),
    [task.subtaskPhotos],
  );

  return (
    <div className="flex flex-col gap-6">
      {/* ── Metadata strip ── */}
      <div className="grid grid-cols-2 rounded-xl bg-gray-50 lg:grid-cols-4 lg:divide-x lg:divide-gray-200">
        <MetaCell icon={Clock}    label="Status"       value={prettyStatus(task.status)} />
        <MetaCell icon={User}     label="Assigned to"  value={task.assignedToName ?? 'Unassigned'} />
        <MetaCell icon={User}     label="Approver"     value={task.approverName ?? 'Unassigned'} />
        <MetaCell icon={Calendar} label="Last updated" value={formatDateTime(task.updatedAt)} />
      </div>

      {/* ── Overview ── */}
      <div>
        <SectionHeading>Overview</SectionHeading>
        <div className="grid grid-cols-2 gap-x-6 gap-y-4 rounded-xl bg-gray-50 px-4 py-4 sm:grid-cols-4">
          <Field label="Engineer Code" value={task.assignedToCode} />
          <Field label="Start Date"    value={task.startDate ? formatDateTime(task.startDate) : null} />
          <Field label="Due Date"      value={task.dueDate ? formatDateTime(task.dueDate) : null} />
          <Field label="Submitted"     value={task.submittedAt ? formatDateTime(task.submittedAt) : null} />
        </div>
      </div>

      {task.blockedReason && (
        <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-red-500">Blocked</p>
          <p className="mt-1 text-sm text-red-700">{task.blockedReason}</p>
        </div>
      )}

      {task.reviewNotes && (
        <div className="rounded-xl border border-orange-100 bg-orange-50 px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-orange-500">
            Reviewer Notes{task.reviewedByName ? ` — ${task.reviewedByName}` : ''}
          </p>
          <p className="mt-1 text-sm text-orange-800">{task.reviewNotes}</p>
        </div>
      )}

      {/* ── Checklist ── */}
      {task.subtasks.length > 0 && (
        <div>
          <SectionHeading>Checklist</SectionHeading>
          <div className="overflow-hidden rounded-xl border border-gray-200">
            {task.subtasks.map((sub, i) => {
              const answer = task.subtaskAnswers?.[sub.subtaskId];
              const value  = answer?.value ?? '';
              const photos = task.subtaskPhotos?.[sub.subtaskId] ?? [];
              return (
                <div
                  key={sub.subtaskId}
                  className={cn(
                    'flex items-start justify-between gap-3 px-4 py-3',
                    i > 0 && 'border-t border-gray-100',
                  )}
                >
                  <span className="flex-1 text-xs leading-snug text-gray-600">
                    {sub.label}
                    {sub.isRequired && <span className="ml-0.5 text-red-400">*</span>}
                    {photos.length > 0 && (
                      <span className="ml-1.5 text-xs text-gray-400">
                        ({photos.length} photo{photos.length !== 1 ? 's' : ''})
                      </span>
                    )}
                  </span>
                  <span className={cn(
                    'shrink-0 text-xs font-medium',
                    value ? 'text-gray-900' : 'text-gray-300',
                  )}>
                    {value || '—'}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Photos ── */}
      {(checklistPhotos.length > 0 || task.completionPhotos.length > 0) && (
        <div>
          <SectionHeading>Photos</SectionHeading>
          <div className="flex flex-col gap-4">
            <PhotoGrid urls={checklistPhotos} label="Checklist photos" />
            <PhotoGrid urls={task.completionPhotos} label="Completion photos" />
          </div>
        </div>
      )}

      {/* ── GPS ── */}
      <div>
        <SectionHeading>GPS Location</SectionHeading>
        {task.location ? (
          <a
            href={`https://www.google.com/maps?q=${task.location.lat},${task.location.lng}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-teal hover:underline"
          >
            <MapPin className="h-4 w-4 shrink-0" />
            {task.location.lat.toFixed(5)}, {task.location.lng.toFixed(5)}
          </a>
        ) : (
          <p className="text-sm text-gray-400">Not captured yet</p>
        )}
      </div>

      {/* ── Submission history ── */}
      <div>
        <SectionHeading>Submission History</SectionHeading>
        {loading ? (
          <div className="flex flex-col gap-2">
            {[...Array(2)].map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)}
          </div>
        ) : updates.length === 0 ? (
          <p className="text-sm text-gray-400">No submissions yet</p>
        ) : (
          <div className="flex flex-col gap-2">
            {updates.map((u) => (
              <div key={u.id} className="rounded-xl border border-gray-200 px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-gray-900">{u.submittedByName}</span>
                  <span className={cn(
                    'rounded-full px-2 py-0.5 text-xs font-medium',
                    TASK_BADGE[u.status] ?? 'bg-gray-100 text-gray-600',
                  )}>
                    {prettyStatus(u.status)}
                  </span>
                </div>
                <p className="mt-1 text-xs text-gray-400">{formatDateTime(u.submittedAt)}</p>
                {u.blockedReason && (
                  <p className="mt-1 text-sm leading-snug text-red-500">{u.blockedReason}</p>
                )}
                {u.reviewNotes && (
                  <p className="mt-1 text-sm leading-snug text-orange-600">{u.reviewNotes}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Detail body: a work order ────────────────────────────────────────────────

function WorkOrderBody({ entry }: { entry: LifecycleEntry }) {
  const navigate = useNavigate();

  // entry.id IS the work order id, which is exactly what useSurveyReport keys
  // on — the survey document is reached through its parent, not stored here.
  // Both hooks are read-only; nothing on this page writes.
  const { survey } = useSurveyReport(entry.id);
  const { updates, loading: historyLoading } = useSurveyUpdates(survey?.id);

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 rounded-xl bg-gray-50 lg:grid-cols-4 lg:divide-x lg:divide-gray-200">
        <MetaCell icon={Database} label="Stage"        value={entry.label} />
        <MetaCell icon={Clock}    label="Status"       value={prettyStatus(entry.status)} />
        <MetaCell icon={User}     label="Assigned to"  value={entry.assignedToName ?? 'Unassigned'} />
        <MetaCell icon={Calendar} label="Last updated" value={formatDateTime(entry.updatedAt)} />
      </div>

      <div>
        <SectionHeading>Overview</SectionHeading>
        {/* The survey record screen already renders the full survey, its
            approval chain and its audit trail. Linking there beats
            reproducing it. */}
        {entry.linkTo ? (
          <LinkCard
            icon={FileText}
            title="Survey Record"
            description="View and access the complete survey details, responses and related information."
            onClick={() => navigate(entry.linkTo!)}
          />
        ) : (
          <p className="rounded-xl bg-gray-50 px-4 py-4 text-sm text-gray-400">
            No detail screen for this stage yet — only the survey stage is implemented.
          </p>
        )}
      </div>

      {/* ── Approval history ──
          The survey's immutable audit trail (surveyReports/{id}/updates) —
          every submit and every stage decision, newest first.
          Rendered only once the survey document has resolved: a stage that has
          no survey yet has no trail to show. */}
      {survey && (
        <div>
          <SectionHeading>History</SectionHeading>
          {historyLoading ? (
            <div className="flex flex-col gap-2">
              {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
            </div>
          ) : updates.length === 0 ? (
            <p className="text-sm text-gray-400">Nothing recorded yet.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {updates.map((u) => {
                // stageKey is undefined on entries written before the approval
                // chain existed; the row degrades to no stage chip rather than
                // inventing one.
                const stage = u.stageKey ? findApprovalStage(u.stageKey) : undefined;
                return (
                  <div key={u.id} className="rounded-xl border border-gray-200 px-4 py-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={cn(
                          'rounded-full px-2 py-0.5 text-xs font-semibold',
                          SURVEY_ACTION_BADGE[u.action] ?? 'bg-gray-100 text-gray-600',
                        )}>
                          {SURVEY_ACTION_LABEL[u.action] ?? u.action}
                        </span>
                        {stage && (
                          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                            {stage.label}
                          </span>
                        )}
                      </div>
                      {/* createdAt is a SERVER timestamp — unlike the actedAt
                          on approvalStages, which is a client clock value. This
                          subcollection is the trustworthy record of timing. */}
                      <span className="text-xs text-gray-400">{formatDateTime(u.createdAt)}</span>
                    </div>
                    <p className="mt-1 text-xs text-gray-600">{u.actorName}</p>
                    {u.reviewNotes && (
                      <p className="mt-1 text-xs leading-snug text-gray-800">{u.reviewNotes}</p>
                    )}
                    {u.attachmentUrl && (
                      <a
                        href={u.attachmentUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-brand-blue hover:underline"
                      >
                        <ExternalLink className="h-3 w-3" />
                        Attachment
                      </a>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Left column row ──────────────────────────────────────────────────────────

function TaskListItem({
  entry, selected, onSelect,
}: {
  entry:    LifecycleEntry;
  selected: boolean;
  onSelect: () => void;
}) {
  const Icon = entry.kind === 'workOrder' ? ClipboardCheck : ClipboardList;

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected}
      className={cn(
        'flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors',
        selected
          ? 'border-brand-blue bg-blue-50/70 ring-1 ring-brand-blue/20'
          : 'border-gray-100 bg-white hover:border-gray-200 hover:bg-gray-50',
      )}
    >
      <span className={cn(
        'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors',
        selected ? 'bg-brand-blue text-white' : 'bg-blue-50 text-brand-blue',
      )}>
        <Icon className="h-4 w-4" />
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-gray-900">{entry.label}</span>
          <span className={cn(
            'rounded-full px-2 py-0.5 text-[10px] font-medium',
            badgeClass(entry),
          )}>
            {prettyStatus(entry.status)}
          </span>
        </span>
        <span className="mt-0.5 block break-all font-mono text-[11px] text-gray-400">
          {entry.code}
        </span>
      </span>

      <ChevronRight className={cn(
        'h-4 w-4 shrink-0',
        selected ? 'text-brand-blue' : 'text-gray-300',
      )} />
    </button>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

type KindFilter = 'all' | 'siteTask' | 'workOrder';

export function SiteLifecycleDetailPage() {
  const { siteId } = useParams<{ siteId: string }>();
  const navigate   = useNavigate();

  const { site, entries, loading, error } = useSiteLifecycle(siteId);
  const { siteTasks } = useSiteTasks(siteId ?? '');

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showSearch, setShowSearch] = useState(false);
  const [search,     setSearch]     = useState('');
  const [kind,       setKind]       = useState<KindFilter>('all');

  // Full task documents by id — a lifecycle entry carries only what the list
  // needs; the checklist, photos and answers live on the task itself.
  const taskById = useMemo(
    () => new Map(siteTasks.map((t) => [t.id, t])),
    [siteTasks],
  );

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return entries.filter((e) => {
      if (kind !== 'all' && e.kind !== kind) return false;
      if (!q) return true;
      return e.label.toLowerCase().includes(q) || e.code.toLowerCase().includes(q);
    });
  }, [entries, search, kind]);

  // Derived rather than set in an effect: an effect would render one frame
  // with an empty panel and then swap it, and would fight the user whenever
  // filtering removed their selection. Falls back to the first VISIBLE row, so
  // the panel always matches the list beside it.
  const activeEntry =
    visible.find((e) => e.id === selectedId) ?? visible[0] ?? null;

  if (loading) {
    return (
      <div className="mx-auto max-w-7xl space-y-4">
        <Skeleton className="h-12 w-64" />
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-5">
          <Skeleton className="h-96 rounded-2xl lg:col-span-2" />
          <Skeleton className="h-96 rounded-2xl lg:col-span-3" />
        </div>
      </div>
    );
  }

  if (error || !site) {
    return (
      <div className="mx-auto max-w-7xl">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="mb-4 inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </button>
        <p className="py-16 text-center text-sm text-gray-400">
          {error ?? 'Substation not found.'}
        </p>
      </div>
    );
  }

  const taskCount   = entries.filter((e) => e.kind === 'siteTask').length;
  const surveyCount = entries.filter((e) => e.kind === 'workOrder').length;
  const ActiveIcon  = activeEntry?.kind === 'workOrder' ? ClipboardCheck : ClipboardList;

  return (
    <div className="mx-auto max-w-7xl space-y-5 pb-10">
      {/* ── Header ── */}
      <div className="flex items-start gap-4">
        <button
          type="button"
          onClick={() => navigate(`/sites/${siteId}`)}
          aria-label="Back to lifecycle overview"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-gray-100 bg-white text-gray-600 shadow-sm transition-colors hover:border-gray-200 hover:text-gray-900"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-400">
            Full lifecycle detail
          </p>
          <h2 className="text-xl font-bold leading-snug text-gray-900 sm:text-2xl">{site.siteName}</h2>
          <p className="text-sm text-gray-500">
            {site.siteCode} · {site.projectName}
          </p>
        </div>
      </div>

      {entries.length === 0 ? (
        <div className="rounded-2xl border border-gray-100 bg-white py-20 text-center shadow-sm">
          <p className="text-sm text-gray-400">Nothing tracked at this substation yet.</p>
        </div>
      ) : (
        /* 2 / 3 of a five-column grid is the 40 / 60 split. Stacks below lg,
           where two columns would leave neither usable. */
        <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-5">

          {/* ── Left: the list ── */}
          <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm lg:col-span-2 lg:sticky lg:top-20 lg:flex lg:h-[calc(100vh-9rem)] lg:flex-col">
            <div className="flex shrink-0 items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-gray-900">
                  {entries.length} item{entries.length !== 1 ? 's' : ''} tracked
                </p>
                <p className="text-xs text-gray-500">
                  {taskCount} task{taskCount !== 1 ? 's' : ''}, {surveyCount} survey
                  {surveyCount !== 1 ? 's' : ''} · Read-only
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => { setShowSearch((v) => !v); setSearch(''); }}
                  aria-label={showSearch ? 'Close search' : 'Search items'}
                  aria-pressed={showSearch}
                  className={cn(
                    'flex h-9 w-9 items-center justify-center rounded-lg border transition-colors',
                    showSearch
                      ? 'border-brand-blue bg-blue-50 text-brand-blue'
                      : 'border-gray-200 bg-white text-gray-500 hover:bg-gray-50',
                  )}
                >
                  {showSearch ? <X className="h-4 w-4" /> : <Search className="h-4 w-4" />}
                </button>
                {/* Cycles all → tasks → surveys. A three-state toggle rather
                    than a menu: there are only ever these three. */}
                <button
                  type="button"
                  onClick={() => setKind((k) =>
                    k === 'all' ? 'siteTask' : k === 'siteTask' ? 'workOrder' : 'all')}
                  aria-label={`Filter: ${kind === 'all' ? 'all items' : kind === 'siteTask' ? 'tasks only' : 'surveys only'}`}
                  className={cn(
                    'flex h-9 w-9 items-center justify-center rounded-lg border transition-colors',
                    kind !== 'all'
                      ? 'border-brand-blue bg-blue-50 text-brand-blue'
                      : 'border-gray-200 bg-white text-gray-500 hover:bg-gray-50',
                  )}
                >
                  <SlidersHorizontal className="h-4 w-4" />
                </button>
              </div>
            </div>

            {showSearch && (
              <input
                type="search"
                autoFocus
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name or code…"
                className="mt-3 w-full shrink-0 rounded-xl border border-gray-200 px-3 py-2 text-sm placeholder:text-gray-400 focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/20"
              />
            )}

            {kind !== 'all' && (
              <p className="mt-2 shrink-0 text-xs text-brand-blue">
                Showing {kind === 'siteTask' ? 'tasks' : 'surveys'} only — tap the filter to change.
              </p>
            )}

            <div className="mt-3 flex min-h-0 flex-1 flex-col gap-2 lg:overflow-y-auto lg:pr-1">
              {visible.length === 0 ? (
                <p className="py-10 text-center text-sm text-gray-400">
                  Nothing matches that search or filter.
                </p>
              ) : (
                visible.map((entry) => (
                  <TaskListItem
                    key={`${entry.kind}-${entry.id}`}
                    entry={entry}
                    selected={entry.id === activeEntry?.id}
                    onSelect={() => setSelectedId(entry.id)}
                  />
                ))
              )}
            </div>
          </div>

          {/* ── Right: the detail ── */}
          <div className="rounded-2xl border border-gray-100 bg-white shadow-sm lg:col-span-3 lg:sticky lg:top-20 lg:flex lg:h-[calc(100vh-9rem)] lg:flex-col">
            {!activeEntry ? (
              <div className="flex flex-1 items-center justify-center py-20">
                <p className="text-sm text-gray-400">Select an item to see its details.</p>
              </div>
            ) : (
              <>
                {/* Panel header — repeats the identity so the right-hand side
                    stands on its own once the body has scrolled. */}
                <div className="flex shrink-0 items-start justify-between gap-4 px-6 pb-5 pt-6">
                  <div className="flex min-w-0 items-start gap-4">
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-blue text-white">
                      <ActiveIcon className="h-5 w-5" />
                    </span>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-lg font-bold text-gray-900">{activeEntry.label}</h3>
                        <span className={cn(
                          'rounded-full px-2 py-0.5 text-[10px] font-medium',
                          badgeClass(activeEntry),
                        )}>
                          {prettyStatus(activeEntry.status)}
                        </span>
                      </div>
                      <p className="mt-0.5 break-all font-mono text-[11px] text-gray-400">
                        {activeEntry.code}
                      </p>
                    </div>
                  </div>

                  {activeEntry.kind === 'workOrder' && activeEntry.linkTo && (
                    <button
                      type="button"
                      onClick={() => navigate(activeEntry.linkTo!)}
                      className="hidden shrink-0 items-center gap-1.5 rounded-lg bg-brand-blue px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-navy sm:flex"
                    >
                      <ExternalLink className="h-4 w-4" />
                      Open full survey record
                    </button>
                  )}
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
                  {activeEntry.kind === 'siteTask' ? (
                    taskById.get(activeEntry.id)
                      ? <SiteTaskBody task={taskById.get(activeEntry.id)!} />
                      : <p className="text-sm text-gray-400">Task details unavailable.</p>
                  ) : (
                    <WorkOrderBody entry={activeEntry} />
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
