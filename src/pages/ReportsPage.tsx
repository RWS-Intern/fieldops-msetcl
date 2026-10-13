import { useState, useMemo } from 'react';
import { Download, SlidersHorizontal, X } from 'lucide-react';
import { useReports } from '@/hooks/useReports';
import { useAllSiteTasks } from '@/hooks/useAllSiteTasks';
import { useSiteStore } from '@/store/siteStore';
import { useUserStore } from '@/store/userStore';
import { useVendorStore } from '@/store/vendorStore';
import { useAllSurveys } from '@/hooks/useAllSurveys';
import { SURVEY_APPROVAL_STAGES } from '@/lib/approvalStages';
import { exportReportsExcel } from '@/utils/exportReportsExcel';
import { useToast } from '@/components/ui/toast';
import { StatusChart } from '@/components/reports/StatusChart';
import { TypeChart } from '@/components/reports/TypeChart';
import { EngineerChart } from '@/components/reports/EngineerChart';
import { CityChart } from '@/components/reports/CityChart';
import { SiteCompletionChart } from '@/components/reports/SiteCompletionChart';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { exportToCsv } from '@/utils/exportToCsv';
import { getStatusColour, getStatusLabel } from '@/lib/taskUtils';
import { cn } from '@/lib/utils';
import { IN_HOUSE_VENDOR_ID, type TaskStatus, type User } from '@/types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(d: Date) {
  return d.toLocaleString('en-AU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function fmtDate(d: Date | null): string {
  if (!d) return '';
  return d.toISOString().slice(0, 10);
}

// ─── Stat card ────────────────────────────────────────────────────────────────

function StatCard({
  label, value, accent,
}: { label: string; value: number; accent: string }) {
  return (
    <div
      className="flex flex-col gap-1 rounded-xl border border-gray-100 bg-white p-4 shadow-sm"
      style={{ borderTopColor: accent, borderTopWidth: 3 }}
    >
      <span className="text-2xl font-bold text-gray-900">{value}</span>
      <span className="text-xs text-gray-500">{label}</span>
    </div>
  );
}

// ─── Chart card wrapper ────────────────────────────────────────────────────────

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-gray-100 bg-white shadow-sm p-4">
      <p className="text-sm font-semibold text-gray-700 mb-3">{title}</p>
      {children}
    </div>
  );
}

// ─── Circular progress ring (CSS-only) ────────────────────────────────────────

function CompletionRing({ rate }: { rate: number }) {
  const colour =
    rate >= 70 ? '#2A9D8F' :
      rate >= 40 ? '#F4A261' :
        '#E63946';

  const circumference = 2 * Math.PI * 44;
  const dash = (rate / 100) * circumference;

  return (
    <div className="flex flex-col items-center justify-center gap-3 py-6">
      <div className="relative h-36 w-36">
        <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
          <circle cx="50" cy="50" r="44" fill="none" stroke="#f0f0f0" strokeWidth="10" />
          <circle
            cx="50" cy="50" r="44"
            fill="none"
            stroke={colour}
            strokeWidth="10"
            strokeLinecap="round"
            strokeDasharray={`${dash} ${circumference}`}
            style={{ transition: 'stroke-dasharray 0.6s ease' }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-bold" style={{ color: colour }}>{rate}%</span>
        </div>
      </div>
      <p className="text-xs text-gray-500 text-center">overall completion rate</p>
    </div>
  );
}

// ─── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const colour = getStatusColour(status as TaskStatus);
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold text-white whitespace-nowrap"
      style={{ backgroundColor: colour }}
    >
      {getStatusLabel(status as TaskStatus)}
    </span>
  );
}

// ─── Filter select helper ─────────────────────────────────────────────────────

function FilterSelect({
  label, value, onChange, children,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[10px] font-medium text-gray-500 uppercase tracking-wide">
        {label}
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 rounded-md border border-gray-200 bg-white px-2 text-xs focus:outline-none focus:ring-2 focus:ring-brand-blue/30 min-w-[130px]"
      >
        {children}
      </select>
    </div>
  );
}

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * A status filter value of the form `stage:<n>` means "awaiting approval AT
 * that stage", where n indexes SURVEY_APPROVAL_STAGES.
 *
 * SURVEY-ONLY, and that is a property of the data rather than a shortcut: a
 * SiteTask has one approverUid and no chain, so it cannot be at a stage.
 * Selecting one therefore excludes every task.
 */
const STAGE_FILTER_PREFIX = 'stage:';

const stageFilterValue = (index: number) => `${STAGE_FILTER_PREFIX}${index}`;

/**
 * Fully approved surveys — the end of the chain, after the stage tiles.
 * Survey-only like the stages: no task has this status, so it excludes tasks.
 */
const APPROVED_SURVEYS_FILTER = 'survey_approved';

/** The stage index a filter value selects, or null when it is a plain status. */
function stageIndexFromFilter(filterValue: string): number | null {
  if (!filterValue.startsWith(STAGE_FILTER_PREFIX)) return null;
  const n = Number(filterValue.slice(STAGE_FILTER_PREFIX.length));
  return Number.isInteger(n) ? n : null;
}

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'All statuses' },
  { value: 'pending', label: 'Pending' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'pending_approval', label: 'Pending Approval' },
  { value: 'changes_requested', label: 'Changes Requested' },
  { value: 'completed', label: 'Completed' },
  { value: 'blocked', label: 'Blocked' },
  // Labels come from SURVEY_APPROVAL_STAGES so the dropdown, the tiles and the
  // review screens can never disagree about what a stage is called.
  ...SURVEY_APPROVAL_STAGES.map((stage, i) => ({
    value: stageFilterValue(i),
    label: `Awaiting ${stage.label}`,
  })),
  { value: APPROVED_SURVEYS_FILTER, label: 'Approved Surveys' },
];

/**
 * The vendor an engineer reports under. Field engineers created before
 * vendors existed have no vendorId saved; new ones default to the in-house
 * vendor (see CreateUserModal), so a missing vendor means in-house too.
 * Without this, their surveys and tasks matched NO vendor and vanished from
 * every vendor filter while still counting under "All vendors".
 */
function vendorIdOf(u: User): string | null {
  return u.vendorId ?? (u.role === 'field' ? IN_HOUSE_VENDOR_ID : null);
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function ReportsPage() {
  const { tasks: allTasks, loading: tasksLoading } = useAllSiteTasks();
  const { surveys: allSurveys } = useAllSurveys();
  const { sites } = useSiteStore();
  const { users } = useUserStore();
  const { vendors } = useVendorStore();
  const { showToast } = useToast();
  const [exporting, setExporting] = useState(false);

  // ── Filter state ──────────────────────────────────────────────────────────
  // Which KIND of work the whole page reports on. Applied last, after every
  // other filter, by emptying the side that is excluded — so the tiles, the
  // charts and the submission history all narrow together rather than each
  // needing its own awareness of it.
  const [filterKind, setFilterKind] = useState<'all' | 'surveys' | 'tasks'>('all');
  const [filterCity, setFilterCity] = useState('');
  const [filterProject, setFilterProject] = useState('');
  const [filterEngineer, setFilterEngineer] = useState('');
  const [filterVendor, setFilterVendor] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterFrom, setFilterFrom] = useState('');
  const [filterTo, setFilterTo] = useState('');

  const allFieldUsers = users.filter((u) => u.role === 'field' && u.active);

  // uid → vendorId, so a task can be attributed to a vendor without any
  // denormalisation onto siteTasks: the user list is already in memory, and a
  // task's assignee is the only link a vendor-wise report needs.
  const vendorByUid = useMemo(() => {
    const map = new Map<string, string>();
    users.forEach((u) => {
      const vendorId = vendorIdOf(u);
      if (vendorId) map.set(u.id, vendorId);
    });
    return map;
  }, [users]);

  // With a vendor selected, the Engineer picker narrows to that vendor's
  // engineers — the two filters compose rather than contradicting each other.
  const fieldUsers = filterVendor
    ? allFieldUsers.filter((u) => vendorIdOf(u) === filterVendor)
    : allFieldUsers;

  // Archived vendors stay listed: their engineers' past work is still in the
  // data, and excluding them would silently hide it from vendor-wise reports.
  const vendorOptions = useMemo(
    () => [...vendors].sort((a, b) => {
      if (a.isInHouse !== b.isInHouse) return a.isInHouse ? -1 : 1;
      return a.vendorName.localeCompare(b.vendorName);
    }),
    [vendors],
  );

  // Any vendor change clears the engineer selection.
  //
  // Cleared unconditionally, not just when the engineer leaves the new
  // vendor's roster: the Engineer dropdown only renders while a vendor is
  // selected, so returning to "All vendors" would otherwise strand an
  // invisible filter still narrowing every tile and chart, with no control
  // on screen to explain why.


  function changeVendor(next: string) {
    setFilterVendor(next);
    setFilterEngineer('');
  }

  // ── Unique cities + projects from sites ───────────────────────────────────
  const activeSites = useMemo(() => sites.filter((s) => !s.archived), [sites]);

  const uniqueCities = useMemo(() => {
    const seen = new Set<string>();
    activeSites.forEach((s) => s.city && seen.add(s.city));
    return [...seen].sort();
  }, [activeSites]);

  const uniqueProjects = useMemo(() => {
    const map = new Map<string, string>();
    activeSites.forEach((s) => {
      if (s.projectId && !map.has(s.projectId)) map.set(s.projectId, s.projectName);
    });
    return [...map.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [activeSites]);

  const hasFilters = filterKind !== 'all' || filterCity || filterProject || filterVendor || filterEngineer || filterStatus || filterFrom || filterTo;

  function clearFilters() {
    setFilterKind('all');
    setFilterCity('');
    setFilterProject('');
    setFilterEngineer('');
    setFilterVendor('');
    setFilterStatus('');
    setFilterFrom('');
    setFilterTo('');
  }

  // ── Apply filters to all siteTasks ────────────────────────────────────────
  const filteredTasks = useMemo(() => {
    if (filterKind === 'surveys') return [];
    return allTasks.filter((t) => {
      if (filterCity && t.city !== filterCity) return false;
      if (filterProject && t.projectId !== filterProject) return false;
      if (filterEngineer && t.assignedTo !== filterEngineer) return false;
      // An unassigned task belongs to no vendor, so it drops out whenever a
      // specific vendor is selected — it cannot be credited to one.
      if (filterVendor &&
        (!t.assignedTo || vendorByUid.get(t.assignedTo) !== filterVendor)) return false;
      // A stage filter is survey-only — a task has no approval chain, so it
      // can never be "awaiting Approver Level 2".
      if (filterStatus && stageIndexFromFilter(filterStatus) !== null) return false;
      if (filterStatus && t.status !== filterStatus) return false;
      if (filterFrom && fmtDate(t.updatedAt) < filterFrom) return false;
      if (filterTo && fmtDate(t.updatedAt) > filterTo) return false;
      return true;
    });
  }, [allTasks, filterKind, filterCity, filterProject, filterEngineer, filterVendor, vendorByUid, filterStatus, filterFrom, filterTo]);

  // ── Apply the same filters to surveys ─────────────────────────────────────
  //
  // A SurveyReport carries no city or projectId of its own, so those two
  // filters resolve through the site it belongs to. The sites store is
  // already loaded for this page, making it an in-memory lookup rather than
  // a reason to denormalise two more fields onto every survey document.
  const siteById = useMemo(() => {
    const map = new Map<string, { city: string; projectId: string }>();
    sites.forEach((site) => map.set(site.id, { city: site.city, projectId: site.projectId }));
    return map;
  }, [sites]);

  const filteredSurveys = useMemo(() => {
    // The Status filter offers TASK statuses; these are their survey
    // equivalents. 'blocked' maps to nothing — a work order has no blocked
    // state — so filtering by it correctly yields no surveys at all.
    const SURVEY_STATUSES_FOR: Record<string, string[]> = {
      pending: ['open'],
      in_progress: ['in_progress'],
      pending_approval: ['pending_approval'],
      changes_requested: ['changes_requested'],
      completed: ['approved', 'closed'],
      blocked: [],
      [APPROVED_SURVEYS_FILTER]: ['approved', 'closed'],
    };

    if (filterKind === 'tasks') return [];
    return allSurveys.filter((sv) => {
      const site = siteById.get(sv.siteId);
      if (filterCity && site?.city !== filterCity) return false;
      if (filterProject && site?.projectId !== filterProject) return false;
      if (filterEngineer && sv.assignedTo !== filterEngineer) return false;
      if (filterVendor &&
        (!sv.assignedTo || vendorByUid.get(sv.assignedTo) !== filterVendor)) return false;
      if (filterStatus) {
        const stageIndex = stageIndexFromFilter(filterStatus);
        if (stageIndex !== null) {
          // "Awaiting stage N" means the chain is parked there right now —
          // still under review AND currentStageIndex points at it.
          if (sv.status !== 'pending_approval' || sv.currentStageIndex !== stageIndex) return false;
        } else if (!(SURVEY_STATUSES_FOR[filterStatus] ?? []).includes(sv.status)) {
          return false;
        }
      }
      if (filterFrom && fmtDate(sv.updatedAt) < filterFrom) return false;
      if (filterTo && fmtDate(sv.updatedAt) > filterTo) return false;
      return true;
    });
  }, [
    allSurveys, siteById, filterKind, filterCity, filterProject, filterEngineer,
    filterVendor, vendorByUid, filterStatus, filterFrom, filterTo,
  ]);

  // ── Chart data from filtered tasks ────────────────────────────────────────
  const { byStatus, byType, byEngineer, summary } = useReports(filteredTasks, filteredSurveys);

  /**
   * How many surveys are parked at each approval stage right now.
   *
   * Counted off filteredSurveys, so every other filter (vendor, city, date…)
   * narrows these too, and their sum always equals the survey share of the
   * Pending Approval tile.
   *
   * An out-of-range currentStageIndex is ignored rather than clamped: a fully
   * approved survey carries index === stage count, and bucketing that into
   * "Final Approver" would report work as waiting when it is finished.
   */
  const byStage = useMemo(() => {
    const counts = SURVEY_APPROVAL_STAGES.map(() => 0);
    filteredSurveys.forEach((sv) => {
      if (sv.status !== 'pending_approval') return;
      const i = sv.currentStageIndex;
      if (i >= 0 && i < counts.length) counts[i] += 1;
    });
    return counts;
  }, [filteredSurveys]);

  /** Surveys that have cleared every stage — same statuses as Completed. */
  const approvedSurveyCount = useMemo(
    () => filteredSurveys.filter((sv) => sv.status === 'approved' || sv.status === 'closed').length,
    [filteredSurveys],
  );

  // ── Submission history — filtered tasks that have been submitted ──────────
  const submittedTasks = useMemo(() => {
    return filteredTasks
      .filter((t) => t.submittedAt != null)
      .sort((a, b) => (b.submittedAt?.getTime() ?? 0) - (a.submittedAt?.getTime() ?? 0));
  }, [filteredTasks]);

  // ── Sites by City chart — filtered from siteStore ─────────────────────────
  const citySiteData = useMemo(() => {
    const filtered = activeSites.filter((s) => {
      if (filterCity && s.city !== filterCity) return false;
      if (filterProject && s.projectId !== filterProject) return false;
      return true;
    });
    const counts: Record<string, number> = {};
    filtered.forEach((s) => {
      const c = s.city || 'Unknown';
      counts[c] = (counts[c] ?? 0) + 1;
    });
    return Object.entries(counts)
      .map(([city, count]) => ({ city, count }))
      .sort((a, b) => b.count - a.count);
  }, [activeSites, filterCity, filterProject]);

  // ── Completion Rate by Site — top 10 ──────────────────────────────────────
  const siteCompletionData = useMemo(() => {
    const filtered = activeSites.filter((s) => {
      if (filterCity && s.city !== filterCity) return false;
      if (filterProject && s.projectId !== filterProject) return false;
      return s.taskCount > 0;
    });
    return filtered
      .map((s) => ({
        siteCode: s.siteCode,
        rate: Math.round((s.completedTaskCount / s.taskCount) * 100),
        completed: s.completedTaskCount,
        total: s.taskCount,
      }))
      .sort((a, b) => b.rate - a.rate)
      .slice(0, 10);
  }, [activeSites, filterCity, filterProject]);

  // ── CSV export ────────────────────────────────────────────────────────────
  function handleExport() {
    exportToCsv('fieldops-submissions', submittedTasks.map((t) => ({
      'Date/Time': fmt(t.submittedAt!),
      'Task Key': t.taskKey,
      'Task Label': t.taskLabel,
      'Site Code': t.siteCode,
      'City': t.city,
      'Project': t.projectName,
      'Engineer': t.assignedToName ?? '',
      'Status': t.status,
      'Blocked Reason': t.blockedReason ?? '',
      'Photos': t.completionPhotos.length,
      'Latitude': t.location?.lat ?? '',
      'Longitude': t.location?.lng ?? '',
    })));
  }

  // ── Render ────────────────────────────────────────────────────────────────
  /**
   * Exports what is currently on screen.
   *
   * Passes the ALREADY FILTERED arrays, so the workbook can never disagree
   * with the filter bar — and writes the active filters into the Summary
   * sheet so the file still explains itself once it has been sent on.
   */

  async function handleExcelExport() {
    setExporting(true);
    try {
      const userNameByUid = new Map(users.map((u) => [u.id, u.name]));
      const vendorNameByUid = new Map(
        users
          .filter((u) => vendorIdOf(u))
          .map((u) => [
            u.id,
            u.vendorName ?? vendors.find((v) => v.id === vendorIdOf(u))?.vendorName ?? '',
          ]),
      );
      const siteMetaById = new Map(
        sites.map((site) => [site.id, { city: site.city, projectName: site.projectName }]),
      );

      const kindLabel = { all: 'All', surveys: 'Surveys', tasks: 'Tasks Only' }[filterKind];
      const activeFilters: { label: string; value: string }[] = [];
      if (filterKind !== 'all') activeFilters.push({ label: 'Task Type', value: kindLabel });
      if (filterCity) activeFilters.push({ label: 'City', value: filterCity });
      if (filterProject) activeFilters.push({
        label: 'Project',
        value: uniqueProjects.find((p) => p.id === filterProject)?.name ?? filterProject,
      });
      if (filterVendor) activeFilters.push({
        label: 'Vendor',
        value: vendors.find((v) => v.id === filterVendor)?.vendorName ?? filterVendor,
      });
      if (filterEngineer) activeFilters.push({
        label: 'Engineer',
        value: userNameByUid.get(filterEngineer) ?? filterEngineer,
      });
      if (filterStatus) activeFilters.push({
        label: 'Status',
        value: STATUS_OPTIONS.find((o) => o.value === filterStatus)?.label ?? filterStatus,
      });
      if (filterFrom) activeFilters.push({ label: 'Updated from', value: filterFrom });
      if (filterTo) activeFilters.push({ label: 'Updated to', value: filterTo });

      await exportReportsExcel({
        tasks: filteredTasks,
        surveys: filteredSurveys,
        userNameByUid,
        vendorNameByUid,
        siteMetaById,
        activeFilters,
      });
      showToast('Excel export downloaded', 'success');
    } catch (err) {
      console.error('[ReportsPage] excel export failed:', err);
      showToast('Export failed. Try again.', 'error');
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">

      {/* Page heading */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold text-gray-900 mb-0.5">Reports</h2>
          <p className="text-sm text-gray-400">Live data — updates in real time</p>
        </div>

        {/* Exports the filtered view, not the whole collection. Disabled when
            there is nothing on screen, so it can never produce an empty file. */}
        <button
          type="button"
          onClick={handleExcelExport}
          disabled={exporting || (filteredTasks.length === 0 && filteredSurveys.length === 0)}
          className="flex shrink-0 items-center gap-1.5 rounded-lg bg-brand-blue px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-navy disabled:cursor-not-allowed disabled:bg-gray-300"
        >
          {exporting ? (
            <>
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
              Exporting…
            </>
          ) : (
            <>
              <Download className="h-4 w-4" />
              Export Formatted Excel
            </>
          )}
        </button>
      </div>

      {/* ── Global filter bar ─────────────────────────────────────────────── */}
      <div className="rounded-xl border border-gray-100 bg-white shadow-sm px-5 py-4">
        <div className="flex items-center gap-2 mb-3">
          <SlidersHorizontal className="h-4 w-4 text-gray-400" />
          <span className="text-sm font-semibold text-gray-700">Filters</span>
          {hasFilters && (
            <span className="ml-1 rounded-full bg-brand-blue text-white text-[10px] font-semibold px-2 py-0.5">
              Active
            </span>
          )}
        </div>

        <div className="flex flex-wrap gap-3 items-end">
          {/* Task Type — scopes the whole page to tasks, surveys or both. */}
          <FilterSelect label="Task Type" value={filterKind} onChange={(v) => setFilterKind(v as typeof filterKind)}>
            <option value="all">All</option>
            <option value="surveys">Surveys</option>
            <option value="tasks">Tasks Only</option>
          </FilterSelect>

          {/* City */}
          {uniqueCities.length > 0 && (
            <FilterSelect label="City" value={filterCity} onChange={setFilterCity}>
              <option value="">All cities</option>
              {uniqueCities.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </FilterSelect>
          )}

          {/* Project */}
          {uniqueProjects.length > 0 && (
            <FilterSelect label="Project" value={filterProject} onChange={setFilterProject}>
              <option value="">All projects</option>
              {uniqueProjects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </FilterSelect>
          )}

          {/* Vendor */}
          {vendorOptions.length > 0 && (
            <FilterSelect label="Vendor" value={filterVendor} onChange={changeVendor}>
              <option value="">All vendors</option>
              {vendorOptions.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.vendorName}{v.archived ? ' (archived)' : ''}
                </option>
              ))}
            </FilterSelect>
          )}

          {/* Engineer — appears only once a vendor is chosen, and lists that
              vendor's engineers, so it reads as "drill into this vendor". */}
          {filterVendor && (
            <FilterSelect label="Engineer" value={filterEngineer} onChange={setFilterEngineer}>
              <option value="">All engineers</option>
              {fieldUsers.map((u) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </FilterSelect>
          )}

          {/* Status */}
          <FilterSelect label="Status" value={filterStatus} onChange={setFilterStatus}>
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </FilterSelect>

          {/* Date From */}
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-medium text-gray-500 uppercase tracking-wide">
              Updated From
            </label>
            <input
              type="date"
              value={filterFrom}
              onChange={(e) => setFilterFrom(e.target.value)}
              className="h-8 rounded-md border border-gray-200 bg-white px-2 text-xs focus:outline-none focus:ring-2 focus:ring-brand-blue/30"
            />
          </div>

          {/* Date To */}
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-medium text-gray-500 uppercase tracking-wide">
              Updated To
            </label>
            <input
              type="date"
              value={filterTo}
              onChange={(e) => setFilterTo(e.target.value)}
              className="h-8 rounded-md border border-gray-200 bg-white px-2 text-xs focus:outline-none focus:ring-2 focus:ring-brand-blue/30"
            />
          </div>

          {/* Clear */}
          {hasFilters && (
            <div className="flex flex-col justify-end">
              <button
                type="button"
                onClick={clearFilters}
                className="h-8 flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 text-xs text-gray-500 hover:bg-gray-50 transition-colors"
              >
                <X className="h-3 w-3" />
                Clear
              </button>
            </div>
          )}
        </div>

        {/* Summary line */}
        <p className="text-xs text-gray-400 mt-3">
          Showing{' '}
          <span className="font-medium text-gray-600">{filteredTasks.length}</span>
          {' '}of{' '}
          <span className="font-medium text-gray-600">{allTasks.length}</span>
          {' '}tasks
          {filteredSurveys.length > 0 && (
            <>
              {' '}+{' '}
              <span className="font-medium text-gray-600">{filteredSurveys.length}</span>
              {' '}survey{filteredSurveys.length !== 1 ? 's' : ''}
            </>
          )}
          {hasFilters && ' matching current filters'}
        </p>
      </div>

      {/* Summary stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3">
        <StatCard label="Total Tasks" value={summary.total} accent="#9CA3AF" />
        <StatCard label="Completed" value={summary.completed} accent="#2A9D8F" />
        <StatCard label="In Progress" value={summary.inProgress} accent="#F4A261" />
        <StatCard label="Pending Approval" value={summary.pendingApproval} accent="#8B5CF6" />
        <StatCard label="Changes Requested" value={summary.changesRequested} accent="#F97316" />
        <StatCard label="Blocked" value={summary.blocked} accent="#E63946" />
        <StatCard label="Overdue" value={summary.overdue} accent="#7C3AED" />
      </div>

      {/* ── Approval stages ──
          Surveys only, and said so in the caption rather than left to be
          inferred: a site task has a single approver and no chain, so it can
          never appear here. Hidden entirely when no survey is in review, so an
          all-zero row never implies work that does not exist. */}
      {(byStage.some((n) => n > 0) || approvedSurveyCount > 0) && (
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-400">
            Survey approvals, by stage
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {SURVEY_APPROVAL_STAGES.map((stage, i) => (
              <button
                key={stage.key}
                type="button"
                onClick={() => setFilterStatus(
                  filterStatus === stageFilterValue(i) ? '' : stageFilterValue(i),
                )}
                aria-pressed={filterStatus === stageFilterValue(i)}
                className={cn(
                  'rounded-xl border bg-white px-4 py-3 text-left transition-colors',
                  filterStatus === stageFilterValue(i)
                    ? 'border-brand-blue ring-1 ring-brand-blue/20'
                    : 'border-gray-100 hover:border-gray-300',
                )}
                style={{ borderTopColor: '#8B5CF6', borderTopWidth: 2 }}
              >
                <p className="text-2xl font-bold text-gray-900">{byStage[i]}</p>
                <p className="text-xs text-gray-500">{stage.label}</p>
              </button>
            ))}
            <button
              type="button"
              onClick={() => setFilterStatus(
                filterStatus === APPROVED_SURVEYS_FILTER ? '' : APPROVED_SURVEYS_FILTER,
              )}
              aria-pressed={filterStatus === APPROVED_SURVEYS_FILTER}
              className={cn(
                'rounded-xl border bg-white px-4 py-3 text-left transition-colors',
                filterStatus === APPROVED_SURVEYS_FILTER
                  ? 'border-brand-blue ring-1 ring-brand-blue/20'
                  : 'border-gray-100 hover:border-gray-300',
              )}
              style={{ borderTopColor: '#2A9D8F', borderTopWidth: 2 }}
            >
              <p className="text-2xl font-bold text-gray-900">{approvedSurveyCount}</p>
              <p className="text-xs text-gray-500">Approved</p>
            </button>
          </div>
        </div>
      )}

      {/* The tiles count surveys as well as tasks; the charts are task-only.
          Left unsaid, the two disagree and the page reads as broken — and
          under "Surveys" the charts empty out entirely, which looks worse. */}
      {summary.surveyCount > 0 && (
        <p className="-mt-1 text-xs text-gray-400">
          Totals and Tasks by Status include {summary.surveyCount} survey
          {summary.surveyCount !== 1 ? 's' : ''}. Tasks by Type and Engineer
          Performance cover site tasks only
          {filterKind === 'surveys' ? ', so they are empty here' : ''}.
        </p>
      )}

      {/* Charts — 3×2 grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard title="Tasks by Status">
          <StatusChart data={byStatus} />
        </ChartCard>

        <ChartCard title="Tasks by Type">
          <TypeChart data={byType} />
        </ChartCard>

        <ChartCard title="Completion Rate by Engineer">
          <EngineerChart data={byEngineer} />
        </ChartCard>

        <ChartCard title="Overall Completion Rate">
          <CompletionRing rate={summary.completionRate} />
          <p className="text-center text-xs text-gray-400 pb-2">
            {summary.completed} of {summary.total} tasks completed
          </p>
        </ChartCard>

        <ChartCard title="Sites by City">
          <CityChart data={citySiteData} />
        </ChartCard>

        <ChartCard title="Completion Rate by Site (Top 10)">
          <SiteCompletionChart data={siteCompletionData} />
        </ChartCard>
      </div>

      {/* Submission History */}
      <div className="rounded-xl border border-gray-100 bg-white shadow-sm overflow-hidden">

        {/* Header */}
        <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-gray-100">
          <div>
            <p className="text-sm font-semibold text-gray-700">Submission History</p>
            <p className="text-xs text-gray-400 mt-0.5">
              {hasFilters
                ? `${submittedTasks.length} submission${submittedTasks.length !== 1 ? 's' : ''} matching current filters`
                : 'All task submissions by field engineers'}
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="flex items-center gap-1.5 shrink-0"
            onClick={handleExport}
            disabled={submittedTasks.length === 0}
          >
            <Download className="h-3.5 w-3.5" />
            Export CSV
          </Button>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/80">
                <th className="px-4 py-2.5 text-left font-medium text-gray-500 whitespace-nowrap">Date / Time</th>
                <th className="px-4 py-2.5 text-left font-medium text-gray-500 whitespace-nowrap">Task Key</th>
                <th className="px-4 py-2.5 text-left font-medium text-gray-500 whitespace-nowrap">Task Label</th>
                <th className="px-4 py-2.5 text-left font-medium text-gray-500 whitespace-nowrap">Site</th>
                <th className="px-4 py-2.5 text-left font-medium text-gray-500 whitespace-nowrap hidden sm:table-cell">City</th>
                <th className="px-4 py-2.5 text-left font-medium text-gray-500 whitespace-nowrap hidden sm:table-cell">Project</th>
                <th className="px-4 py-2.5 text-left font-medium text-gray-500 whitespace-nowrap">Engineer</th>
                <th className="px-4 py-2.5 text-left font-medium text-gray-500 whitespace-nowrap">Status</th>
                <th className="px-4 py-2.5 text-left font-medium text-gray-500 whitespace-nowrap hidden sm:table-cell">Blocked Reason</th>
                <th className="px-4 py-2.5 text-left font-medium text-gray-500 whitespace-nowrap">Photos</th>
              </tr>
            </thead>
            <tbody>
              {tasksLoading && submittedTasks.length === 0 ? (
                [...Array(5)].map((_, i) => (
                  <tr key={i} className={cn(i % 2 === 1 && 'bg-gray-50/50')}>
                    {[false, false, false, false, true, true, false, false, true, false].map((hidden, j) => (
                      <td key={j} className={cn('px-4 py-2.5', hidden && 'hidden sm:table-cell')}>
                        <Skeleton className="h-3.5 w-full" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : submittedTasks.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-4 py-12 text-center text-gray-400">
                    {hasFilters
                      ? 'No submissions match the current filters.'
                      : 'No submissions yet.'}
                  </td>
                </tr>
              ) : (
                submittedTasks.map((t, i) => (
                  <tr
                    key={t.id}
                    className={cn(
                      'border-b border-gray-50 last:border-0 transition-colors hover:bg-blue-50/30',
                      i % 2 === 1 && 'bg-gray-50/40',
                    )}
                  >
                    <td className="px-4 py-2.5 whitespace-nowrap text-gray-500">
                      {fmt(t.submittedAt!)}
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap font-mono text-gray-700">
                      {t.taskKey || '—'}
                    </td>
                    <td className="px-4 py-2.5 max-w-[160px] truncate text-gray-800">
                      {t.taskLabel || '—'}
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap text-gray-600">
                      {t.siteCode || '—'}
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap text-gray-600 hidden sm:table-cell">
                      {t.city || '—'}
                    </td>
                    <td className="px-4 py-2.5 max-w-[140px] truncate text-gray-600 hidden sm:table-cell">
                      {t.projectName || '—'}
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap text-gray-700">
                      {t.assignedToName || '—'}
                    </td>
                    <td className="px-4 py-2.5">
                      {t.status ? <StatusBadge status={t.status} /> : '—'}
                    </td>
                    <td className="px-4 py-2.5 max-w-[160px] truncate text-gray-500 hidden sm:table-cell">
                      {t.blockedReason || '—'}
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      {t.completionPhotos.length > 0 ? (
                        <span className="rounded-full bg-blue-50 text-brand-blue px-2 py-0.5 font-medium">
                          {t.completionPhotos.length} photo{t.completionPhotos.length !== 1 ? 's' : ''}
                        </span>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
}
