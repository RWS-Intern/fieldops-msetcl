import { useState, useMemo } from 'react';
import { Download, SlidersHorizontal, X } from 'lucide-react';
import { useReports }        from '@/hooks/useReports';
import { useAllSiteTasks }   from '@/hooks/useAllSiteTasks';
import { useSiteStore }      from '@/store/siteStore';
import { useUserStore }      from '@/store/userStore';
import { StatusChart }       from '@/components/reports/StatusChart';
import { TypeChart }         from '@/components/reports/TypeChart';
import { EngineerChart }     from '@/components/reports/EngineerChart';
import { CityChart }         from '@/components/reports/CityChart';
import { SiteCompletionChart } from '@/components/reports/SiteCompletionChart';
import { Button }            from '@/components/ui/button';
import { Skeleton }          from '@/components/ui/skeleton';
import { exportToCsv }       from '@/utils/exportToCsv';
import { getStatusColour, getStatusLabel } from '@/lib/taskUtils';
import { cn } from '@/lib/utils';
import type { TaskStatus } from '@/types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(d: Date) {
  return d.toLocaleString('en-AU', {
    day:    '2-digit',
    month:  '2-digit',
    year:   'numeric',
    hour:   '2-digit',
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
  label:    string;
  value:    string;
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

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: '',            label: 'All statuses'  },
  { value: 'pending',     label: 'Pending'       },
  { value: 'in_progress', label: 'In Progress'   },
  { value: 'completed',   label: 'Completed'     },
  { value: 'blocked',     label: 'Blocked'       },
];

// ─── Main page ────────────────────────────────────────────────────────────────

export function ReportsPage() {
  const { tasks: allTasks, loading: tasksLoading } = useAllSiteTasks();
  const { sites }  = useSiteStore();
  const { users }  = useUserStore();

  // ── Filter state ──────────────────────────────────────────────────────────
  const [filterCity,      setFilterCity]      = useState('');
  const [filterProject,   setFilterProject]   = useState('');
  const [filterEngineer,  setFilterEngineer]  = useState('');
  const [filterStatus,    setFilterStatus]    = useState('');
  const [filterFrom,      setFilterFrom]      = useState('');
  const [filterTo,        setFilterTo]        = useState('');

  const fieldUsers = users.filter((u) => u.role === 'field' && u.active);

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

  const hasFilters = filterCity || filterProject || filterEngineer || filterStatus || filterFrom || filterTo;

  function clearFilters() {
    setFilterCity('');
    setFilterProject('');
    setFilterEngineer('');
    setFilterStatus('');
    setFilterFrom('');
    setFilterTo('');
  }

  // ── Apply filters to all siteTasks ────────────────────────────────────────
  const filteredTasks = useMemo(() => {
    return allTasks.filter((t) => {
      if (filterCity     && t.city       !== filterCity)     return false;
      if (filterProject  && t.projectId  !== filterProject)  return false;
      if (filterEngineer && t.assignedTo !== filterEngineer) return false;
      if (filterStatus   && t.status     !== filterStatus)   return false;
      if (filterFrom     && fmtDate(t.updatedAt) < filterFrom) return false;
      if (filterTo       && fmtDate(t.updatedAt) > filterTo)   return false;
      return true;
    });
  }, [allTasks, filterCity, filterProject, filterEngineer, filterStatus, filterFrom, filterTo]);

  // ── Chart data from filtered tasks ────────────────────────────────────────
  const { byStatus, byType, byEngineer, summary } = useReports(filteredTasks);

  // ── Submission history — filtered tasks that have been submitted ──────────
  const submittedTasks = useMemo(() => {
    return filteredTasks
      .filter((t) => t.submittedAt != null)
      .sort((a, b) => (b.submittedAt?.getTime() ?? 0) - (a.submittedAt?.getTime() ?? 0));
  }, [filteredTasks]);

  // ── Sites by City chart — filtered from siteStore ─────────────────────────
  const citySiteData = useMemo(() => {
    const filtered = activeSites.filter((s) => {
      if (filterCity    && s.city      !== filterCity)    return false;
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
      if (filterCity    && s.city      !== filterCity)    return false;
      if (filterProject && s.projectId !== filterProject) return false;
      return s.taskCount > 0;
    });
    return filtered
      .map((s) => ({
        siteCode:  s.siteCode,
        rate:      Math.round((s.completedTaskCount / s.taskCount) * 100),
        completed: s.completedTaskCount,
        total:     s.taskCount,
      }))
      .sort((a, b) => b.rate - a.rate)
      .slice(0, 10);
  }, [activeSites, filterCity, filterProject]);

  // ── CSV export ────────────────────────────────────────────────────────────
  function handleExport() {
    exportToCsv('fieldops-submissions', submittedTasks.map((t) => ({
      'Date/Time':      fmt(t.submittedAt!),
      'Task Key':       t.taskKey,
      'Task Label':     t.taskLabel,
      'Site Code':      t.siteCode,
      'City':           t.city,
      'Project':        t.projectName,
      'Engineer':       t.assignedToName ?? '',
      'Status':         t.status,
      'Blocked Reason': t.blockedReason ?? '',
      'Photos':         t.completionPhotos.length,
      'Latitude':       t.location?.lat ?? '',
      'Longitude':      t.location?.lng ?? '',
    })));
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="max-w-6xl mx-auto space-y-6">

      {/* Page heading */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold text-gray-900 mb-0.5">Reports</h2>
          <p className="text-sm text-gray-400">Live data — updates in real time</p>
        </div>
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

          {/* Engineer */}
          <FilterSelect label="Engineer" value={filterEngineer} onChange={setFilterEngineer}>
            <option value="">All engineers</option>
            {fieldUsers.map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </FilterSelect>

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
          {hasFilters && ' matching current filters'}
        </p>
      </div>

      {/* Summary stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <StatCard label="Total Tasks"  value={summary.total}          accent="#9CA3AF" />
        <StatCard label="Completed"    value={summary.completed}      accent="#2A9D8F" />
        <StatCard label="In Progress"  value={summary.inProgress}     accent="#F4A261" />
        <StatCard label="Blocked"      value={summary.blocked}        accent="#E63946" />
        <StatCard label="Overdue"      value={summary.overdue}        accent="#7C3AED" />
      </div>

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
