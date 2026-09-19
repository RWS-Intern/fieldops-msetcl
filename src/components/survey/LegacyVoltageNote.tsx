import { LEGACY_COMBINED_VOLTAGE_LABEL } from '@/lib/surveyLabels';
import { isLegacyVoltage } from '@/lib/legacyVoltage';
import type { StoredVoltageLevel } from '@/types';

/**
 * Read-only context shown beside a voltage picker whose STORED value is the
 * pre-split combined one.
 *
 * The picker itself renders as unanswered — '66_33' matches none of its
 * options — which is correct but silent. Without this the surveyor would see
 * an empty dropdown with no indication that an answer used to be there, and no
 * way to know what it said. Renders nothing at all for a current value, so it
 * costs nothing on the surveys that aren't affected.
 */
export function LegacyVoltageNote({ level }: { level: StoredVoltageLevel | null }) {
  if (!isLegacyVoltage(level)) return null;

  return (
    <p className="mt-1 rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-800">
      Previously recorded ({LEGACY_COMBINED_VOLTAGE_LABEL}) — please reselect 66 kV or 33 kV above.
    </p>
  );
}

/**
 * The same context for the two per-level RECORDS (bay counts, DC breaker
 * voltage), where the old answer is a value under the legacy key rather than a
 * field's own value — so there is something concrete to show back.
 */
export function LegacyVoltageValueNote({ value }: { value: string | number | null }) {
  if (value === null || value === undefined || value === '') return null;

  return (
    <p className="mt-1 rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-800">
      Previously recorded ({LEGACY_COMBINED_VOLTAGE_LABEL}): <strong>{value}</strong> — please
      re-enter it against 66 kV or 33 kV above.
    </p>
  );
}
