import { LEGACY_COMBINED_VOLTAGE_LABEL, PROTOCOL_LABELS } from '@/lib/surveyLabels';
import { isLegacyVoltage } from '@/lib/legacyVoltage';
import type { StoredVoltageLevel, DeviceProtocol } from '@/types';

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

/**
 * The same read-back for the superseded combined "MFM available & working"
 * answer, which the two separate toggles replaced.
 *
 * Deliberately a THIRD component rather than a reuse of the one above: that
 * one's wording names a voltage level, and this answer is a yes/no about a
 * meter. What they share is the rule, not the text — show the old answer, ask
 * for it again, never guess. Renders nothing for a feeder that has none, which
 * is every feeder answered since the split.
 */
export function LegacyCombinedMfmNote({ value }: { value: boolean | null }) {
  if (value === null || value === undefined) return null;

  return (
    <p className="mt-1 rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-800">
      Previously recorded as one combined answer (MFM available &amp; working):{' '}
      <strong>{value ? 'Yes' : 'No'}</strong> — please answer the two questions above
      separately.
    </p>
  );
}

/**
 * A relay's superseded Protocol / IP Address, shown read-only on the entry
 * that holds them.
 *
 * Worded as a statement, not a request: unlike the notes above there is no
 * field to re-enter these into, so asking would be asking for the impossible.
 * Renders nothing for a relay that has neither, which is every relay answered
 * since the fields were removed.
 */
export function LegacyRelayNote({
  protocol, ipAddress,
}: {
  protocol:  string | null;
  ipAddress: string | null;
}) {
  const recorded = [
    protocol  ? `Protocol: ${PROTOCOL_LABELS[protocol as DeviceProtocol] ?? protocol}` : null,
    ipAddress ? `IP Address: ${ipAddress}` : null,
  ].filter(Boolean) as string[];
  if (recorded.length === 0) return null;

  return (
    <p className="rounded border border-gray-200 bg-gray-50 px-2 py-1.5 text-xs text-gray-600">
      Previously recorded, no longer collected — <strong>{recorded.join(' · ')}</strong>. Kept
      for reference only; the form no longer asks for these.
    </p>
  );
}

/**
 * The pre-table Circle / Division answer, shown beside the O&M / PAC table
 * that replaced it.
 *
 * Its own component rather than a reuse of LegacyVoltageValueNote, whose
 * wording names a voltage level. What they share is the rule — show the old
 * answer, ask for it again, never guess which column it belongs in.
 */
export function LegacyOfficeNote({ label, value }: { label: string; value: string | null }) {
  if (value === null || value === undefined || value.trim() === '') return null;

  return (
    <p className="mt-1 rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-800">
      Previously recorded {label} (before the office was split into O&amp;M and PAC):{' '}
      <strong>{value}</strong> — please re-enter it in the correct column above.
    </p>
  );
}
