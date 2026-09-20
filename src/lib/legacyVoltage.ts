import { LEGACY_COMBINED_VOLTAGE_LEVEL } from '@/types';
import type { StoredVoltageLevel, SurveyReport } from '@/types';

/**
 * Detection and read-back for answers that a STRUCTURE CHANGE left without a
 * field of their own:
 *   - levels recorded before 66/33kV was split into two;
 *   - the flat transformer/bus/capacitor-bank totals the 4 x 7 asset grid
 *     replaced;
 *   - the fixed 10-slot ACDB/DCDB MCB tables the two board details replaced;
 *   - the combined "MFM available & working" answer the two toggles replaced.
 *
 * Nothing here migrates anything. A feeder's real level, a DC breaker voltage
 * or a bay count can genuinely differ between 66kV and 33kV, so copying the
 * old combined value into either would write a confidently wrong answer onto a
 * document that governs a government submission. These helpers only FIND the
 * old answers and hand them back for a human to re-enter.
 */

/** True when a stored level is the pre-split combined value. */
export function isLegacyVoltage(level: StoredVoltageLevel | null | undefined): boolean {
  return level === LEGACY_COMBINED_VOLTAGE_LEVEL;
}

/** One place in the survey still holding a pre-split answer. */
export interface LegacyVoltageHit {
  /** Which section, for the banner's summary line. */
  section: 'Feeder List' | 'CRP Relay Details' | 'Transformer Details'
         | 'Capacitor Banks' | 'DC breaker voltage' | 'Bay counts'
         | 'Asset totals' | 'ACDB/DCDB slots' | 'MFM availability';
  /** How that one entry identifies itself, e.g. a bay name. */
  label: string;
  /** The old value as recorded, where there is one worth showing back. */
  value?: string;
}

/**
 * Every pre-split answer still present on this survey.
 *
 * Covers all five places a level can be stored: the four repeatable groups'
 * own level fields, and the two per-level records (which keep the legacy key
 * precisely so it can be read here — see the note on SurveyAssetCounts).
 */
export function findLegacyVoltageData(survey: SurveyReport): LegacyVoltageHit[] {
  const hits: LegacyVoltageHit[] = [];

  survey.feeders.forEach((f, i) => {
    if (isLegacyVoltage(f.nominalVoltage)) {
      hits.push({ section: 'Feeder List', label: f.bayName?.trim() || `Feeder #${i + 1}` });
    }
  });
  // The combined MFM answer. Same class of problem as a combined voltage
  // level: still stored, no longer has a field, and only the surveyor can say
  // which half a "no" meant.
  survey.feeders.forEach((f, i) => {
    if (f.existingMfmAvailableWorking != null) {
      hits.push({
        section: 'MFM availability',
        label:   f.bayName?.trim() || `Feeder #${i + 1}`,
        value:   f.existingMfmAvailableWorking ? 'Yes' : 'No',
      });
    }
  });

  survey.relays.forEach((r, i) => {
    if (isLegacyVoltage(r.nominalVoltage)) {
      hits.push({ section: 'CRP Relay Details', label: r.bayName?.trim() || `Relay #${i + 1}` });
    }
  });
  survey.transformers.forEach((t, i) => {
    if (isLegacyVoltage(t.voltageLevel)) {
      hits.push({
        section: 'Transformer Details',
        label: t.transformerNumber?.trim() || `Transformer #${i + 1}`,
      });
    }
  });
  survey.capacitorBanks.forEach((c, i) => {
    if (isLegacyVoltage(c.voltageLevel)) {
      hits.push({
        section: 'Capacitor Banks',
        label: c.bankNumber?.trim() || `Capacitor bank #${i + 1}`,
      });
    }
  });

  const legacyDc = survey.siteChecklist.acDcSupply.dcBreakerVoltageByLevel[LEGACY_COMBINED_VOLTAGE_LEVEL];
  if (legacyDc != null) {
    hits.push({ section: 'DC breaker voltage', label: 'Combined 66/33kV row', value: `${legacyDc}V` });
  }

  const legacyBays = survey.assetCounts.baysByVoltage[LEGACY_COMBINED_VOLTAGE_LEVEL];
  if (legacyBays != null) {
    hits.push({ section: 'Bay counts', label: 'Combined 66/33kV row', value: String(legacyBays) });
  }

  // The three flat totals the 4 x 7 asset grid replaced. Same class of problem
  // and same remedy: the answer is still stored, no longer has a field of its
  // own, and only a human can say which voltage levels it belongs to.
  const totals: [string, number | null][] = [
    ['Transformers total', survey.assetCounts.transformerCount],
    ['Buses total',        survey.assetCounts.busCount],
    ['Capacitor banks total', survey.assetCounts.capacitorBankCount],
  ];
  for (const [label, value] of totals) {
    if (value != null) hits.push({ section: 'Asset totals', label, value: String(value) });
  }

  // The fixed 10-slot MCB tables the two board details replaced. A slot counts
  // as answered if either column was filled.
  const boards: [string, typeof survey.acdcMcbDetails.acdbMcbSlots][] = [
    ['ACDB', survey.acdcMcbDetails.acdbMcbSlots],
    ['DCDB', survey.acdcMcbDetails.dcdbMcbSlots],
  ];
  for (const [board, slots] of boards) {
    slots.forEach((slot, i) => {
      if (slot.poleType === null && slot.ratingA === null) return;
      hits.push({
        section: 'ACDB/DCDB slots',
        label:   `${board} MCB ${i + 1}`,
        value:   [slot.poleType, slot.ratingA].filter(Boolean).join(', ') || undefined,
      });
    });
  }

  return hits;
}

/**
 * Whether this survey has ANY pre-split answer left.
 *
 * Cheap enough to call on every render (it walks four short arrays and reads
 * two keys), which is what lets the wizard show its banner on every step
 * rather than only on the sections that happen to be affected.
 */
export function surveyHasLegacyVoltageData(survey: SurveyReport): boolean {
  return findLegacyVoltageData(survey).length > 0;
}
