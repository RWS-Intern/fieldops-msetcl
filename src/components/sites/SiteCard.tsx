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
      className="w-full overflow-hidden border-0 shadow-sm cursor-pointer active:scale-[0.99] transition-transform"
      onClick={onView}
    >
      <div className="flex">
        {/* Left colour stripe */}
        <div className="w-1 shrink-0" style={{ backgroundColor: stripe }} />

        <div className="flex-1 p-3 min-w-0">
          {/* Site code + project code badge */}
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <MapPin className="h-3 w-3 text-gray-400 shrink-0" />
            <span className="text-xs font-mono text-gray-400">{site.siteCode}</span>
            {site.projectCode && (
              <span className="text-xs font-mono font-semibold text-brand-blue bg-blue-50 rounded px-1.5 py-0.5">
                {site.projectCode}
              </span>
            )}
            {/* status badge pushed to right */}
            <span
              className={`ml-auto text-xs font-medium px-2 py-0.5 rounded-full shrink-0 ${STATUS_BADGE[site.status]}`}
            >
              {STATUS_LABELS[site.status]}
            </span>
          </div>

          {/* Site name */}
          <h3 className="text-sm font-semibold text-gray-900 leading-snug line-clamp-1">
            {site.siteName}
          </h3>

          {/* Project name */}
          <p className="text-xs text-gray-500 mt-0.5 line-clamp-1">
            {site.projectName}
          </p>

          {/* Location: city, state */}
          <p className="text-xs text-gray-400 mt-0.5">
            {site.city}{site.state ? `, ${site.state}` : ''}
          </p>

          {/* Progress bar */}
          <div className="mt-2">
            <div className="flex items-center justify-between mb-1">
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
          <p className="text-xs text-gray-400 mt-1.5">
            Added {formatDate(site.createdAt)}
          </p>
        </div>
      </div>
    </Card>
  );
}
