import { BOQ_DERIVED_ITEMS } from '@/lib/boqMaster';
import type { SurveyReport, SurveyBoqLine } from '@/types';

/**
 * Auto-derivation of BOQ quantities from the Feeder List.
 *
 * This module used to compute F-RTU / CMR / MFM counts from summed DI/DO/AI
 * signal totals divided by assumed channel capacities. That whole approach is
 * GONE: the official checklist asks the surveyor for those three counts
 * directly, per feeder, so there is nothing left to infer. The assumed
 * capacities were flagged as unverified engineering guesses from the day they
 * were written — the document has now confirmed direct entry is correct, so
 * they are deleted rather than corrected.
 *
 * What remains is a straight column sum: for each BOQ line the master marks
 * `autoDerived`, add up the matching field across every feeder and offer the
 * total as `requiredToSupply`. No formulas, no assumptions, no constants.
 *
 * Which lines are derived is decided by boqMaster.ts (`autoDerived` +
 * `derivedFromFeederField`), never by a list kept here — adding or removing a
 * derived line is a one-line master edit and this module follows.
 *
 * Nothing here is authoritative: every derived value lands in an editable
 * field and stops recomputing as soon as the surveyor touches it (see
 * SurveyBoqLine.autoDerived).
 */

/**
 * The itemKeys under auto-derivation control, from the master.
 *
 * Exported for the read mapper, which needs it to decide whether a legacy BOQ
 * line — written before `autoDerived` was persisted — should be treated as
 * still-derived or as a manual entry.
 */
export const DERIVED_ITEM_KEYS: ReadonlySet<string> = new Set(
  BOQ_DERIVED_ITEMS.map((item) => item.itemKey),
);

/**
 * Sums each derived line's feeder field across the Feeder List.
 *
 * Returns a plain itemKey -> quantity map; keys absent from the map are not
 * derived at all.
 *
 * A total is `null`, not 0, when NO feeder has answered that column (including
 * when there are no feeders yet). 0 would assert "none needed at this site",
 * which is a claim nobody has made — the line must stay blank so validation
 * flags it. A feeder that explicitly answered 0 IS an answer and makes the
 * total a real number; feeders that left the column blank contribute nothing
 * to a total that other feeders have started.
 */
export function deriveSupplyQuantities(survey: SurveyReport): Record<string, number | null> {
  const derived: Record<string, number | null> = {};

  for (const item of BOQ_DERIVED_ITEMS) {
    const field = item.derivedFromFeederField;
    // An autoDerived master item with no source field has nothing to sum —
    // leave it out of the map entirely so applyDerivedQuantities skips it
    // rather than blanking a line the surveyor may have filled.
    if (!field) continue;

    let total: number | null = null;
    for (const feeder of survey.feeders) {
      const value = feeder[field];
      if (value === null || value === undefined) continue;
      total = (total ?? 0) + value;
    }
    derived[item.itemKey] = total;
  }

  return derived;
}

/**
 * Writes derived quantities into `requiredToSupply` on the lines still under
 * auto control, leaving every other line exactly as it was.
 *
 * A line is skipped when `autoDerived` is false (the surveyor has edited it or
 * ticked not-applicable — it is a manual override from then on) or when
 * `notApplicable` is set. `existingUsable` is NEVER derived: what is already
 * installed at the site is an observation, not a calculation.
 *
 * Returns the ORIGINAL array reference when nothing changed, so the caller can
 * cheaply detect a no-op and avoid an update loop.
 */
export function applyDerivedQuantities(
  lines: SurveyBoqLine[],
  derived: Record<string, number | null>,
): SurveyBoqLine[] {
  let changed = false;

  const next = lines.map((line) => {
    if (!line.autoDerived || line.notApplicable) return line;
    if (!(line.itemKey in derived)) return line;

    const value = derived[line.itemKey];
    if (line.requiredToSupply === value) return line;

    changed = true;
    return { ...line, requiredToSupply: value };
  });

  return changed ? next : lines;
}
