import { useState, useMemo } from 'react';
import { Download } from 'lucide-react';
import { useReports }     from '@/hooks/useReports';
import { useTaskUpdates } from '@/hooks/useTaskUpdates';
import { useUserStore }   from '@/store/userStore';
import { StatusChart }    from '@/components/reports/StatusChart';
import { TypeChart }      from '@/components/reports/TypeChart';
import { EngineerChart }  from '@/components/reports/EngineerChart';
import { Button }         from '@/components/ui/button';
import { Skeleton }       from '@/components/ui/skeleton';
import { exportToCsv }    from '@/utils/exportToCsv';
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

function fmtDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

// ─── Stat card ────────────────────────────────────────────────────────────────

function StatCard({
  label, value, accent,
}: { label: string; value: number; accent: string }) {
  return (
    <div
      className="flex flex-col gap-1 rounded-xl border border-gray-100 bg-white p-4 shadow-sm shrink-0 min-w-[120px]"
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

  const circumference = 2 * Math.PI * 44; // r=44
  const dash = (rate / 100) * circumference;

  return (
    <div className="flex flex-col items-center justify-center gap-3 py-6">
      <div className="relative h-36 w-36">
        <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
          {/* Track */}
          <circle cx="50" cy="50" r="44" fill="none" stroke="#f0f0f0" strokeWidth="10" />
          {/* Progress */}
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
        {/* Centre text */}
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

// ─── Main page ────────────────────────────────────────────────────────────────

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: '',            label: 'All statuses'  },
  { value: 'pending',     label: 'Pending'        },
  { value: 'in_progress', label: 'In Progress'    },
  { value: 'completed',   label: 'Completed'      },
  { value: 'blocked',     label: 'Blocked'        },
];

export function ReportsPage() {
  const { byStatus, byType, byEngineer, summary } = useReports();
  const { updates, loading: updatesLoading, hasMore, loadMore } = useTaskUpdates();
  const { users } = useUserStore();

  // ── Filters ─────────────────────────────────────────────────────────────────
  const [filterFrom,     setFilterFrom]     = useState('');
  const [filterTo,       setFilterTo]       = useState('');
  const [filterStatus,   setFilterStatus]   = useState('');
  const [filterEngineer, setFilterEngineer] = useState('');

  const fieldUsers = users.filter((u) => u.role === 'field');

  const filtered = useMemo(() => {
    return updates.filter((u) => {
      if (filterFrom   && fmtDate(u.submittedAt) < filterFrom)   return false;
      if (filterTo     && fmtDate(u.submittedAt) > filterTo)     return false;
      if (filterStatus && u.status !== filterStatus)             return false;
      if (filterEngineer && u.submittedBy !== filterEngineer)    return false;
      return true;
    });
  }, [updates, filterFrom, filterTo, filterStatus, filterEngineer]);

  // ── CSV export ───────────────────────────────────────────────────────────────
  function handleExport() {
    exportToCsv('fieldops-submissions', filtered.map((u) => ({
      'Date/Time':       fmt(u.submittedAt),
      'Task #':          u.taskNum,
      'Title':           u.taskTitle,
      'Type':            u.taskType,
      'Site Code':       u.siteCode,
      'Engineer':        u.submittedByName,
      'Status':          u.status,
      'Blocked Reason':  u.blockedReason,
      'Photos':          u.completionPhotos.length,
      'Latitude':        u.location?.lat ?? '',
      'Longitude':       u.location?.lng ?? '',
    })));
  }

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="max-w-6xl mx-auto space-y-6">

      {/* Page heading */}
      <div>
        <h2 className="text-2xl font-bold text-gray-900 mb-0.5">Reports</h2>
        <p className="text-sm text-gray-400">Live data — updates in real time</p>
      </div>

      {/* Summary stat cards */}
      <div className="flex gap-3 overflow-x-auto pb-1">
        <StatCard label="Total Tasks"  value={summary.total}          accent="#9CA3AF" />
        <StatCard label="Completed"    value={summary.completed}      accent="#2A9D8F" />
        <StatCard label="In Progress"  value={summary.inProgress}     accent="#F4A261" />
        <StatCard label="Blocked"      value={summary.blocked}        accent="#E63946" />
        <StatCard label="Overdue"      value={summary.overdue}        accent="#7C3AED" />
      </div>

      {/* Charts 2×2 grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
      </div>

      {/* Updates table section */}
      <div className="rounded-xl border border-gray-100 bg-white shadow-sm overflow-hidden">

        {/* Table header */}
        <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-gray-100">
          <div>
            <p className="text-sm font-semibold text-gray-700">Submission History</p>
            <p className="text-xs text-gray-400 mt-0.5">
              All task updates by field engineers
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="flex items-center gap-1.5 shrink-0"
            onClick={handleExport}
            disabled={filtered.length === 0}
          >
            <Download className="h-3.5 w-3.5" />
            Export CSV
          </Button>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3 px-5 py-3 border-b border-gray-50 bg-gray-50/50">
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-medium text-gray-500 uppercase tracking-wide">From</label>
            <input
              type="date"
              value={filterFrom}
              onChange={(e) => setFilterFrom(e.target.value)}
              className="h-8 rounded-md border border-gray-200 bg-white px-2 text-xs focus:outline-none focus:ring-2 focus:ring-brand-blue/30"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-medium text-gray-500 uppercase tracking-wide">To</label>
            <input
              type="date"
              value={filterTo}
              onChange={(e) => setFilterTo(e.target.value)}
              className="h-8 rounded-md border border-gray-200 bg-white px-2 text-xs focus:outline-none focus:ring-2 focus:ring-brand-blue/30"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-medium text-gray-500 uppercase tracking-wide">Status</label>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="h-8 rounded-md border border-gray-200 bg-white px-2 text-xs focus:outline-none focus:ring-2 focus:ring-brand-blue/30"
            >
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-medium text-gray-500 uppercase tracking-wide">Engineer</label>
            <select
              value={filterEngineer}
              onChange={(e) => setFilterEngineer(e.target.value)}
              className="h-8 rounded-md border border-gray-200 bg-white px-2 text-xs focus:outline-none focus:ring-2 focus:ring-brand-blue/30"
            >
              <option value="">All engineers</option>
              {fieldUsers.map((u) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          </div>
          {(filterFrom || filterTo || filterStatus || filterEngineer) && (
            <div className="flex flex-col justify-end">
              <button
                type="button"
                onClick={() => {
                  setFilterFrom('');
                  setFilterTo('');
                  setFilterStatus('');
                  setFilterEngineer('');
                }}
                className="h-8 rounded-md border border-gray-200 bg-white px-3 text-xs text-gray-500 hover:bg-gray-50 transition-colors"
              >
                Clear filters
              </button>
            </div>
          )}
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/80">
                {['Date / Time', 'Task #', 'Title', 'Type', 'Site', 'Engineer', 'Status', 'Blocked Reason', 'Photos'].map((h) => (
                  <th
                    key={h}
                    className="px-4 py-2.5 text-left font-medium text-gray-500 whitespace-nowrap"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {updatesLoading && filtered.length === 0 ? (
                [...Array(5)].map((_, i) => (
                  <tr key={i} className={cn(i % 2 === 1 && 'bg-gray-50/50')}>
                    {[...Array(9)].map((__, j) => (
                      <td key={j} className="px-4 py-2.5">
                        <Skeleton className="h-3.5 w-full" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center text-gray-400">
                    No submissions yet.
                  </td>
                </tr>
              ) : (
                filtered.map((u, i) => (
                  <tr
                    key={u.id}
                    className={cn(
                      'border-b border-gray-50 last:border-0 transition-colors hover:bg-blue-50/30',
                      i % 2 === 1 && 'bg-gray-50/40',
                    )}
                  >
                    <td className="px-4 py-2.5 whitespace-nowrap text-gray-500">
                      {fmt(u.submittedAt)}
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap font-mono text-gray-700">
                      {u.taskNum || '—'}
                    </td>
                    <td className="px-4 py-2.5 max-w-[180px] truncate text-gray-800">
                      {u.taskTitle || '—'}
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap text-gray-600">
                      {u.taskType || '—'}
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap text-gray-600">
                      {u.siteCode || '—'}
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap text-gray-700">
                      {u.submittedByName || '—'}
                    </td>
                    <td className="px-4 py-2.5">
                      {u.status ? <StatusBadge status={u.status} /> : '—'}
                    </td>
                    <td className="px-4 py-2.5 max-w-[160px] truncate text-gray-500">
                      {u.blockedReason || '—'}
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      {u.completionPhotos.length > 0 ? (
                        <span className="rounded-full bg-blue-50 text-brand-blue px-2 py-0.5 font-medium">
                          {u.completionPhotos.length} photo{u.completionPhotos.length !== 1 ? 's' : ''}
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

        {/* Load more */}
        {hasMore && !updatesLoading && (
          <div className="flex justify-center px-5 py-4 border-t border-gray-100">
            <Button variant="outline" size="sm" onClick={loadMore}>
              Load More
            </Button>
          </div>
        )}
        {updatesLoading && filtered.length > 0 && (
          <div className="flex justify-center py-4">
            <span className="h-5 w-5 animate-spin rounded-full border-2 border-brand-blue border-t-transparent" />
          </div>
        )}
      </div>

    </div>
  );
}
