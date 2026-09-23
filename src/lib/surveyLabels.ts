import { LEGACY_COMBINED_VOLTAGE_LEVEL } from '@/types';
import type {
  DeviceProtocol, SurveyCableRun,
  SurveyBoqChecks,
  SurveyVoltageLevel, StoredVoltageLevel,
  SurveyDcVoltage, SurveyRelayType, SurveyCapacitorBank,
  TapPositionConnectionType, McbPoleType,
  CableLayingMethod, SldHandoverFormat, MaterialStorageLocation,
} from '@/types';

/**
 * Enum display labels and checklist wording for the survey form — the single
 * source of truth shared by the wizard step components (StepSiteVisit,
 * StepFeederList, StepRelayDetails, StepCapacitorBanks,
 * StepTransformerDetails, StepInfrastructure, StepCableRuns, StepBoq) and the
 * read-only SurveyPreview.tsx. No map may be defined in more than one of
 * those files — a preview whose wording differs from the form it's previewing
 * is a correctness problem on a document an MSETCL engineer signs.
 *
 * BOQ item names (SUPPLY_BOQ_MASTER/SERVICE_BOQ_MASTER in boqMaster.ts) and
 * photo slot names (SURVEY_PHOTO_SLOTS in surveyValidation.ts) are NOT here —
 * they already have their own shared homes.
 */

// ─── Shared across the rebuilt sections ─────────────────────────────────────────

/**
 * Nominal voltage, used by the Feeder List, CRP Relay Details, Transformer
 * Details, Capacitor Bank Details and the DC breaker picker — every one of
 * them offers the same seven options, so they share one map.
 *
 * 66 and 33 are SEPARATE entries: the combined bucket was split on supervisor
 * instruction (see LEGACY_COMBINED_VOLTAGE_LEVEL in src/types).
 */
export const VOLTAGE_LEVEL_LABELS: Record<SurveyVoltageLevel, string> = {
  '132': '132 kV',
  '110': '110 kV',
  '100': '100 kV',
  '66':  '66 kV',
  '33':  '33 kV',
  '22':  '22 kV',
  '11':  '11 kV',
};

/** How the pre-split combined value reads wherever it is shown back. */
export const LEGACY_COMBINED_VOLTAGE_LABEL = 'combined 66 / 33 kV';

/**
 * Renders any STORED level for display, including the legacy combined value.
 * Use this wherever the value came out of a document rather than out of a
 * picker — it is the one place that knows how to name '66_33'.
 */
export function storedVoltageLabel(level: StoredVoltageLevel): string {
  return level === LEGACY_COMBINED_VOLTAGE_LEVEL
    ? LEGACY_COMBINED_VOLTAGE_LABEL
    : VOLTAGE_LEVEL_LABELS[level];
}

/**
 * The asset-count grid's ROW labels. The columns are voltage levels, so the
 * per-level "Number of Bays on 132kV" strings BAY_COUNT_LABELS used to hold
 * no longer have a place to render — the grid states the level once per
 * column instead.
 */
export const ASSET_COUNT_ROW_LABELS = {
  baysByVoltage:           'Bays',
  busesByVoltage:          'Bus',
  capacitorBanksByVoltage: 'Capacitor Banks',
  transformersByVoltage:   'Transformers',
} as const;

export type AssetCountRowKey = keyof typeof ASSET_COUNT_ROW_LABELS;

/** Row order, matching the source document's own table. */
export const ASSET_COUNT_ROWS: readonly AssetCountRowKey[] = [
  'baysByVoltage', 'busesByVoltage', 'capacitorBanksByVoltage', 'transformersByVoltage',
];

// ─── CRP Relay Details ──────────────────────────────────────────────────────────
//
// BAY_TYPE_LABELS and DEVICE_TYPE_LABELS are GONE, along with the BayType and
// DeviceType unions they labelled. The Feeder List has no bay-type column and
// the relay table records a make/model plus a relay TYPE, so neither enum
// exists any more.

/** Reused by SurveyRelayEntry.protocol — still current. */
export const PROTOCOL_LABELS: Record<DeviceProtocol, string> = {
  modbus:    'Modbus',
  iec_61850: 'IEC 61850',
  iec_103:   'IEC 103',
  serial:    'Serial',
  none:      'None',
};

/** Spare-MCB pole type, ACDB and DCDB alike. */
export const MCB_POLE_TYPE_LABELS: Record<McbPoleType, string> = {
  single: 'Single Pole',
  double: 'Double Pole',
};

export const TAP_POSITION_CONNECTION_TYPE_LABELS: Record<TapPositionConnectionType, string> = {
  resistance: 'Resistance',
  lamp:       'Lamp',
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

// ─── Site infrastructure & checklist ─────────────────────────────────────────────
//
// CIVIL_WORK_LABELS and its CivilWork type are GONE. Their only consumers were
// StepInfrastructure and SurveyPreview, and both now render
// siteChecklist.outdoorCivilWorkStatus — free text with no enum to label. The
// `civilWork` field itself stays on SurveyInfrastructure, unused and
// deliberately not deleted, so stored documents keep their historical value.

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

// ─── Step 6 — Site Infrastructure & Checklist ─────────────────────────────────
//
// Wording follows the document's own rows. Where the document writes the
// options into the question itself ("trench/wall mounting", "Hard/Soft copy",
// "control room/store"), the option labels below are the expansion of exactly
// those words — nothing invented.

export const CABLE_LAYING_METHOD_LABELS: Record<CableLayingMethod, string> = {
  trench:       'Through trench',
  wall_mounted: 'Wall mounting',
};

export const SLD_HANDOVER_FORMAT_LABELS: Record<SldHandoverFormat, string> = {
  hard_copy:       'Hard copy',
  soft_copy:       'Soft copy',
  not_handed_over: 'Not handed over',
};

export const MATERIAL_STORAGE_LOCATION_LABELS: Record<MaterialStorageLocation, string> = {
  control_room: 'Control room',
  store:        'Store',
};
