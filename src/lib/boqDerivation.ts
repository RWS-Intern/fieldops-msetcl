import { BOQ_DERIVED_ITEMS } from '@/lib/boqMaster';
import type { SurveyReport, SurveyBoqLine, SurveyTransformerEntry } from '@/types';

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
 * Does this transformer need a NEW tap position transducer supplied?
 *
 * The full rule, and the only place it lives:
 *
 *   existingTptWorking === false                      -> true  (nothing to reuse)
 *   existingTptWorking === true  && modbus === true    -> false (integrate the existing one)
 *   existingTptWorking === true  && modbus === false   -> true  (cannot be integrated)
 *   either question unanswered                         -> null  (contributes nothing)
 *
 * The null case is the important one and is NOT the same as false: a
 * transformer nobody has answered must not quietly read as "doesn't need
 * one". Same null-vs-zero discipline as the rest of the survey.
 *
 * Exported so the step can show the surveyor the consequence of their two
 * answers rather than making them infer it from the BOQ.
 */
export function transformerNeedsNewTpt(tx: SurveyTransformerEntry): boolean | null {
  if (tx.existingTptWorking === false) return true;
  if (tx.existingTptWorking !== true)  return null;   // null / undefined
  if (tx.modbusAvailable === null || tx.modbusAvailable === undefined) return null;
  return !tx.modbusAvailable;
}

/** The predicates a BOQ master item may name. */
const TRANSFORMER_PREDICATES: Record<'needsNewTpt', (tx: SurveyTransformerEntry) => boolean | null> = {
  needsNewTpt: transformerNeedsNewTpt,
};

/**
 * Computes every derived line's suggested quantity.
 *
 * Returns a plain itemKey -> quantity map; keys absent from the map are not
 * derived at all.
 *
 * TWO SOURCES, per the master's two mutually-exclusive source fields:
 *   - derivedFromFeederField     — SUMS a numeric column across survey.feeders
 *                                  (MFM / CMR / F-RTU)
 *   - derivedFromTransformerPredicate — COUNTS survey.transformers a named
 *                                  predicate answers true for (tap position
 *                                  transducer). A predicate, not a field
 *                                  name, because the TPT rule reads two
 *                                  fields — see transformerNeedsNewTpt.
 *
 * In both cases a total is `null`, not 0, when NOTHING has been answered
 * (including when the source array is empty). 0 would assert "none needed at
 * this site", which is a claim nobody has made — the line must stay blank so
 * validation flags it. An entry that explicitly answered (0, or false) IS an
 * answer and makes the total a real number; entries left blank contribute
 * nothing to a total that other entries have started.
 */
export function deriveSupplyQuantities(survey: SurveyReport): Record<string, number | null> {
  const derived: Record<string, number | null> = {};

  for (const item of BOQ_DERIVED_ITEMS) {
    if (item.derivedFromFeederField) {
      const field = item.derivedFromFeederField;
      let total: number | null = null;
      for (const feeder of survey.feeders) {
        const value = feeder[field];
        if (value === null || value === undefined) continue;
        total = (total ?? 0) + value;
      }
      derived[item.itemKey] = total;
      continue;
    }

    if (item.derivedFromTransformerPredicate) {
      const predicate = TRANSFORMER_PREDICATES[item.derivedFromTransformerPredicate];
      let count: number | null = null;
      for (const transformer of survey.transformers) {
        const value = predicate(transformer);
        // null means this transformer has not been answered enough to say —
        // it contributes nothing, and does NOT start a total at 0.
        if (value === null) continue;
        count = (count ?? 0) + (value ? 1 : 0);
      }
      derived[item.itemKey] = count;
      continue;
    }

    // An autoDerived master item with no source field has nothing to compute —
    // leave it out of the map entirely so applyDerivedQuantities skips it
    // rather than blanking a line the surveyor may have filled.
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
