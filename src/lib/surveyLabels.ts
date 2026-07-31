import type {
  BayType, DeviceType, DeviceProtocol, SurveyDevice, SurveyCableRun,
  SurveyInfrastructure, SurveyPreVisit, SurveyBoqChecks,
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

// ─── Section C — Bays ────────────────────────────────────────────────────────────

export const BAY_TYPE_LABELS: Record<BayType, string> = {
  line:         'Line',
  transformer:  'Transformer',
  bus_coupler:  'Bus Coupler',
  bus_section:  'Bus Section',
  capacitor:    'Capacitor',
  reactor:      'Reactor',
};

// ─── Section D — Devices ─────────────────────────────────────────────────────────

export const DEVICE_TYPE_LABELS: Record<DeviceType, string> = {
  mfm:             'MFM',
  cmr:             'CMR',
  tpi:             'TPI',
  gps:             'GPS',
  numerical_relay: 'Numerical Relay',
  legacy_rtu:      'Legacy RTU',
};

export const PROTOCOL_LABELS: Record<DeviceProtocol, string> = {
  modbus:    'Modbus',
  iec_61850: 'IEC 61850',
  iec_103:   'IEC 103',
  serial:    'Serial',
  none:      'None',
};

export type Port = NonNullable<SurveyDevice['port']>;

export const PORT_LABELS: Record<Port, string> = {
  rs485:    'RS485',
  rs232:    'RS232',
  ethernet: 'Ethernet',
  other:    'Other',
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

export type DcVoltage = SurveyInfrastructure['dcVoltages'][number];

export const DC_VOLTAGE_LABELS: Record<DcVoltage, string> = {
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
