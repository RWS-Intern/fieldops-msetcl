import type {
  BayType, DeviceType, DeviceProtocol, SurveyCableRun,
  SurveyInfrastructure, SurveyPreVisit, SurveyBoqChecks,
  SurveyVoltageLevel, SurveyDcVoltage, SurveyRelayType, SurveyCapacitorBank,
} from '@/types';

/**
 * Enum display labels and checklist wording for the survey form — the single
 * source of truth shared by the step components (StepBays.tsx, StepDevices.tsx,
 * StepCableRuns.tsx, StepInfrastructure.tsx, StepSiteVisit.tsx, StepBoq.tsx)
 * and the read-only SurveyPreview.tsx. No map may be defined in more than one
 * of those files — a preview whose wording differs from the form it's
 * previewing is a correctness problem on a document an MSETCL engineer signs.
 *
 * BOQ item names (SUPPLY_BOQ_MASTER/SERVICE_BOQ_MASTER in boqMaster.ts) and
 * photo slot names (SURVEY_PHOTO_SLOTS in surveyValidation.ts) are NOT here —
 * they already have their own shared homes.
 */

// ─── Shared across the rebuilt sections ─────────────────────────────────────────

/**
 * Nominal voltage, used by the Feeder List, CRP Relay Details, Transformer
 * Details, Capacitor Bank Details and the per-level asset counts / DC breaker
 * pickers — every one of them offers the same four options, so they share one
 * map rather than each spelling out "66 / 33 kV".
 *
 * 66 and 33 are ONE option, not two: the source checklist buckets them
 * together (see SurveyVoltageLevel).
 */
export const VOLTAGE_LEVEL_LABELS: Record<SurveyVoltageLevel, string> = {
  '132':   '132 kV',
  '110':   '110 kV',
  '100':   '100 kV',
  '66_33': '66 / 33 kV',
};

/**
 * The bay-count row labels, VERBATIM from the source document — including its
 * unspaced "132kV" and the "(If any)" qualifier on the combined 66/33 row.
 *
 * A separate map rather than `Number of Bays on ${VOLTAGE_LEVEL_LABELS[l]}`
 * because the document's wording differs from the generic picker labels in
 * both spacing and that qualifier, and this text appears on a page an MSETCL
 * engineer signs. Lives here, not in the step, so SurveyPreview renders the
 * identical wording when it's rewritten — the parity rule above.
 */
export const BAY_COUNT_LABELS: Record<SurveyVoltageLevel, string> = {
  '132':   'Number of Bays on 132kV',
  '110':   'Number of Bays on 110kV',
  '100':   'Number of Bays on 100kV',
  '66_33': 'Number of Bays on 66 or 33kV (If any)',
};

// ─── Feeder List (replaces Section C — Bays) ────────────────────────────────────

/**
 * @deprecated Retained only for StepBays.tsx / SurveyPreview.tsx, which still
 * read the old `bays` shape and are rewritten in a later phase. The Feeder
 * List has no bay-type column — delete this map with its last consumer.
 */
export const BAY_TYPE_LABELS: Record<BayType, string> = {
  line:         'Line',
  transformer:  'Transformer',
  bus_coupler:  'Bus Coupler',
  bus_section:  'Bus Section',
  capacitor:    'Capacitor',
  reactor:      'Reactor',
};

// ─── CRP Relay Details (replaces Section D — Devices) ───────────────────────────

/**
 * @deprecated Same reasoning as BAY_TYPE_LABELS — the relay table records a
 * make/model and a relay TYPE, not a device-type enum.
 */
export const DEVICE_TYPE_LABELS: Record<DeviceType, string> = {
  mfm:             'MFM',
  cmr:             'CMR',
  tpi:             'TPI',
  gps:             'GPS',
  numerical_relay: 'Numerical Relay',
  legacy_rtu:      'Legacy RTU',
};

/** NOT deprecated — SurveyRelayEntry.protocol reuses this union unchanged. */
export const PROTOCOL_LABELS: Record<DeviceProtocol, string> = {
  modbus:    'Modbus',
  iec_61850: 'IEC 61850',
  iec_103:   'IEC 103',
  serial:    'Serial',
  none:      'None',
};

export const RELAY_TYPE_LABELS: Record<SurveyRelayType, string> = {
  electro_mechanical: 'Electro-Mechanical',
  static:             'Static',
  numeric:            'Numeric',
};

// PORT_LABELS is GONE along with SurveyDevice['port'], which was its only type
// source. The relay table has no port column — whether a device speaks RS485
// is now recorded per feeder (SurveyFeederEntry.existingMfmRs485Available).

// ─── Capacitor Bank Details (new) ───────────────────────────────────────────────

export type CapacitorControlType = NonNullable<SurveyCapacitorBank['controlType']>;

export const CAPACITOR_CONTROL_TYPE_LABELS: Record<CapacitorControlType, string> = {
  auto:   'Auto',
  manual: 'Manual',
};

// ─── Section H — Cable runs ──────────────────────────────────────────────────────

export type CableType = NonNullable<SurveyCableRun['cableType']>;

export const CABLE_TYPE_LABELS: Record<CableType, string> = {
  cat6:  'CAT6',
  power: 'Power',
};

export type Trays = NonNullable<SurveyCableRun['trays']>;

export const TRAYS_LABELS: Record<Trays, string> = {
  available:    'Available',
  new_required: 'New Required',
};

// ─── Sections E–G — Infrastructure ───────────────────────────────────────────────

export type CivilWork = SurveyInfrastructure['civilWork'][number];

export const CIVIL_WORK_LABELS: Record<CivilWork, string> = {
  grouting:     'Grouting',
  cable_entry:  'Cable Entry',
  foundation:   'Foundation',
  none:         'None',
};

/**
 * Re-rooted onto SurveyDcVoltage — the same three values, but now owned by the
 * type the checklist uses rather than by the legacy `dcVoltages` multi-select
 * that siteChecklist.acDcSupply.dcBreakerVoltageByLevel supersedes. One map
 * serves both the old shared picker and the new per-voltage-level one, so the
 * wording can't drift between them while both exist.
 */
export type DcVoltage = SurveyDcVoltage;

export const DC_VOLTAGE_LABELS: Record<SurveyDcVoltage, string> = {
  '110': '110V',
  '48':  '48V',
  '24':  '24V',
};

// ─── Section B — Pre-visit checklist ────────────────────────────────────────────

export const PRE_VISIT_LABELS: { key: keyof SurveyPreVisit; label: string }[] = [
  { key: 'inZonalPlanAndEngineerConfirmed', label: 'Site included in the zonal survey plan and MSETCL engineer confirmed' },
  { key: 'authorisationLetterCarried',      label: 'Authorisation / intimation letter to the substation carried' },
  { key: 'existingSldObtained',             label: 'Existing SLD / substation drawings obtained (if available)' },
  { key: 'toolsCarried',                    label: 'Tools carried: measuring tape/laser, camera, this checklist, tender BOQ, laptop' },
  { key: 'substationInchargeContactConfirmed', label: 'Substation in-charge contact confirmed' },
];

// ─── Section J — BOQ confirmation checklist ─────────────────────────────────────

export const BOQ_CHECK_LABELS: { key: keyof SurveyBoqChecks; label: string }[] = [
  {
    key: 'quantitiesCrossCheckedAgainstAnnexureI',
    label: 'Surveyed quantities cross-checked against tender Annexure-I; deviations noted with reason',
  },
  { key: 'markedUpSldAttached', label: 'Marked-up SLD / architecture attached' },
  {
    key: 'updatedInMsetclWebAppAndTracker',
    label: 'Survey data / progress updated in MSETCL web-application (if available) and our tracker',
  },
];
