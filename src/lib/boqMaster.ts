import { SURVEY_APPROVAL_STAGES, deriveStageOwnerUids } from '@/lib/approvalStages';
import {
  SURVEY_VOLTAGE_LEVELS,
  LEGACY_COMBINED_VOLTAGE_LEVEL,
} from '@/types';
import type {
  SurveyBoqLine,
  SurveyBoqChecks,
  SurveyReport,
  SurveyInfrastructure,
  SurveySignOff,
  ApprovalStageResult,
  SurveyContactDetails,
  SurveyControlRoom,
  SurveyAssetCounts,
  SurveyVoltageLevel,
  SurveySiteChecklist,
  SurveyAcdcMcbDetails,
  AcdcMcbBoardDetail,
  SurveyDcVoltage,
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
   * substation must not need an extra tap to read it).
   */
  guidance?:   string;
  /**
   * A required line must end up answered — either a quantity or an explicit
   * not-applicable + reason — before Submit. Drives validateBoq(); the
   * validator reads this flag rather than carrying its own item list.
   */
  required:    boolean;
  /**
   * Whether the "Existing & usable" column applies. True for the 12 supply
   * items (the official two-column table); false for service/ITC lines, where
   * "already on site" is meaningless — those record requiredToSupply only.
   */
  hasExistingUsable: boolean;
  /**
   * Whether `requiredToSupply` starts as an auto-derived suggestion, summed
   * from the per-feeder entries. True for MFM / CMR / F-RTU ONLY — every other
   * line is pure direct entry, because no other section of the checklist
   * contains anything to derive them from.
   *
   * Owned here rather than in boqDerivation.ts so the master stays the single
   * source of truth for what each item IS, and so seeding a blank survey does
   * not depend on the derivation module Phase 2 rewrites.
   */
  autoDerived: boolean;
  /**
   * Sums this per-feeder field into requiredToSupply. Set only where
   * autoDerived is true; names a numeric field on SurveyFeederEntry.
   */
  derivedFromFeederField?: 'mfmRequired' | 'cmrRequired' | 'frtuModulesRequired';
  /**
   * COUNTS the transformers whose named boolean is true into requiredToSupply
   * — a different operation from derivedFromFeederField's sum, and over a
   * different array, which is why it is a separate field rather than a
   * widened union. Exactly one of the two may be set on an item.
   */
  derivedFromTransformerFlag?: 'tptRequired';
}

// ---- Supply Part: the official two-column BOQ table (12 items) --------------
//
// Twelve items, each with "Existing & usable" and "Required (to supply)".
//
// CHANGES from the previous 13-item table, all deliberate:
//   - "RTU & FRTU Configuration tool license" is DROPPED. It is a
//     project-level item, not a per-site one, and has no meaningful
//     "existing & usable" value — a cell that could never be filled. If it
//     must still be recorded, its natural home is a single field on the site
//     checklist, not a row in this table. Flagged in the Phase 1 report.
//   - GPS item renamed to "GPS clock + antenna".
//   - CAT6 and power cable are measured in METRES, not km. No conversion.
//   - MFM (not MFT) throughout — see the note on SurveyFeederEntry.

export const SUPPLY_BOQ_MASTER: readonly BoqMasterItem[] = [
  { sr: 1,  itemKey: 'rtu',                   item: 'Remote Terminal Unit (RTU)',                 unit: 'Nos.', required: true, hasExistingUsable: true, autoDerived: false,
    guidance: 'Confirm 1 Station RTU required (as per approved architecture); note any existing RTU/SCADA to reuse or replace.' },
  { sr: 2,  itemKey: 'router',                item: 'Router',                                     unit: 'Nos.', required: true, hasExistingUsable: true, autoDerived: false,
    guidance: 'Confirm 1 per S/S; check existing router/communication availability at site.' },
  { sr: 3,  itemKey: 'gpsClock',              item: 'GPS clock + antenna',                        unit: 'Nos.', required: true, hasExistingUsable: true, autoDerived: false,
    guidance: 'Confirm 1 per S/S; check if a suitable existing GPS can be integrated.' },
  { sr: 4,  itemKey: 'ethSwitch10Port',       item: 'Managed Ethernet Switch (10 port)',          unit: 'Nos.', required: true, hasExistingUsable: true, autoDerived: false,
    guidance: 'Count required from panel/architecture and number of devices needing ports.' },
  { sr: 5,  itemKey: 'ethSwitch16Port',       item: 'Managed Ethernet Switch (16 port)',          unit: 'Nos.', required: true, hasExistingUsable: true, autoDerived: false,
    guidance: 'Count from total IED/device port demand at the station.' },
  { sr: 6,  itemKey: 'networkingPanel',       item: 'Networking Panel',                           unit: 'Nos.', required: true, hasExistingUsable: true, autoDerived: false,
    guidance: 'Confirm panel(s) required vs free space in existing panels; note new-panel need.' },

  // -- The three auto-derived lines (decision 3) --
  { sr: 7,  itemKey: 'frtuRemoteIo',          item: 'F-RTU / Remote IO Modules',                  unit: 'Nos.', required: true, hasExistingUsable: true, autoDerived: true,  derivedFromFeederField: 'frtuModulesRequired',
    guidance: 'Suggested from the Feeder List — sum of "F-RTU modules required" across all feeders. Adjust if needed.' },
  { sr: 8,  itemKey: 'mfm',                   item: 'Multi-Function Meter (MFM)',                 unit: 'Nos.', required: true, hasExistingUsable: true, autoDerived: true,  derivedFromFeederField: 'mfmRequired',
    guidance: 'Suggested from the Feeder List — sum of "MFM required" across all feeders. Adjust if needed.' },
  { sr: 9,  itemKey: 'cmrDinRail',            item: 'CMR DIN rail mount',                         unit: 'Nos.', required: true, hasExistingUsable: true, autoDerived: true,  derivedFromFeederField: 'cmrRequired',
    guidance: 'Suggested from the Feeder List — sum of "CMR required" across all feeders. Adjust if needed.' },

  // -- Cables: metres, no km conversion (decision 4) --
  { sr: 10, itemKey: 'cat6Cable',             item: 'CAT6 Ethernet Cable',                        unit: 'm',    required: true, hasExistingUsable: true, autoDerived: false, remarksHint: 'route notes',
    guidance: 'Measure total CAT6 route length in metres. A running total from the cable-run entries is offered as a suggestion.' },
  { sr: 11, itemKey: 'powerSupplyCable',      item: 'Power Supply cable (2C, Cu, Ar, 2.5 sq.mm)', unit: 'm',    required: true, hasExistingUsable: true, autoDerived: false, remarksHint: 'route notes',
    guidance: 'Measure DC/AC supply cable route length in metres. A running total from the cable-run entries is offered as a suggestion.' },

  // Derived from a different array than the three above: Transformer Details,
  // not the Feeder List. Its source only started existing in Phase 2c
  // (survey.transformers[].tptRequired) — before that this line had no
  // derivable input at all and was direct entry.
  { sr: 12, itemKey: 'tapPositionTransducer', item: 'Transformer Tap position transducer',        unit: 'Nos.', required: true, hasExistingUsable: true, autoDerived: true, derivedFromTransformerFlag: 'tptRequired',
    guidance: 'Suggested from Transformer Details — the number of transformers marked "Tap Position Transducer (TPT) required". Adjust if needed.' },
] as const;

// ---- Service Part (6 items) -------------------------------------------------
// Not part of the official two-column table: these are installation/testing/
// commissioning and laying lines, so hasExistingUsable is false — only
// requiredToSupply applies. Retained unchanged pending a Phase 2 decision on
// whether the service table survives the rebuild at all (see the report).

/**
 * RETAINED BUT NO LONGER PART OF THE SURVEY.
 *
 * The service/ITC table was removed from the survey form on supervisor
 * instruction. This constant is deliberately kept for a possible future export
 * feature — it is real tender Annexure-I content — but nothing in the form,
 * the preview or validation reads it any more. `boqService` lines are still
 * seeded onto new surveys below so the stored shape is unchanged; they simply
 * stay empty.
 */
export const SERVICE_BOQ_MASTER: readonly BoqMasterItem[] = [
  { sr: 1, itemKey: 'substationSurvey',            item: 'Substation Survey',                                        unit: 'Nos.', required: true, hasExistingUsable: false, autoDerived: false },
  { sr: 2, itemKey: 'itcNetworkingPanel',          item: 'ITC of networking panel with RTU, GPS & associated items', unit: 'Nos.', required: true, hasExistingUsable: false, autoDerived: false },
  { sr: 3, itemKey: 'itcRemoteIoFrtu',             item: 'ITC of Remote IO Module / FRTU in panel',                  unit: 'Nos.', required: true, hasExistingUsable: false, autoDerived: false },
  { sr: 4, itemKey: 'itcMfm',                      item: 'ITC of MFM',                                               unit: 'Nos.', required: true, hasExistingUsable: false, autoDerived: false },
  { sr: 5, itemKey: 'powerCableLayingTermination', item: 'Power supply cable laying & termination',                  unit: 'm',    required: true, hasExistingUsable: false, autoDerived: false },
  { sr: 6, itemKey: 'cat6CableLayingTermination',  item: 'CAT6 Ethernet Cable laying & termination',                 unit: 'm',    required: true, hasExistingUsable: false, autoDerived: false },
] as const;

/** The supply lines whose requiredToSupply is auto-derived from the Feeder List. */
export const BOQ_DERIVED_ITEMS: readonly BoqMasterItem[] =
  SUPPLY_BOQ_MASTER.filter((m) => m.autoDerived);

// ─── Factories ──────────────────────────────────────────────────────────────────

/**
 * Seeds a blank pair of BOQ line arrays from the master — one line per master
 * item, both quantity columns unset.
 *
 * `autoDerived` comes from the master item itself (MFM / CMR / F-RTU only),
 * not from boqDerivation: the flag means "requiredToSupply is still a
 * suggestion", so those lines fill themselves from the Feeder List and keep
 * tracking it until the surveyor edits one. Every other line starts false and
 * is never touched by a recompute.
 */
export function createEmptyBoqLines(): { boqSupply: SurveyBoqLine[]; boqService: SurveyBoqLine[] } {
  const toLine = (m: BoqMasterItem): SurveyBoqLine => ({
    sr:               m.sr,
    itemKey:          m.itemKey,
    existingUsable:   null,
    requiredToSupply: null,
    remarks:          null,
    notApplicable:    false,
    autoDerived:      m.autoDerived,
  });

  return {
    boqSupply:  SUPPLY_BOQ_MASTER.map(toLine),
    boqService: SERVICE_BOQ_MASTER.map(toLine),
  };
}

/**
 * Per-voltage-level record with every level unanswered. Built from
 * SURVEY_VOLTAGE_LEVELS so adding a level needs no change here.
 */
function emptyByVoltage<K extends string, T>(levels: readonly K[]): Record<K, T | null> {
  return Object.fromEntries(levels.map((lvl) => [lvl, null])) as Record<K, T | null>;
}

// Both records include the LEGACY key, seeded null. A new survey never has a
// pre-split answer, but keeping the key present makes the record total — so
// every read site can index it without an undefined check.
const BAY_COUNT_KEYS = [...SURVEY_VOLTAGE_LEVELS, LEGACY_COMBINED_VOLTAGE_LEVEL] as const;
const DC_BREAKER_KEYS = [...SURVEY_VOLTAGE_LEVELS, LEGACY_COMBINED_VOLTAGE_LEVEL] as const;

function createEmptyContactDetails(): SurveyContactDetails {
  return {
    substationInchargeName:          null,
    substationInchargePhone:         null,
    substationLandline:              null,
    substationVoip:                  null,
    shiftOperatorContacts:           null,
    address:                         null,
    circle:                          null,
    division:                        null,
    commissionedDate:                null,
    nearestRailwayStationOrLandmark: null,
  };
}

function createEmptyControlRoom(): SurveyControlRoom {
  return {
    layoutNotes:                           null,
    roomTemperature:                       null,
    acAvailable:                           null,
    acCondition:                           null,
    mountingStructureOrRtuPanelDimensions: null,
    cableTrenchAvailable:                  null,
    cableTrenchLengthM:                    null,
    trenchExtensionNeeded:                 null,
  };
}

/** Counts start null, never 0 — see the null-vs-zero note in src/types. */
function createEmptyAssetCounts(): SurveyAssetCounts {
  return {
    baysByVoltage:           emptyByVoltage<typeof BAY_COUNT_KEYS[number], number>(BAY_COUNT_KEYS),
    busesByVoltage:          emptyByVoltage<SurveyVoltageLevel, number>(SURVEY_VOLTAGE_LEVELS),
    capacitorBanksByVoltage: emptyByVoltage<SurveyVoltageLevel, number>(SURVEY_VOLTAGE_LEVELS),
    transformersByVoltage:   emptyByVoltage<SurveyVoltageLevel, number>(SURVEY_VOLTAGE_LEVELS),
    // Superseded flat totals — seeded null so the stored shape stays total.
    transformerCount:   null,
    busCount:           null,
    capacitorBankCount: null,
  };
}

/**
 * Both boards seeded at full length. A fixed count, not a repeatable-group
 * default: the rows exist whether or not anyone fills them, exactly as they do
 * on the paper form.
 */
function createEmptyBoardDetail(): AcdcMcbBoardDetail {
  return {
    spareMcbCount:   null,
    spareMcbPole:    null,
    spareMcbRating:  null,
    spareMcbRemarks: null,
    mcbUtilisedForNetworkPanel: null,
    utilisedMcbPole:    null,
    utilisedMcbRating:  null,
    utilisedMcbRemarks: null,
  };
}

function createEmptyAcdcMcbDetails(): SurveyAcdcMcbDetails {
  return {
    acdb: createEmptyBoardDetail(),
    dcdb: createEmptyBoardDetail(),
    dcdbChargerOutputVoltage: null,
    dcdbBatteryOutputVoltage: null,
    // Superseded fixed-slot arrays — seeded empty, never populated again.
    acdbMcbSlots: [],
    dcdbMcbSlots: [],
  };
}

function createEmptySiteChecklist(): SurveySiteChecklist {
  return {
    outdoorCivilWorkStatus: null,
    communication: {
      distanceToProposedRtuLocationM: null,
      channelType:                    null,
      channelMake:                    null,
      cableRouteExists:               null,
    },
    acDcSupply: {
      ac230vAvailable:         null,
      dcBreakerVoltageByLevel: emptyByVoltage<typeof DC_BREAKER_KEYS[number], SurveyDcVoltage>(DC_BREAKER_KEYS),
      distanceToAcdbM:         null,
      distanceToDcdbM:         null,
    },
    sld: {
      sldDrawnAndConfirmed:        null,
      allEquipmentTypesShownOnSld: null,
    },
    earthing: {
      matExtendedToControlRoom: null,
      matIntact:                null,
    },
    lightningProtectionToControlRoom: null,
    storage: {
      siteAccessAvailable:             null,
      storageSpaceForRtuPanel:         null,
      spaceForUnloading:               null,
      installSpaceForFrtuSwitchMfmCmr: null,
    },
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
    // A freshly-created survey has never been reviewed, so the chain starts
    // travelling the only way it can.
    reviewDirection: 'forward',

    surveyDate:   null,
    location:     null,
    surveyorName: null,

    contactDetails: createEmptyContactDetails(),
    controlRoom:    createEmptyControlRoom(),
    assetCounts:    createEmptyAssetCounts(),

    feeders:        [],
    relays:         [],
    transformers:   [],
    capacitorBanks: [],

    cableRuns:          [],
    difficultRunsNotes: null,
    siteChecklist:      createEmptySiteChecklist(),
    acdcMcbDetails:     createEmptyAcdcMcbDetails(),
    infrastructure:     createEmptyInfrastructure(),
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
