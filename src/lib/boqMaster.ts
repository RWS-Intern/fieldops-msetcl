import type {
  SurveyBoqLine,
  SurveyReport,
  SurveyInfrastructure,
  SurveySignOff,
} from '@/types';

/**
 * BOQ item master — MSETCL Substation Visibility Project, tender Annexure-I.
 * Item names and units below must match the tender exactly; `itemKey` is a
 * stable internal identifier (survey docs reference items by key, not by
 * array position, so re-ordering this master never breaks existing data).
 */
export interface BoqMasterItem {
  sr:          number;
  itemKey:     string;
  item:        string;
  unit:        string;
  /** Shown as placeholder guidance in the survey form — not a validation rule. */
  remarksHint?: string;
}

// ─── Supply Part (13 items) ────────────────────────────────────────────────────

export const SUPPLY_BOQ_MASTER: readonly BoqMasterItem[] = [
  { sr: 1,  itemKey: 'rtu',                     item: 'Remote Terminal Unit (RTU)',                                    unit: 'Nos.' },
  { sr: 2,  itemKey: 'router',                  item: 'Router',                                                        unit: 'Nos.' },
  { sr: 3,  itemKey: 'gpsClock',                item: 'GPS Time Synchronization Clock',                                unit: 'Nos.' },
  { sr: 4,  itemKey: 'ethSwitch10Port',         item: 'Managed Ethernet Switch (10 port)',                             unit: 'Nos.' },
  { sr: 5,  itemKey: 'ethSwitch16Port',         item: 'Managed Ethernet Switch (16 port)',                             unit: 'Nos.' },
  { sr: 6,  itemKey: 'networkingPanel',         item: 'Networking Panel',                                              unit: 'Nos.' },
  { sr: 7,  itemKey: 'frtuRemoteIo',            item: 'F-RTU / Remote IO Modules',                                     unit: 'Nos.' },
  { sr: 8,  itemKey: 'mfm',                     item: 'Multi-Function Meter (MFM)',                                    unit: 'Nos.' },
  { sr: 9,  itemKey: 'cat6Cable',               item: 'CAT6 Ethernet Cable',                                           unit: 'Km', remarksHint: 'length in m in remarks' },
  { sr: 10, itemKey: 'tapPositionTransducer',   item: 'Transformer Tap position transducer',                          unit: 'Nos.' },
  { sr: 11, itemKey: 'cmrDinRail',              item: 'CMR DIN rail mount',                                            unit: 'Nos.' },
  { sr: 12, itemKey: 'powerSupplyCable',        item: 'Power Supply cable (2C, Cu, Ar, 2.5 sq.mm)',                    unit: 'Km', remarksHint: 'length in m in remarks' },
  { sr: 13, itemKey: 'rtuFrtuConfigToolLicense', item: 'RTU & FRTU Configuration tool license',                        unit: 'Nos.', remarksHint: 'project-level, if applicable' },
] as const;

// ─── Service Part (6 items) ────────────────────────────────────────────────────

export const SERVICE_BOQ_MASTER: readonly BoqMasterItem[] = [
  { sr: 1, itemKey: 'substationSurvey',              item: 'Substation Survey',                                              unit: 'Nos.' },
  { sr: 2, itemKey: 'itcNetworkingPanel',            item: 'ITC of networking panel with RTU, GPS & associated items',       unit: 'Nos.' },
  { sr: 3, itemKey: 'itcRemoteIoFrtu',               item: 'ITC of Remote IO Module / FRTU in panel',                         unit: 'Nos.' },
  { sr: 4, itemKey: 'itcMfm',                        item: 'ITC of MFM',                                                      unit: 'Nos.' },
  { sr: 5, itemKey: 'powerCableLayingTermination',   item: 'Power supply cable laying & termination',                        unit: 'Km', remarksHint: 'length in m in remarks' },
  { sr: 6, itemKey: 'cat6CableLayingTermination',    item: 'CAT6 Ethernet Cable laying & termination',                        unit: 'Km', remarksHint: 'length in m in remarks' },
] as const;

// ─── Factories ──────────────────────────────────────────────────────────────────

/**
 * Seeds a blank pair of BOQ line arrays from the master — one line per master
 * item, `surveyedQty`/`remarks` unset. Call once per new SurveyReport draft.
 */
export function createEmptyBoqLines(): { boqSupply: SurveyBoqLine[]; boqService: SurveyBoqLine[] } {
  const toLine = (m: BoqMasterItem): SurveyBoqLine => ({
    sr:          m.sr,
    itemKey:     m.itemKey,
    surveyedQty: null,
    remarks:     null,
  });

  return {
    boqSupply:  SUPPLY_BOQ_MASTER.map(toLine),
    boqService: SERVICE_BOQ_MASTER.map(toLine),
  };
}

function createEmptyInfrastructure(): SurveyInfrastructure {
  return {
    panelSpaceAvailable: null,
    newPanelRequired:    null,
    mountingNotes:       null,
    civilWork:           [],
    dcSupplyAvailable:   null,
    dcVoltages:          [],
    acSupplyAvailable:   null,
    spareMcbs:           null,
    ofcAvailable:        null,
    routerAvailable:     null,
    mplsAvailable:       null,
    sldcPathNotes:       null,
    earthingAvailable:   null,
  };
}

function createEmptySignOff(): SurveySignOff {
  return {
    signedPagePhotos:          [],
    surveyorName:              null,
    msetclEngineerName:        null,
    msetclEngineerDesignation: null,
    msetclEngineerEmpId:       null,
    surveyorSignatureImage:    null,
    msetclSignatureImage:      null,
  };
}

export interface CreateEmptySurveyReportInput {
  workOrderId:   string;
  siteId:        string;
  siteCode:      string;
  sapCode?:      string | null;
  zone?:         string | null;
  voltageClass?: string | null;
  /** Denormalised from the parent WorkOrder — see the SurveyReport type comment. */
  assignedTo?:      string | null;
  assignedToName?:  string | null;
  approverUid?:     string | null;
  approverName?:    string | null;
}

/**
 * Builds a blank SurveyReport draft for a new WorkOrder. `id`/`createdAt`/
 * `updatedAt` are placeholders — the write path (task 2) assigns the real
 * Firestore doc ID and serverTimestamp() values at commit time.
 */
export function createEmptySurveyReport(input: CreateEmptySurveyReportInput): SurveyReport {
  const { boqSupply, boqService } = createEmptyBoqLines();
  const now = new Date();

  return {
    id:           '',
    workOrderId:  input.workOrderId,
    siteId:       input.siteId,
    siteCode:     input.siteCode,
    sapCode:      input.sapCode      ?? null,
    zone:         input.zone         ?? null,
    voltageClass: input.voltageClass ?? null,

    assignedTo:     input.assignedTo     ?? null,
    assignedToName: input.assignedToName ?? null,
    approverUid:    input.approverUid    ?? null,
    approverName:   input.approverName   ?? null,

    surveyDate: null,
    location:   null,

    bays:      [],
    devices:   [],
    cableRuns: [],
    infrastructure: createEmptyInfrastructure(),
    boqSupply,
    boqService,
    sitePhotos: [],
    signOff:    createEmptySignOff(),

    submittedBy:     null,
    submittedByName: null,
    submittedAt:     null,
    status:          'open',
    reviewNotes:     null,
    reviewedBy:      null,
    reviewedByName:  null,
    reviewedAt:      null,
    createdAt: now,
    updatedAt: now,
  };
}
