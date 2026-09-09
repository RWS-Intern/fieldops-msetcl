import { AUTO_DERIVED_ITEM_KEYS } from '@/lib/boqDerivation';
import { SURVEY_APPROVAL_STAGES, deriveStageOwnerUids } from '@/lib/approvalStages';
import type {
  SurveyBoqLine,
  SurveyBoqChecks,
  SurveyReport,
  SurveyInfrastructure,
  SurveySignOff,
  SurveyPreVisit,
  ApprovalStageResult,
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
  /**
   * Per-item survey guidance, shown as visible helper text beneath the inputs
   * (deliberately not tooltip-only — a surveyor working one-handed in a
   * substation must not need an extra tap to read it). Text is verbatim from
   * the tender-mapping review; do not paraphrase when editing.
   *
   * Service items carry none: each auto-mirrors its matching supply item
   * (see src/lib/boqDerivation.ts) and the guidance is implicit in that.
   */
  guidance?:   string;
  /**
   * A required line must end up with either a quantity or an explicit
   * not-applicable + reason before Submit. Drives validateBoq() — the
   * validator reads this flag rather than carrying its own item list.
   */
  required:    boolean;
}

// ─── Supply Part (13 items) ────────────────────────────────────────────────────

export const SUPPLY_BOQ_MASTER: readonly BoqMasterItem[] = [
  { sr: 1,  itemKey: 'rtu',                     item: 'Remote Terminal Unit (RTU)',                                    unit: 'Nos.', required: true,
    guidance: 'Confirm 1 Station RTU required (as per approved architecture); note any existing RTU/SCADA to reuse or replace.' },
  { sr: 2,  itemKey: 'router',                  item: 'Router',                                                        unit: 'Nos.', required: true,
    guidance: 'Confirm 1 per S/S; check existing router/communication availability at site.' },
  { sr: 3,  itemKey: 'gpsClock',                item: 'GPS Time Synchronization Clock',                                unit: 'Nos.', required: true,
    guidance: 'Confirm 1 per S/S; check if a suitable existing GPS can be integrated.' },
  { sr: 4,  itemKey: 'ethSwitch10Port',         item: 'Managed Ethernet Switch (10 port)',                             unit: 'Nos.', required: true,
    guidance: 'Count required from panel/architecture and number of devices needing ports.' },
  { sr: 5,  itemKey: 'ethSwitch16Port',         item: 'Managed Ethernet Switch (16 port)',                             unit: 'Nos.', required: true,
    guidance: 'Count from total IED/device port demand at the station.' },
  { sr: 6,  itemKey: 'networkingPanel',         item: 'Networking Panel',                                              unit: 'Nos.', required: true,
    guidance: 'Confirm panel(s) required vs free space in existing panels; note new-panel need.' },
  { sr: 7,  itemKey: 'frtuRemoteIo',            item: 'F-RTU / Remote IO Modules',                                     unit: 'Nos.', required: true,
    guidance: 'Derive from bay count and DI/DO/AI signal counts per bay (Section C of survey).' },
  { sr: 8,  itemKey: 'mfm',                     item: 'Multi-Function Meter (MFM)',                                    unit: 'Nos.', required: true,
    guidance: 'Count feeders/transformer bays needing metering; deduct suitable existing MFMs.' },
  { sr: 9,  itemKey: 'cat6Cable',               item: 'CAT6 Ethernet Cable',                                           unit: 'Km', remarksHint: 'length in m in remarks', required: true,
    guidance: 'Measure total CAT6 route length (record metres; 1 Km = 1000 m).' },
  { sr: 10, itemKey: 'tapPositionTransducer',   item: 'Transformer Tap position transducer',                          unit: 'Nos.', required: true,
    guidance: 'Count power transformers with an on-load tap changer.' },
  { sr: 11, itemKey: 'cmrDinRail',              item: 'CMR DIN rail mount',                                            unit: 'Nos.', required: true,
    guidance: 'Derive from status/control (DI/DO) points needing contact multiplication.' },
  { sr: 12, itemKey: 'powerSupplyCable',        item: 'Power Supply cable (2C, Cu, Ar, 2.5 sq.mm)',                    unit: 'Km', remarksHint: 'length in m in remarks', required: true,
    guidance: 'Measure DC/AC supply cable route length (record metres).' },
  // Not required — the mapping's own words: "Project-level item — usually 0 per site."
  { sr: 13, itemKey: 'rtuFrtuConfigToolLicense', item: 'RTU & FRTU Configuration tool license',                        unit: 'Nos.', remarksHint: 'project-level, if applicable', required: false,
    guidance: 'Project-level item — usually 0 per site; confirm only if a site-specific license is needed.' },
] as const;

// ─── Service Part (6 items) ────────────────────────────────────────────────────
// All required: each auto-derives from a required supply item (or is a flat 1),
// so all six are always fillable and should always be filled. No `guidance` —
// see the BoqMasterItem.guidance comment.

export const SERVICE_BOQ_MASTER: readonly BoqMasterItem[] = [
  { sr: 1, itemKey: 'substationSurvey',              item: 'Substation Survey',                                              unit: 'Nos.', required: true },
  { sr: 2, itemKey: 'itcNetworkingPanel',            item: 'ITC of networking panel with RTU, GPS & associated items',       unit: 'Nos.', required: true },
  { sr: 3, itemKey: 'itcRemoteIoFrtu',               item: 'ITC of Remote IO Module / FRTU in panel',                         unit: 'Nos.', required: true },
  { sr: 4, itemKey: 'itcMfm',                        item: 'ITC of MFM',                                                      unit: 'Nos.', required: true },
  { sr: 5, itemKey: 'powerCableLayingTermination',   item: 'Power supply cable laying & termination',                        unit: 'Km', remarksHint: 'length in m in remarks', required: true },
  { sr: 6, itemKey: 'cat6CableLayingTermination',    item: 'CAT6 Ethernet Cable laying & termination',                        unit: 'Km', remarksHint: 'length in m in remarks', required: true },
] as const;

// ─── Factories ──────────────────────────────────────────────────────────────────

/**
 * Seeds a blank pair of BOQ line arrays from the master — one line per master
 * item, `surveyedQty`/`remarks` unset. Call once per new SurveyReport draft.
 *
 * `autoDerived` starts true on exactly the lines boqDerivation computes: that
 * flag means "still under auto control", so those lines fill themselves on
 * entry to Section J and keep tracking their inputs until the surveyor edits
 * one. Every other line starts false and is never touched by a recompute.
 */
export function createEmptyBoqLines(): { boqSupply: SurveyBoqLine[]; boqService: SurveyBoqLine[] } {
  const toLine = (m: BoqMasterItem): SurveyBoqLine => ({
    sr:            m.sr,
    itemKey:       m.itemKey,
    surveyedQty:   null,
    remarks:       null,
    notApplicable: false,
    autoDerived:   AUTO_DERIVED_ITEM_KEYS.has(m.itemKey),
  });

  return {
    boqSupply:  SUPPLY_BOQ_MASTER.map(toLine),
    boqService: SERVICE_BOQ_MASTER.map(toLine),
  };
}

function createEmptyInfrastructure(): SurveyInfrastructure {
  return {
    panelSpaceAvailable:   null,
    panelSpaceMeasurement: null,
    newPanelRequired:      null,
    mountingNotes:         null,
    civilWork:             [],
    dcSupplyAvailable:     null,
    dcVoltages:            [],
    acSupplyAvailable:     null,
    spareMcbs:             null,
    dcdbLocation:          null,
    ofcAvailable:          null,
    routerAvailable:       null,
    mplsAvailable:         null,
    sldcPathNotes:         null,
    earthingAvailable:     null,
  };
}

function createEmptyPreVisit(): SurveyPreVisit {
  return {
    inZonalPlanAndEngineerConfirmed:     false,
    authorisationLetterCarried:          false,
    existingSldObtained:                 false,
    toolsCarried:                        false,
    substationInchargeContactConfirmed:  false,
  };
}

/**
 * Seeds the approval chain at full length with every stage pending. Owners are
 * null unless the caller supplies them — createWorkOrder always does, so a
 * real survey is created with its three owners already in place.
 */
export function createEmptyApprovalStages(): ApprovalStageResult[] {
  return SURVEY_APPROVAL_STAGES.map((stage) => ({
    stageKey:      stage.key,
    stageLabel:    stage.label,
    status:        'pending' as const,
    ownerUid:      null,
    ownerName:     null,
    reviewNotes:   null,
    attachmentUrl: null,
    actedAt:       null,
  }));
}

function createEmptyBoqChecks(): SurveyBoqChecks {
  return {
    quantitiesCrossCheckedAgainstAnnexureI: false,
    markedUpSldAttached:                    false,
    updatedInMsetclWebAppAndTracker:         false,
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
  /** See the SurveyReport type comment — denormalised for list-view display. */
  workOrderCode: string;
  siteId:        string;
  siteCode:      string;
  siteName:      string;
  sapCode?:      string | null;
  zone?:         string | null;
  voltageClass?: string | null;
  /** Denormalised from the parent WorkOrder — see the SurveyReport type comment. */
  assignedTo?:      string | null;
  assignedToName?:  string | null;
  approverUid?:     string | null;
  approverName?:    string | null;
  /**
   * The three-stage chain as chosen by the admin at creation. Omitted only by
   * callers that have no owners to hand (tests/fixtures), in which case the
   * chain is still seeded at full length with null owners so
   * `approvalStages.length === SURVEY_APPROVAL_STAGE_COUNT` holds from the
   * very first write.
   */
  approvalStages?:  ApprovalStageResult[];
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
    id:            '',
    workOrderId:   input.workOrderId,
    workOrderCode: input.workOrderCode,
    siteId:        input.siteId,
    siteCode:      input.siteCode,
    siteName:      input.siteName,
    sapCode:       input.sapCode      ?? null,
    zone:          input.zone         ?? null,
    voltageClass:  input.voltageClass ?? null,

    assignedTo:     input.assignedTo     ?? null,
    assignedToName: input.assignedToName ?? null,
    approverUid:    input.approverUid    ?? null,
    approverName:   input.approverName   ?? null,

    approvalStages: input.approvalStages ?? createEmptyApprovalStages(),
    // Stage 0 owns the document from creation: approverUid is already stage 0's
    // owner here (same as the single-approver version this replaces), so the
    // index that points at the live stage must agree with it from the start.
    currentStageIndex: 0,
    approvalStageOwnerUids: deriveStageOwnerUids(input.approvalStages ?? []),

    surveyDate:   null,
    location:     null,
    surveyorName: null,
    surveyedTotalBays:            null,
    surveyedNumPowerTransformers: null,
    preVisit: createEmptyPreVisit(),

    bays:               [],
    devices:            [],
    cableRuns:          [],
    difficultRunsNotes: null,
    infrastructure: createEmptyInfrastructure(),
    boqSupply,
    boqService,
    boqChecks:  createEmptyBoqChecks(),
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
