import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '@/firebase/config';
import { DERIVED_ITEM_KEYS } from '@/lib/boqDerivation';
import { SURVEY_APPROVAL_STAGES, findApprovalStage } from '@/lib/approvalStages';
import {
  SURVEY_VOLTAGE_LEVELS,
  LEGACY_COMBINED_VOLTAGE_LEVEL,
} from '@/types';
import type {
  SurveyReport, SurveyFeederEntry, SurveyRelayEntry,
  SurveyTransformerEntry, SurveyCapacitorBank, SurveyCableRun, SurveyBoqLine,
  SurveyBoqChecks, SurveyContactDetails, SurveyControlRoom, SurveyAssetCounts,
  SurveySiteChecklist, SurveyAcdcMcbDetails, AcdcMcbBoardDetail, McbSlot,
  SurveyDcVoltage, SurveyVoltageLevel,
  ApprovalStageResult, WorkOrderStatus,
} from '@/types';

// ─── Mapper ─────────────────────────────────────────────────────────────────────

/**
 * Reads a date from EITHER a Firestore Timestamp or a real Date.
 *
 * The Date branch is what lets mapSurveyReport double as the normaliser for a
 * locally-restored draft: IndexedDB structured-clone preserves Date objects,
 * which have no .toDate(), so a Timestamp-only read would silently null every
 * date on a restored draft.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toDate(value: any): Date | null {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate();
  return value instanceof Date ? value : null;
}

// Field-by-field defaults (not a whole-element pass-through) so a feeder/relay/
// cable-run written before a field existed — or one whose value was never
// answered — loads as null rather than undefined. null must stay
// distinguishable from a real answer (including 0) since this becomes a
// jointly-signed BOQ for government vetting.
//
// This matters more than usual right now: the survey shape was rebuilt against
// the official MSETCL checklist, so EVERY stored document predates most of
// these fields. Each one must read as unanswered, not crash the reader.

/**
 * Fills a per-voltage-level record from a stored map, defaulting every level
 * to null. Built from SURVEY_VOLTAGE_LEVELS so a document written when the
 * level list was shorter still yields a complete record, and an unknown level
 * left over from an older list is dropped rather than widening the type.
 */
function mapByVoltage<K extends string, T>(
  levels: readonly K[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  raw: Record<string, any> | undefined,
): Record<K, T | null> {
  return Object.fromEntries(
    levels.map((level) => [level, raw?.[level] ?? null]),
  ) as Record<K, T | null>;
}

// The key lists the two per-level records are built from. Each carries the
// LEGACY key so a pre-split answer survives the read and can be shown back —
// dropping it here is what would make those answers vanish.
// Bays keep the legacy combined key; the three newer records never had one.
const BAY_COUNT_KEYS = [...SURVEY_VOLTAGE_LEVELS, LEGACY_COMBINED_VOLTAGE_LEVEL] as const;
const DC_BREAKER_KEYS = [...SURVEY_VOLTAGE_LEVELS, LEGACY_COMBINED_VOLTAGE_LEVEL] as const;

/**
 * The SUPERSEDED fixed-slot array, read back as stored.
 *
 * No longer padded to a fixed length — nothing renders it as a table any more.
 * It is read only so a pre-change answer can be detected and shown back, so
 * what matters is preserving exactly what is there, not a tidy shape.
 */
function mapLegacyMcbSlots(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  raw: any[] | undefined,
): McbSlot[] {
  if (!Array.isArray(raw)) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return raw.map((slot: Record<string, any>) => ({
    poleType: slot?.['poleType'] ?? null,
    ratingA:  slot?.['ratingA']  ?? null,
  }));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapBoardDetail(raw: Record<string, any> | undefined): AcdcMcbBoardDetail {
  return {
    spareMcbCount:   raw?.['spareMcbCount']   ?? null,
    spareMcbPole:    raw?.['spareMcbPole']    ?? null,
    spareMcbRating:  raw?.['spareMcbRating']  ?? null,
    spareMcbRemarks: raw?.['spareMcbRemarks'] ?? null,
    mcbUtilisedForNetworkPanel: raw?.['mcbUtilisedForNetworkPanel'] ?? null,
    utilisedMcbPole:    raw?.['utilisedMcbPole']    ?? null,
    utilisedMcbRating:  raw?.['utilisedMcbRating']  ?? null,
    utilisedMcbRemarks: raw?.['utilisedMcbRemarks'] ?? null,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapAcdcMcbDetails(raw: Record<string, any> | undefined): SurveyAcdcMcbDetails {
  return {
    acdb: mapBoardDetail(raw?.['acdb']),
    dcdb: mapBoardDetail(raw?.['dcdb']),
    dcdbChargerOutputVoltage: raw?.['dcdbChargerOutputVoltage'] ?? null,
    dcdbBatteryOutputVoltage: raw?.['dcdbBatteryOutputVoltage'] ?? null,
    // Superseded, read only so it can be surfaced for manual re-entry.
    acdbMcbSlots: mapLegacyMcbSlots(raw?.['acdbMcbSlots']),
    dcdbMcbSlots: mapLegacyMcbSlots(raw?.['dcdbMcbSlots']),
  };
}

/**
 * One Feeder List row. Replaces mapBay — deliberately NOT a migration of it:
 * the old `bays` array shares only `uid`/`remarks`/`photos` with this shape,
 * and its DI/DO/AI point counts have no home here now that the F-RTU/MFM/CMR
 * counts are entered directly. A legacy document's `bays` are not read, so
 * they surface as an empty Feeder List rather than as half-populated rows
 * nobody can trust. See the Phase 1 report on wiping test surveys.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapFeeder(raw: Record<string, any>): SurveyFeederEntry {
  return {
    uid:                            raw['uid'],
    bayName:                        raw['bayName']                        ?? '',
    nominalVoltage:                 raw['nominalVoltage']                 ?? null,
    feederOrTransformerDescription: raw['feederOrTransformerDescription'] ?? null,
    cableTrenchLengthM:             raw['cableTrenchLengthM']             ?? null,
    panelSpaceAvailable:            raw['panelSpaceAvailable']            ?? null,
    existingMfmAvailable:           raw['existingMfmAvailable']           ?? null,
    existingMfmWorking:             raw['existingMfmWorking']             ?? null,
    // Superseded combined field — read only, so an old answer can be shown
    // back. Deliberately NOT used as a fallback for the two above: a combined
    // answer cannot be split without guessing.
    existingMfmAvailableWorking:    raw['existingMfmAvailableWorking']    ?? null,
    existingMfmRs485Available:      raw['existingMfmRs485Available']      ?? null,
    existingMfmRs485Working:        raw['existingMfmRs485Working']        ?? null,
    frtuSpaceAvailable:             raw['frtuSpaceAvailable']             ?? null,
    cat6LengthFrtuToBaySwitchM:     raw['cat6LengthFrtuToBaySwitchM']     ?? null,
    cmrSpaceAvailable:              raw['cmrSpaceAvailable']              ?? null,
    mfmRequired:                    raw['mfmRequired']                    ?? null,
    cmrRequired:                    raw['cmrRequired']                    ?? null,
    ctPtRatio:                      raw['ctPtRatio']                      ?? null,
    shutdownRequired:               raw['shutdownRequired']               ?? null,
    diStatusPoints:                 raw['diStatusPoints']                 ?? null,
    frtuModulesRequired:            raw['frtuModulesRequired']            ?? null,
    remarks:                        raw['remarks']                        ?? null,
    photos:                         raw['photos']                         ?? [],
  };
}

/**
 * One CRP Relay Details row. Replaces mapDevice, and likewise does not migrate
 * from it.
 *
 * `optical` is free text, not a boolean — unconfirmed against the source
 * document and lossless either way (see the Phase 1 report).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapRelay(raw: Record<string, any>): SurveyRelayEntry {
  return {
    uid:            raw['uid'],
    bayName:        raw['bayName']        ?? '',
    nominalVoltage: raw['nominalVoltage'] ?? null,
    relayMakeModel: raw['relayMakeModel'] ?? null,
    relayType:      raw['relayType']      ?? null,
    protocol:       raw['protocol']       ?? null,
    ipAddress:      raw['ipAddress']      ?? null,
    optical:        raw['optical']        ?? null,
    ctRatio:        raw['ctRatio']        ?? null,
    remarks:        raw['remarks']        ?? null,
    photos:         raw['photos']         ?? [],
  };
}

/**
 * One Transformer Details row. Nameplate/designation values stay TEXT so
 * "50/63 MVA" and "+9/-9" survive transcription intact.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapTransformer(raw: Record<string, any>): SurveyTransformerEntry {
  return {
    uid:                         raw['uid'],
    transformerNumber:           raw['transformerNumber']           ?? '',
    voltageLevel:                raw['voltageLevel']                ?? null,
    mvaRating:                   raw['mvaRating']                   ?? null,
    rtccHighStep:                raw['rtccHighStep']                ?? null,
    rtccLowStep:                 raw['rtccLowStep']                 ?? null,
    tapPositionConnectionType:   raw['tapPositionConnectionType']   ?? null,
    rtccPanelWorking:            raw['rtccPanelWorking']            ?? null,
    // TPI -> TPT is a pure rename of the same physical thing, so an old answer
    // carries forward transparently. Only the new key is ever written.
    existingTptWorking:          raw['existingTptWorking'] ?? raw['existingTpiWorking'] ?? null,
    existingTpi4to20mAAvailable: raw['existingTpi4to20mAAvailable'] ?? null,
    tptRequired:                 raw['tptRequired']                 ?? null,
    requiredTptCount:            raw['requiredTptCount']            ?? null,
    remarks:                     raw['remarks']                     ?? null,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapCapacitorBank(raw: Record<string, any>): SurveyCapacitorBank {
  return {
    uid:           raw['uid'],
    bankNumber:    raw['bankNumber']    ?? '',
    voltageLevel:  raw['voltageLevel']  ?? null,
    numberOfBanks: raw['numberOfBanks'] ?? null,
    controlType:   raw['controlType']   ?? null,
    ratingPerBank: raw['ratingPerBank'] ?? null,
    workingStatus: raw['workingStatus'] ?? null,
    remarks:       raw['remarks']       ?? null,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapContactDetails(raw: Record<string, any> | undefined): SurveyContactDetails {
  return {
    substationInchargeName:          raw?.['substationInchargeName']          ?? null,
    substationInchargePhone:         raw?.['substationInchargePhone']         ?? null,
    substationLandline:              raw?.['substationLandline']              ?? null,
    substationVoip:                  raw?.['substationVoip']                  ?? null,
    substationContactNo:             raw?.['substationContactNo']             ?? null,
    email:                           raw?.['email']                           ?? null,
    shiftOperatorContacts:           raw?.['shiftOperatorContacts']           ?? null,
    address:                         raw?.['address']                         ?? null,
    pinCode:                         raw?.['pinCode']                         ?? null,
    zoneName:                        raw?.['zoneName']                        ?? null,
    // Superseded pair — read only, so an old answer can be shown back.
    // Deliberately NOT used as a fallback for either office below.
    circle:                          raw?.['circle']                          ?? null,
    division:                        raw?.['division']                        ?? null,
    omCircle:                        raw?.['omCircle']                        ?? null,
    omDivision:                      raw?.['omDivision']                      ?? null,
    omDivisionContactNo:             raw?.['omDivisionContactNo']             ?? null,
    pacCircle:                       raw?.['pacCircle']                       ?? null,
    pacDivision:                     raw?.['pacDivision']                     ?? null,
    pacDivisionContactNo:            raw?.['pacDivisionContactNo']            ?? null,
    commissionedDate:                toDate(raw?.['commissionedDate']),
    nearestRailwayStationOrLandmark: raw?.['nearestRailwayStationOrLandmark'] ?? null,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapControlRoom(raw: Record<string, any> | undefined): SurveyControlRoom {
  return {
    layoutNotes:                           raw?.['layoutNotes']                           ?? null,
    roomTemperature:                       raw?.['roomTemperature']                       ?? null,
    acAvailable:                           raw?.['acAvailable']                           ?? null,
    acCondition:                           raw?.['acCondition']                           ?? null,
    mountingStructureOrRtuPanelDimensions: raw?.['mountingStructureOrRtuPanelDimensions'] ?? null,
    cableTrenchAvailable:                  raw?.['cableTrenchAvailable']                  ?? null,
    cableTrenchLengthM:                    raw?.['cableTrenchLengthM']                    ?? null,
    trenchExtensionNeeded:                 raw?.['trenchExtensionNeeded']                 ?? null,
  };
}

/**
 * Asset counts. Replaces the two flat fields `surveyedTotalBays` and
 * `surveyedNumPowerTransformers`, which are NOT read forward: the new shape
 * counts bays per voltage level, and a single legacy total can't be split
 * across levels without inventing a distribution.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapAssetCounts(raw: Record<string, any> | undefined): SurveyAssetCounts {
  return {
    baysByVoltage:      mapByVoltage<typeof BAY_COUNT_KEYS[number], number>(BAY_COUNT_KEYS, raw?.['baysByVoltage']),
    busesByVoltage:          mapByVoltage<SurveyVoltageLevel, number>(SURVEY_VOLTAGE_LEVELS, raw?.['busesByVoltage']),
    capacitorBanksByVoltage: mapByVoltage<SurveyVoltageLevel, number>(SURVEY_VOLTAGE_LEVELS, raw?.['capacitorBanksByVoltage']),
    transformersByVoltage:   mapByVoltage<SurveyVoltageLevel, number>(SURVEY_VOLTAGE_LEVELS, raw?.['transformersByVoltage']),
    // Superseded flat totals, still read so an old answer can be shown back.
    transformerCount:   raw?.['transformerCount']   ?? null,
    busCount:           raw?.['busCount']           ?? null,
    capacitorBankCount: raw?.['capacitorBankCount'] ?? null,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapSiteChecklist(raw: Record<string, any> | undefined): SurveySiteChecklist {
  return {
    outdoorCivilWorkStatus: raw?.['outdoorCivilWorkStatus'] ?? null,
    communication: {
      distanceToProposedRtuLocationM: raw?.['communication']?.distanceToProposedRtuLocationM ?? null,
      channelType:                    raw?.['communication']?.channelType                    ?? null,
      channelMake:                    raw?.['communication']?.channelMake                    ?? null,
      cableRouteExists:               raw?.['communication']?.cableRouteExists               ?? null,
    },
    acDcSupply: {
      ac230vAvailable:         raw?.['acDcSupply']?.ac230vAvailable ?? null,
      dcBreakerVoltageByLevel: mapByVoltage<typeof DC_BREAKER_KEYS[number], SurveyDcVoltage>(
        DC_BREAKER_KEYS, raw?.['acDcSupply']?.dcBreakerVoltageByLevel),
      distanceToAcdbM:         raw?.['acDcSupply']?.distanceToAcdbM ?? null,
      distanceToDcdbM:         raw?.['acDcSupply']?.distanceToDcdbM ?? null,
    },
    sld: {
      sldDrawnAndConfirmed:        raw?.['sld']?.sldDrawnAndConfirmed        ?? null,
      allEquipmentTypesShownOnSld: raw?.['sld']?.allEquipmentTypesShownOnSld ?? null,
    },
    earthing: {
      matExtendedToControlRoom: raw?.['earthing']?.matExtendedToControlRoom ?? null,
      matIntact:                raw?.['earthing']?.matIntact                ?? null,
    },
    lightningProtectionToControlRoom: raw?.['lightningProtectionToControlRoom'] ?? null,
    storage: {
      siteAccessAvailable:             raw?.['storage']?.siteAccessAvailable             ?? null,
      storageSpaceForRtuPanel:         raw?.['storage']?.storageSpaceForRtuPanel         ?? null,
      spaceForUnloading:               raw?.['storage']?.spaceForUnloading               ?? null,
      installSpaceForFrtuSwitchMfmCmr: raw?.['storage']?.installSpaceForFrtuSwitchMfmCmr ?? null,
    },
  };
}

/**
 * BOQ lines written before `notApplicable`/`autoDerived` existed have neither
 * field. `notApplicable` is simply false (nobody could have ticked it yet).
 *
 * The single `surveyedQty` column became two. A legacy value is read forward
 * into `requiredToSupply`, which is what it always meant — the quantity that
 * governs supply at the site. `existingUsable` stays null: nobody was ever
 * asked that question, and 0 would assert that nothing usable is on site.
 *
 * `autoDerived` has to be inferred: a legacy line already carrying a quantity
 * must be treated as MANUAL, or entering the BOQ step would silently overwrite
 * a number a surveyor typed by hand. Only a blank derivable line is handed to
 * the auto-derivation.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapBoqLine(raw: Record<string, any>): SurveyBoqLine {
  const requiredToSupply = raw['requiredToSupply'] ?? raw['surveyedQty'] ?? null;
  return {
    sr:               raw['sr'],
    itemKey:          raw['itemKey'],
    existingUsable:   raw['existingUsable'] ?? null,
    requiredToSupply,
    remarks:          raw['remarks'] ?? null,
    notApplicable:    raw['notApplicable'] ?? false,
    autoDerived:      raw['autoDerived']
      ?? (DERIVED_ITEM_KEYS.has(raw['itemKey']) && requiredToSupply === null),
  };
}

/**
 * Rebuilds the approval chain for a document written BEFORE the chain existed:
 * a full-length pending chain whose stage 0 is owned by the document's single
 * legacy approver. Callers can then rely on
 * `approvalStages.length === SURVEY_APPROVAL_STAGES.length` unconditionally
 * instead of guarding every read, and a legacy survey reads as "waiting on its
 * one approver at stage 1" — which is exactly what it is.
 */
function legacyApprovalStages(
  approverUid:  string | null,
  approverName: string | null,
): ApprovalStageResult[] {
  return SURVEY_APPROVAL_STAGES.map((stage, i) => ({
    stageKey:      stage.key,
    stageLabel:    stage.label,
    status:        'pending' as const,
    ownerUid:      i === 0 ? approverUid  : null,
    ownerName:     i === 0 ? approverName : null,
    reviewNotes:   null,
    attachmentUrl: null,
    actedAt:       null,
  }));
}

/**
 * One approval-stage entry. `stageLabel` falls back to this build's label for
 * the same key, then to the raw key, so a document written under a different
 * stage array still renders something meaningful rather than blank.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapApprovalStage(raw: Record<string, any>, index: number): ApprovalStageResult {
  const stageKey = raw['stageKey'] ?? SURVEY_APPROVAL_STAGES[index]?.key ?? '';
  return {
    stageKey,
    stageLabel:    raw['stageLabel'] ?? findApprovalStage(stageKey)?.label ?? stageKey,
    status:        (raw['status'] ?? 'pending') as ApprovalStageResult['status'],
    ownerUid:      raw['ownerUid']      ?? null,
    ownerName:     raw['ownerName']     ?? null,
    reviewNotes:   raw['reviewNotes']   ?? null,
    attachmentUrl: raw['attachmentUrl'] ?? null,
    actedAt:       toDate(raw['actedAt']),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapCableRun(raw: Record<string, any>): SurveyCableRun {
  return {
    uid:       raw['uid'],
    cableType: raw['cableType'] ?? null,
    fromTo:    raw['fromTo']    ?? '',
    lengthM:   raw['lengthM']   ?? null,
    trays:     raw['trays']     ?? null,
  };
}

// Exported for reuse by useSurveyApprovalQueue.ts / useReviewedSurveys.ts —
// every listener that reads surveyReports documents must map them identically.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapSurveyReport(id: string, data: Record<string, any>): SurveyReport {
  return {
    id,
    workOrderId:    data['workOrderId']    ?? '',
    workOrderCode:  data['workOrderCode']  ?? '',
    siteId:         data['siteId']         ?? '',
    siteCode:       data['siteCode']       ?? '',
    siteName:       data['siteName']       ?? '',
    sapCode:        data['sapCode']        ?? null,
    zone:           data['zone']           ?? null,
    voltageClass:   data['voltageClass']   ?? null,

    assignedTo:     data['assignedTo']     ?? null,
    assignedToName: data['assignedToName'] ?? null,
    approverUid:    data['approverUid']    ?? null,
    approverName:   data['approverName']   ?? null,

    approvalStages: Array.isArray(data['approvalStages']) && data['approvalStages'].length > 0
      ? data['approvalStages'].map(mapApprovalStage)
      : legacyApprovalStages(data['approverUid'] ?? null, data['approverName'] ?? null),
    currentStageIndex: data['currentStageIndex'] ?? 0,
    approvalStageOwnerUids: data['approvalStageOwnerUids']
      ?? (data['approverUid'] ? [data['approverUid']] : []),
    // Legacy documents predate the escalation cascade — they were written
    // when every review moved one way, which is exactly 'forward'.
    reviewDirection: data['reviewDirection'] ?? 'forward',

    surveyDate:     toDate(data['surveyDate']),
    location:       data['location']
      ? { lat: data['location'].latitude ?? data['location'].lat, lng: data['location'].longitude ?? data['location'].lng }
      : null,
    surveyorName:   data['surveyorName'] ?? null,

    contactDetails: mapContactDetails(data['contactDetails']),
    controlRoom:    mapControlRoom(data['controlRoom']),
    assetCounts:    mapAssetCounts(data['assetCounts']),

    feeders:        (data['feeders']        ?? []).map(mapFeeder),
    relays:         (data['relays']         ?? []).map(mapRelay),
    transformers:   (data['transformers']   ?? []).map(mapTransformer),
    capacitorBanks: (data['capacitorBanks'] ?? []).map(mapCapacitorBank),

    cableRuns:          (data['cableRuns'] ?? []).map(mapCableRun),
    difficultRunsNotes: data['difficultRunsNotes'] ?? null,
    siteChecklist:      mapSiteChecklist(data['siteChecklist']),
    acdcMcbDetails:     mapAcdcMcbDetails(data['acdcMcbDetails']),
    // Field-by-field defaults (not a whole-object fallback) so documents
    // written before Sections E/F gained panelSpaceMeasurement/dcdbLocation
    // still load with those two as null rather than undefined.
    infrastructure: {
      panelSpaceAvailable:   data['infrastructure']?.panelSpaceAvailable   ?? null,
      panelSpaceMeasurement: data['infrastructure']?.panelSpaceMeasurement ?? null,
      newPanelRequired:      data['infrastructure']?.newPanelRequired      ?? null,
      mountingNotes:         data['infrastructure']?.mountingNotes         ?? null,
      civilWork:             data['infrastructure']?.civilWork             ?? [],
      dcSupplyAvailable:     data['infrastructure']?.dcSupplyAvailable     ?? null,
      dcVoltages:            data['infrastructure']?.dcVoltages            ?? [],
      acSupplyAvailable:     data['infrastructure']?.acSupplyAvailable     ?? null,
      spareMcbs:             data['infrastructure']?.spareMcbs             ?? null,
      dcdbLocation:          data['infrastructure']?.dcdbLocation          ?? null,
      ofcAvailable:          data['infrastructure']?.ofcAvailable          ?? null,
      routerAvailable:       data['infrastructure']?.routerAvailable       ?? null,
      mplsAvailable:         data['infrastructure']?.mplsAvailable         ?? null,
      sldcPathNotes:         data['infrastructure']?.sldcPathNotes         ?? null,
      earthingAvailable:     data['infrastructure']?.earthingAvailable     ?? null,
    },
    boqSupply:      (data['boqSupply']  ?? []).map(mapBoqLine),
    boqService:     (data['boqService'] ?? []).map(mapBoqLine),
    boqChecks: {
      quantitiesCrossCheckedAgainstAnnexureI: data['boqChecks']?.quantitiesCrossCheckedAgainstAnnexureI ?? false,
      markedUpSldAttached:                    data['boqChecks']?.markedUpSldAttached                    ?? false,
      updatedInMsetclWebAppAndTracker:         data['boqChecks']?.updatedInMsetclWebAppAndTracker         ?? false,
    } as SurveyBoqChecks,
    // Defaulted per entry: a photo written before remarks existed has no
    // `remark`, and undefined inside an array element would reach Firestore.
    sitePhotos: (data['sitePhotos'] ?? []).map(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (p: Record<string, any>) => ({
        url:     p['url']     ?? '',
        caption: p['caption'] ?? '',
        remark:  p['remark']  ?? null,
      }),
    ),
    signOff:        data['signOff'] ?? {
      signedPagePhotos:          [],
      surveyorName:              null,
      msetclEngineerName:        null,
      msetclEngineerDesignation: null,
      msetclEngineerEmpId:       null,
      surveyorSignatureImage:    null,
      msetclSignatureImage:      null,
    },

    submittedBy:     data['submittedBy']     ?? null,
    submittedByName: data['submittedByName'] ?? null,
    submittedAt:     toDate(data['submittedAt']),
    status:          (data['status'] ?? 'open') as WorkOrderStatus,
    reviewNotes:     data['reviewNotes']     ?? null,
    reviewedBy:      data['reviewedBy']      ?? null,
    reviewedByName:  data['reviewedByName']  ?? null,
    reviewedAt:      toDate(data['reviewedAt']),
    createdAt:       toDate(data['createdAt']) ?? new Date(),
    updatedAt:       toDate(data['updatedAt']) ?? new Date(),
  };
}

/**
 * Merges a locally-restored draft over the server copy and runs the result
 * through the SAME field-defaulting a Firestore read gets.
 *
 * THIS IS THE FIX FOR A WHOLE CLASS OF CRASH, not one field. Drafts are stored
 * as a raw object in IndexedDB and restored with no defaulting at all, and the
 * merge is a SHALLOW spread — so a draft saved before a nested field existed
 * replaces its whole parent, and every field added since is simply absent.
 * `Object.values(undefined)` then throws, which is what took the wizard down
 * in production; quieter variants (a spread of undefined silently dropping
 * sibling values) are the same bug without the stack trace.
 *
 * Passing the merged object back through mapSurveyReport fixes all of them at
 * once: every field a fresh read would default, a restored draft now defaults
 * too. Any field added in future is covered automatically, with no new guard.
 */
export function normaliseRestoredDraft(
  serverSurvey: SurveyReport,
  draftData:    Partial<SurveyReport>,
): SurveyReport {
  return mapSurveyReport(serverSurvey.id, { ...serverSurvey, ...draftData });
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Real-time listener for the single SurveyReport belonging to a WorkOrder.
 *
 * The SurveyReport's doc ID is deterministically the same as its WorkOrder's
 * ID (see createWorkOrder in useWorkOrderActions.ts), so this reads it as a
 * single document rather than a where('workOrderId','==',...) query. A `list`
 * query is evaluated by Firestore against the query definition itself, not
 * the matched documents — a query on workOrderId can't be proven to satisfy
 * the deployed rule's assignedTo/approverUid condition, so it was rejected
 * outright. A single-doc read uses the `get` rule instead, which evaluates
 * against the real document and passes for the assigned engineer/approver.
 */
export function useSurveyReport(workOrderId: string | undefined) {
  const [survey,  setSurvey]  = useState<SurveyReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  useEffect(() => {
    if (!workOrderId) return;
    const id = workOrderId;

    function subscribe() {
      setLoading(true);
      setError(null);

      return onSnapshot(
        doc(db, 'surveyReports', id),
        (snap) => {
          setSurvey(snap.exists() ? mapSurveyReport(snap.id, snap.data()) : null);
          setLoading(false);
        },
        (err) => {
          console.error('[useSurveyReport] listener error:', err);
          setError(err.message);
          setLoading(false);
        },
      );
    }

    const unsubscribe = subscribe();

    return () => unsubscribe();
  }, [workOrderId]);

  if (!workOrderId) {
    return { survey: null, loading: false, error: null };
  }

  return { survey, loading, error };
}
