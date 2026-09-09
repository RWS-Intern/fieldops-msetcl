import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '@/firebase/config';
import { AUTO_DERIVED_ITEM_KEYS } from '@/lib/boqDerivation';
import { SURVEY_APPROVAL_STAGES, findApprovalStage } from '@/lib/approvalStages';
import type { SurveyReport, SurveyPreVisit, SurveyBay, SurveyDevice, SurveyCableRun, SurveyBoqLine, SurveyBoqChecks, ApprovalStageResult, WorkOrderStatus } from '@/types';

// ─── Mapper ─────────────────────────────────────────────────────────────────────

// Field-by-field defaults (not a whole-element pass-through) so a bay/device/
// cable-run written before a field existed — or one whose value was never
// answered — loads as null rather than undefined. null must stay
// distinguishable from a real answer (including 0) since this becomes a
// jointly-signed BOQ for government vetting.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapBay(raw: Record<string, any>): SurveyBay {
  return {
    uid:               raw['uid'],
    bayNumber:         raw['bayNumber']         ?? '',
    bayType:           raw['bayType']           ?? null,
    voltageLevel:      raw['voltageLevel']      ?? null,
    diPoints:          raw['diPoints']          ?? null,
    doPoints:          raw['doPoints']          ?? null,
    aiPoints:          raw['aiPoints']          ?? null,
    ctRatio:           raw['ctRatio']           ?? null,
    ptRatio:           raw['ptRatio']           ?? null,
    tapChangerPresent: raw['tapChangerPresent'] ?? null,
    tapPositions:      raw['tapPositions']      ?? null,
    photos:            raw['photos']            ?? [],
    remarks:           raw['remarks']           ?? null,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapDevice(raw: Record<string, any>): SurveyDevice {
  return {
    uid:        raw['uid'],
    deviceType: raw['deviceType'] ?? null,
    make:       raw['make']       ?? null,
    model:      raw['model']      ?? null,
    protocol:   raw['protocol']   ?? null,
    port:       raw['port']       ?? null,
    quantity:   raw['quantity']   ?? null,
    reusable:   raw['reusable']   ?? null,
    photos:     raw['photos']     ?? [],
    remarks:    raw['remarks']    ?? null,
  };
}

/**
 * BOQ lines written before `notApplicable`/`autoDerived` existed have neither
 * field. `notApplicable` is simply false (nobody could have ticked it yet).
 *
 * `autoDerived` has to be inferred: a legacy line already carrying a quantity
 * must be treated as MANUAL, or entering Section J would silently overwrite a
 * number a surveyor typed by hand. Only a blank derivable line is handed to
 * the auto-derivation.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapBoqLine(raw: Record<string, any>): SurveyBoqLine {
  const surveyedQty = raw['surveyedQty'] ?? null;
  return {
    sr:            raw['sr'],
    itemKey:       raw['itemKey'],
    surveyedQty,
    remarks:       raw['remarks'] ?? null,
    notApplicable: raw['notApplicable'] ?? false,
    autoDerived:   raw['autoDerived']
      ?? (AUTO_DERIVED_ITEM_KEYS.has(raw['itemKey']) && surveyedQty === null),
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
    actedAt:       raw['actedAt']?.toDate?.() ?? null,
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

    surveyDate:     data['surveyDate']?.toDate?.() ?? null,
    location:       data['location']
      ? { lat: data['location'].latitude ?? data['location'].lat, lng: data['location'].longitude ?? data['location'].lng }
      : null,
    surveyorName:                 data['surveyorName']                 ?? null,
    surveyedTotalBays:            data['surveyedTotalBays']            ?? null,
    surveyedNumPowerTransformers: data['surveyedNumPowerTransformers'] ?? null,
    preVisit: {
      inZonalPlanAndEngineerConfirmed:    data['preVisit']?.inZonalPlanAndEngineerConfirmed    ?? false,
      authorisationLetterCarried:         data['preVisit']?.authorisationLetterCarried         ?? false,
      existingSldObtained:                data['preVisit']?.existingSldObtained                ?? false,
      toolsCarried:                       data['preVisit']?.toolsCarried                        ?? false,
      substationInchargeContactConfirmed: data['preVisit']?.substationInchargeContactConfirmed  ?? false,
    } as SurveyPreVisit,

    bays:               (data['bays']      ?? []).map(mapBay),
    devices:            (data['devices']   ?? []).map(mapDevice),
    cableRuns:          (data['cableRuns'] ?? []).map(mapCableRun),
    difficultRunsNotes: data['difficultRunsNotes'] ?? null,
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
    sitePhotos:     data['sitePhotos'] ?? [],
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
    submittedAt:     data['submittedAt']?.toDate?.() ?? null,
    status:          (data['status'] ?? 'open') as WorkOrderStatus,
    reviewNotes:     data['reviewNotes']     ?? null,
    reviewedBy:      data['reviewedBy']      ?? null,
    reviewedByName:  data['reviewedByName']  ?? null,
    reviewedAt:      data['reviewedAt']?.toDate?.() ?? null,
    createdAt:       data['createdAt']?.toDate?.() ?? new Date(),
    updatedAt:       data['updatedAt']?.toDate?.() ?? new Date(),
  };
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
