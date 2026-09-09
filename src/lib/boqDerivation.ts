import type { SurveyReport, SurveyBoqLine, BayType } from '@/types';

/**
 * Auto-derivation of BOQ quantities from data already captured earlier in the
 * survey (Section C bays, Section D devices) — per the tender-mapping note:
 * "the F-RTU/Remote-IO, MFM, CMR and tap-transducer counts can be auto-derived
 * from the bay/signal entries; service ITC quantities auto-mirror the matching
 * supply items."
 *
 * The mapping specifies the INPUTS but not the exact formulas, so the two
 * channel capacities below are engineering assumptions standing in for a
 * tender clause that has NOT been independently verified. They are isolated as
 * named constants so they can be corrected in one place once the tender's
 * actual FRTU/CMR channel-count spec is checked.
 *
 * Nothing here is authoritative: every derived value lands in an editable
 * field and stops recomputing as soon as the surveyor touches it (see
 * SurveyBoqLine.autoDerived).
 */

// ─── Assumed capacities — VERIFY AGAINST THE TENDER BEFORE THIS SHIPS ─────────

/**
 * ASSUMPTION: one F-RTU / Remote-IO module serves up to this many COMBINED
 * DI+DO+AI points, and modules are not shared between bays (bays are
 * physically separate, so each bay's I/O terminates on its own module set).
 *
 * Caveat worth checking alongside the number itself: real remote-IO hardware
 * is usually built from separate DI / DO / AI cards rather than one mixed
 * pool, so a per-signal-type calculation may turn out to be the correct shape
 * — this combined form follows the brief as written.
 */
export const FRTU_MODULE_CHANNEL_CAPACITY = 32;

/**
 * ASSUMPTION: one CMR DIN-rail unit multiplies up to this many status/control
 * (DI+DO) contacts. Applied to the station-wide total rather than per bay,
 * since CMR units are pooled in the panel.
 */
export const CMR_CHANNEL_CAPACITY = 16;

/**
 * Bay types that carry metering and therefore need an MFM. Bus couplers and
 * bus sections are excluded — they don't meter.
 */
export const MFM_METERING_BAY_TYPES: readonly BayType[] = [
  'transformer', 'line', 'capacitor', 'reactor',
];

// ─── Which lines are under auto-derivation control ────────────────────────────

/** Service item -> the supply item whose final quantity it mirrors 1:1. */
export const SERVICE_TO_SUPPLY_MIRROR: Readonly<Record<string, string>> = {
  itcNetworkingPanel:          'networkingPanel',
  itcRemoteIoFrtu:             'frtuRemoteIo',
  itcMfm:                      'mfm',
  powerCableLayingTermination: 'powerSupplyCable',
  cat6CableLayingTermination:  'cat6Cable',
};

const AUTO_DERIVED_SUPPLY_ITEM_KEYS = [
  'frtuRemoteIo', 'mfm', 'cmrDinRail', 'tapPositionTransducer',
] as const;

/**
 * Every itemKey whose quantity this module computes. Used by
 * createEmptyBoqLines() to seed `autoDerived: true` on exactly these lines —
 * that flag is what marks a line as "still under auto control", so a line not
 * in this set is never touched by a recompute.
 */
export const AUTO_DERIVED_ITEM_KEYS: ReadonlySet<string> = new Set<string>([
  ...AUTO_DERIVED_SUPPLY_ITEM_KEYS,
  'substationSurvey',
  ...Object.keys(SERVICE_TO_SUPPLY_MIRROR),
]);

// ─── Derivation ───────────────────────────────────────────────────────────────

/**
 * Supply-part quantities derived from Sections C (bays) and D (devices).
 * Returns a plain itemKey -> quantity map; keys absent from the map are not
 * derived at all.
 */
export function deriveSupplyQuantities(survey: SurveyReport): Record<string, number> {
  const bays = survey.bays;

  // Σ over bays of ceil((DI + DO + AI) / capacity) — per bay, not pooled.
  const frtuRemoteIo = bays.reduce((sum, bay) => {
    const points = (bay.diPoints ?? 0) + (bay.doPoints ?? 0) + (bay.aiPoints ?? 0);
    return sum + (points > 0 ? Math.ceil(points / FRTU_MODULE_CHANNEL_CAPACITY) : 0);
  }, 0);

  // Metering-relevant bays, less any existing MFM the surveyor marked reusable.
  // Sums the device rows' `quantity` (one row can represent several units).
  // A row with a null quantity subtracts nothing — it is an incomplete row that
  // validation already flags, and under-subtracting errs toward over-supply
  // rather than leaving the site short.
  const meteringBays = bays.filter(
    (bay) => bay.bayType !== null && MFM_METERING_BAY_TYPES.includes(bay.bayType),
  ).length;
  const reusableMfms = survey.devices
    .filter((d) => d.deviceType === 'mfm' && d.reusable === true)
    .reduce((sum, d) => sum + (d.quantity ?? 0), 0);
  const mfm = Math.max(0, meteringBays - reusableMfms);

  // Station-wide DI+DO total against one CMR capacity (see the constant).
  const totalContactPoints = bays.reduce(
    (sum, bay) => sum + (bay.diPoints ?? 0) + (bay.doPoints ?? 0),
    0,
  );
  const cmrDinRail = totalContactPoints > 0
    ? Math.ceil(totalContactPoints / CMR_CHANNEL_CAPACITY)
    : 0;

  const tapPositionTransducer = bays.filter(
    (bay) => bay.bayType === 'transformer' && bay.tapChangerPresent === true,
  ).length;

  return { frtuRemoteIo, mfm, cmrDinRail, tapPositionTransducer };
}

/**
 * Service-part quantities. `substationSurvey` is always 1; the rest mirror
 * their matching supply line's FINAL quantity — whatever it is after any
 * manual override — so this must be called with the supply lines as they
 * stand after deriveSupplyQuantities has been applied.
 *
 * A blank supply line mirrors as null rather than 0: 0 would assert "no ITC
 * needed here", which is a claim nobody has made yet. Both lines then stay
 * blank and validation flags both.
 */
export function deriveServiceQuantities(
  boqSupply: readonly SurveyBoqLine[],
): Record<string, number | null> {
  const derived: Record<string, number | null> = { substationSurvey: 1 };
  for (const [serviceKey, supplyKey] of Object.entries(SERVICE_TO_SUPPLY_MIRROR)) {
    derived[serviceKey] = boqSupply.find((l) => l.itemKey === supplyKey)?.surveyedQty ?? null;
  }
  return derived;
}

/**
 * Writes derived quantities into the lines still under auto control, leaving
 * every other line exactly as it was.
 *
 * A line is skipped when `autoDerived` is false (the surveyor has edited it or
 * ticked not-applicable — it is a manual override from then on) or when
 * `notApplicable` is set. Returns the ORIGINAL array reference when nothing
 * changed, so the caller can cheaply detect a no-op and avoid an update loop.
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
    if (line.surveyedQty === value) return line;

    changed = true;
    return { ...line, surveyedQty: value };
  });

  return changed ? next : lines;
}
