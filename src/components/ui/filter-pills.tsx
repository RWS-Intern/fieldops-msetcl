import { cn } from '@/lib/utils';

/**
 * One row of count-bearing filter pills.
 *
 * Extracted so the Approvals queue and the review history render the SAME
 * control rather than a third and fourth hand-rolled copy. The styling is
 * lifted verbatim from TasksPage's status pills — the app's established
 * convention — including the bare trailing count rather than a "(N)" form, so
 * a user moving between these screens sees one component, not three dialects.
 *
 * Generic over the key type so each caller keeps its own union (no stringly
 * typed filter keys leaking into page state).
 */
export function FilterPills<K extends string>({
  pills, active, onChange, counts, ariaLabel,
}: {
  pills:     readonly { key: K; label: string }[];
  active:    K;
  onChange:  (key: K) => void;
  counts:    Readonly<Record<K, number>>;
  ariaLabel: string;
}) {
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label={ariaLabel}>
      {pills.map(({ key, label }) => {
        const isActive = active === key;
        return (
          <button
            key={key}
            type="button"
            aria-pressed={isActive}
            onClick={() => onChange(key)}
            className={cn(
              'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
              isActive
                ? 'border-brand-blue bg-brand-blue text-white'
                : 'border-gray-200 bg-white text-gray-500 hover:border-gray-300 hover:bg-gray-50',
            )}
          >
            {label}
            <span className={cn('ml-1', isActive ? 'opacity-75' : 'text-gray-400')}>
              {counts[key]}
            </span>
          </button>
        );
      })}
    </div>
  );
}
