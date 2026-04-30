import { MapPin } from 'lucide-react';
import { Card } from '@/components/ui/card';
import type { Site, SiteStatus } from '@/types';

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_STRIPE: Record<SiteStatus, string> = {
  active:    '#0077B6',
  completed: '#2A9D8F',
  on_hold:   '#9CA3AF',
};

const STATUS_BADGE: Record<SiteStatus, string> = {
  active:    'bg-blue-50 text-brand-blue',
  completed: 'bg-green-50 text-green-700',
  on_hold:   'bg-gray-100 text-gray-500',
};

const STATUS_LABELS: Record<SiteStatus, string> = {
  active:    'Active',
  completed: 'Completed',
  on_hold:   'On Hold',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-GB', {
    day:   '2-digit',
    month: 'short',
    year:  'numeric',
  });
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface SiteCardProps {
  site:   Site;
  onView: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function SiteCard({ site, onView }: SiteCardProps) {
  const stripe     = STATUS_STRIPE[site.status] ?? '#9CA3AF';
  const progressPct =
    site.taskCount > 0
      ? Math.round((site.completedTaskCount / site.taskCount) * 100)
      : 0;

  return (
    <Card
      className="w-full cursor-pointer overflow-hidden border-0 shadow-sm transition-transform active:scale-[0.99]"
      onClick={onView}
    >
      <div className="flex">
        {/* Left colour stripe */}
        <div className="w-1 shrink-0" style={{ backgroundColor: stripe }} />

        <div className="min-w-0 flex-1 p-3.5 sm:p-4">
          {/* Site code + project code badge */}
          <div className="mb-2 flex items-start justify-between gap-3">
            <div className="min-w-0 flex flex-wrap items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5 shrink-0 text-gray-400" />
              <span className="text-xs font-mono text-gray-400">{site.siteCode}</span>
              {site.projectCode && (
                <span className="rounded bg-blue-50 px-1.5 py-0.5 text-xs font-mono font-semibold text-brand-blue">
                  {site.projectCode}
                </span>
              )}
            </div>
            <span
              className={`shrink-0 rounded-full px-2 py-1 text-[11px] font-medium ${STATUS_BADGE[site.status]}`}
            >
              {STATUS_LABELS[site.status]}
            </span>
          </div>

          {/* Site name */}
          <h3 className="line-clamp-2 text-[15px] font-semibold leading-snug text-gray-900 sm:line-clamp-1">
            {site.siteName}
          </h3>

          {/* Project name */}
          <p className="mt-1 line-clamp-1 text-sm text-gray-500">
            {site.projectName}
          </p>

          {/* Location: city, state */}
          <p className="mt-1 text-sm text-gray-400">
            {site.city}{site.state ? `, ${site.state}` : ''}
          </p>

          {/* Progress bar */}
          <div className="mt-3">
            <div className="mb-1.5 flex items-center justify-between gap-3">
              <span className="text-xs text-gray-500">
                {site.completedTaskCount} of {site.taskCount} task
                {site.taskCount !== 1 ? 's' : ''} completed
              </span>
              <span className="text-xs font-medium text-gray-600">{progressPct}%</span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-gray-100 overflow-hidden">
              <div
                className="h-full rounded-full bg-green-500 transition-all duration-300"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>

          {/* Created date */}
          <p className="mt-2 text-xs text-gray-400">
            Added {formatDate(site.createdAt)}
          </p>
        </div>
      </div>
    </Card>
  );
}
