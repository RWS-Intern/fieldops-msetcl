import { LEGACY_COMBINED_VOLTAGE_LEVEL } from '@/types';
import type { StoredVoltageLevel, SurveyReport } from '@/types';

/**
 * Detection and read-back for answers that a STRUCTURE CHANGE left without a
 * field of their own:
 *   - levels recorded before 66/33kV was split into two;
 *   - the flat transformer/bus/capacitor-bank totals the 4 x 7 asset grid
 *     replaced;
 *   - the fixed 10-slot ACDB/DCDB MCB tables the two board details replaced;
 *   - the combined "MFM available & working" answer the two toggles replaced;
 *   - the single Circle/Division the two-office O&M/PAC table replaced;
 *   - relay Protocol / IP Address, which no longer have a field at all;
 *   - the Substation Telephone pair, Shift Operator contacts, and the Room
 *     Temperature / AC / Mounting Structure group, likewise removed outright;
 *   - the Step 6 checklist rows with no equivalent in the document's own five
 *     tables, retired by the same reconciliation.
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
  /**
   * Whether there is somewhere to put this answer.
   *
   * 're-enter' (the default) — the question is still asked, in a differently
   * shaped field, so this is an outstanding action and the banner counts it.
   *
   * 'reference' — the question is GONE. The stored answer is shown back so it
   * is not silently lost, but nobody can act on it, so it must never keep the
   * banner alive: a notice that cannot be cleared is a notice people learn to
   * ignore.
   */
  kind?: 're-enter' | 'reference';
  /** Which section, for the banner's summary line. */
  section: 'Feeder List' | 'CRP Relay Details' | 'Transformer Details'
         | 'Capacitor Banks' | 'DC breaker voltage' | 'Bay counts'
         | 'Asset totals' | 'ACDB/DCDB slots' | 'MFM availability'
         | 'Office (Circle / Division)' | 'Relay Protocol / IP'
         | 'Contact Details' | 'Control Room' | 'Site Checklist';
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
  // Protocol and IP Address, which the CRP Relay Details step no longer asks
  // for. Reference only — there is no field to re-enter them into.
  survey.relays.forEach((r, i) => {
    const recorded = [
      r.protocol  ? `protocol ${r.protocol}` : null,
      r.ipAddress ? `IP ${r.ipAddress}`      : null,
    ].filter(Boolean);
    if (recorded.length > 0) {
      hits.push({
        kind:    'reference',
        section: 'Relay Protocol / IP',
        label:   r.bayName?.trim() || `Relay #${i + 1}`,
        value:   recorded.join(', '),
      });
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

  // The single Circle / Division the two-office table replaced. Each surfaces
  // on its own: a survey may hold one without the other.
  const office: [string, string | null][] = [
    ['Circle',   survey.contactDetails.circle],
    ['Division', survey.contactDetails.division],
  ];
  for (const [label, value] of office) {
    if (value != null && value.trim() !== '') {
      hits.push({ section: 'Office (Circle / Division)', label, value });
    }
  }

  // Fields removed outright from Contact Details and Control Room. REFERENCE
  // hits: there is no replacement field, so these are historical context, not
  // an action — exactly how relay Protocol / IP is handled above. A boolean is
  // rendered as Yes/No so `false` surfaces too; `!= null` is what catches it,
  // since a recorded "no" is every bit as much an answer as a "yes".
  const removed: ['Contact Details' | 'Control Room', string, string | number | boolean | null][] = [
    ['Contact Details', 'Substation Telephone — Landline', survey.contactDetails.substationLandline],
    ['Contact Details', 'Substation Telephone — VOIP',     survey.contactDetails.substationVoip],
    ['Contact Details', 'Contact Details of Shift Operators', survey.contactDetails.shiftOperatorContacts],
    ['Control Room',    'Room Temperature',                survey.controlRoom.roomTemperature],
    ['Control Room',    'AC available',                    survey.controlRoom.acAvailable],
    ['Control Room',    'AC Condition',                    survey.controlRoom.acCondition],
    ['Control Room',    'Mounting Structure / Existing RTU Panel Dimensions',
      survey.controlRoom.mountingStructureOrRtuPanelDimensions],
  ];
  for (const [section, label, value] of removed) {
    if (value == null) continue;
    if (typeof value === 'string' && value.trim() === '') continue;
    hits.push({
      kind:    'reference',
      section,
      label,
      value:   typeof value === 'boolean' ? (value ? 'Yes' : 'No') : String(value),
    });
  }

  // Step 6 rows retired by the reconciliation against the document's five
  // tables. REFERENCE hits — no replacement field exists for any of them, and
  // `cableRouteExists` in particular must never be read as an answer to
  // `cableLayingMethod`: a yes/no cannot mean "trench" or "wall mounting".
  const checklistRemoved: [string, string | number | boolean | null][] = [
    ['Outdoor civil work status',      survey.siteChecklist.outdoorCivilWorkStatus],
    ['Channel make',                   survey.siteChecklist.communication?.channelMake ?? null],
    ['Cable route already exists',     survey.siteChecklist.communication?.cableRouteExists ?? null],
    ['Lightning protection to control room', survey.siteChecklist.lightningProtectionToControlRoom],
    ['Storage space for the RTU panel', survey.siteChecklist.storage?.storageSpaceForRtuPanel ?? null],
    ['Install space for F-RTU / switch / MFM + CMR',
      survey.siteChecklist.storage?.installSpaceForFrtuSwitchMfmCmr ?? null],
  ];
  for (const [label, value] of checklistRemoved) {
    if (value == null) continue;
    if (typeof value === 'string' && value.trim() === '') continue;
    hits.push({
      kind:    'reference',
      section: 'Site Checklist',
      label,
      value:   typeof value === 'boolean' ? (value ? 'Yes' : 'No') : String(value),
    });
  }

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
 * Whether this survey has any ACTIONABLE orphaned answer — one the banner
 * should keep asking about. Reference-only hits are excluded on purpose: see
 * the note on LegacyVoltageHit.kind.
 *
 * Cheap enough to call on every render (it walks four short arrays and reads
 * two keys), which is what lets the wizard show its banner on every step
 * rather than only on the sections that happen to be affected.
 */
export function surveyHasLegacyVoltageData(survey: SurveyReport): boolean {
  return findLegacyVoltageData(survey).some((h) => h.kind !== 'reference');
}
