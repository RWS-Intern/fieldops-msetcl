import type { SurveyReport, SurveyInfrastructure } from '@/types';

// ─── Step indices ───────────────────────────────────────────────────────────────
// Mirrors the STEPS array in SurveyWizardPage.tsx — kept as plain constants here
// (rather than imported) so this file stays a pure data module with no
// dependency on the page/React. If the wizard's step order ever changes, both
// places must move together.

export const SURVEY_STEP_LABELS = [
  'Site & Visit',
  'Bays',
  'Devices',
  'Infrastructure',
  'Cable Runs',
  'Photos',
  'BOQ',
  'Sign-Off',
] as const;

const STEP = {
  siteVisit:      0,
  bays:           1,
  devices:        2,
  infrastructure: 3,
  cableRuns:      4,
  photos:         5,
  boq:            6,
  signOff:        7,
} as const;

/**
 * Section I's seven named photo slots — stored in sitePhotos[] keyed by
 * caption (see StepPhotos.tsx). Exported so the UI and this validator never
 * drift on the exact slot names; slot 0 is the required one.
 */
export const SURVEY_PHOTO_SLOTS = [
  'Substation nameplate / entrance',
  'Existing SLD (photo)',
  'Each relay / control panel',
  'Existing MFM / GPS / RTU (if any)',
  'Panel space earmarked for new equipment',
  'Any site-specific constraint',
  'Marked-up SLD / architecture prepared for this site',
] as const;

export interface SurveyValidationIssue {
  stepIndex: number;
  label: string;
  message: string;
  /** Only 'error' blocks Submit. 'warning' shows in the summary/step indicator but never gates. */
  severity: 'error' | 'warning';
}

function issue(stepIndex: number, message: string, severity: 'error' | 'warning' = 'error'): SurveyValidationIssue {
  return { stepIndex, label: SURVEY_STEP_LABELS[stepIndex], message, severity };
}

// ─── Section A + B — Site & Visit ───────────────────────────────────────────────

function validateSiteVisit(survey: SurveyReport): SurveyValidationIssue[] {
  const issues: SurveyValidationIssue[] = [];
  if (!survey.surveyDate) {
    issues.push(issue(STEP.siteVisit, 'Survey date is required.'));
  }
  if (!survey.location) {
    issues.push(issue(STEP.siteVisit, 'GPS location is required.'));
  }
  if (!survey.surveyorName || !survey.surveyorName.trim()) {
    issues.push(issue(STEP.siteVisit, 'Surveyor name is required.'));
  }
  return issues;
}

// ─── Section C — Bays ────────────────────────────────────────────────────────────

function validateBays(survey: SurveyReport): SurveyValidationIssue[] {
  const issues: SurveyValidationIssue[] = [];

  if (survey.bays.length === 0) {
    issues.push(issue(STEP.bays, 'At least one bay is required.'));
    return issues;
  }

  survey.bays.forEach((bay, i) => {
    const label = bay.bayNumber?.trim() ? `Bay ${bay.bayNumber}` : `Bay #${i + 1}`;
    if (!bay.bayNumber || !bay.bayNumber.trim()) {
      issues.push(issue(STEP.bays, `${label}: bay number is required.`));
    }
    if (!bay.bayType) {
      issues.push(issue(STEP.bays, `${label}: bay type is required.`));
    }
    if (!bay.voltageLevel) {
      issues.push(issue(STEP.bays, `${label}: voltage level is required.`));
    }
    if (bay.diPoints == null || bay.diPoints < 0) {
      issues.push(issue(STEP.bays, `${label}: status (DI) points is required.`));
    }
    if (bay.doPoints == null || bay.doPoints < 0) {
      issues.push(issue(STEP.bays, `${label}: control (DO) points is required.`));
    }
    if (bay.aiPoints == null || bay.aiPoints < 0) {
      issues.push(issue(STEP.bays, `${label}: analog (AI) points is required.`));
    }
    if (bay.bayType === 'transformer') {
      if (bay.tapChangerPresent === null || bay.tapChangerPresent === undefined) {
        issues.push(issue(STEP.bays, `${label}: tap changer present must be answered.`));
      } else if (bay.tapChangerPresent === true && bay.tapPositions == null) {
        issues.push(issue(STEP.bays, `${label}: number of tap positions is required.`));
      }
    }
    // Warning, not an error — a relay panel may genuinely be
    // un-photographable in a live substation, so this must never block Submit.
    if (bay.photos.length === 0) {
      issues.push(issue(STEP.bays, `${label}: no photo attached.`, 'warning'));
    }
  });

  return issues;
}

// ─── Section D — Devices (optional to have any; each present one must be filled) ─

function validateDevices(survey: SurveyReport): SurveyValidationIssue[] {
  const issues: SurveyValidationIssue[] = [];

  survey.devices.forEach((device, i) => {
    const label = `Device #${i + 1}`;
    if (!device.deviceType) {
      issues.push(issue(STEP.devices, `${label}: device type is required.`));
    }
    if (!device.protocol) {
      issues.push(issue(STEP.devices, `${label}: protocol is required.`));
    }
    if (!device.quantity || device.quantity < 1) {
      issues.push(issue(STEP.devices, `${label}: quantity must be at least 1.`));
    }
    if (device.reusable === null || device.reusable === undefined) {
      issues.push(issue(STEP.devices, `${label}: reusable / suitable for integration must be answered.`));
    }
  });

  return issues;
}

// ─── Section H — Cable runs (optional to have any; each present one must be filled) ─

function validateCableRuns(survey: SurveyReport): SurveyValidationIssue[] {
  const issues: SurveyValidationIssue[] = [];

  survey.cableRuns.forEach((run, i) => {
    const label = `Cable run #${i + 1}`;
    if (!run.cableType) {
      issues.push(issue(STEP.cableRuns, `${label}: cable type is required.`));
    }
    if (!run.fromTo || !run.fromTo.trim()) {
      issues.push(issue(STEP.cableRuns, `${label}: route (from/to) is required.`));
    }
    if (!run.lengthM || run.lengthM <= 0) {
      issues.push(issue(STEP.cableRuns, `${label}: length must be greater than 0.`));
    }
  });

  return issues;
}

// ─── Section I — Photos ──────────────────────────────────────────────────────

function validatePhotos(survey: SurveyReport): SurveyValidationIssue[] {
  const issues: SurveyValidationIssue[] = [];

  const totalPhotoCount =
    survey.sitePhotos.length +
    survey.bays.reduce((n, b) => n + b.photos.length, 0) +
    survey.devices.reduce((n, d) => n + d.photos.length, 0);

  if (totalPhotoCount === 0) {
    issues.push(issue(STEP.photos, 'At least one photo is required.'));
  }

  const hasNameplatePhoto = survey.sitePhotos.some((p) => p.caption === SURVEY_PHOTO_SLOTS[0]);
  if (!hasNameplatePhoto) {
    issues.push(issue(STEP.photos, `"${SURVEY_PHOTO_SLOTS[0]}" photo is required.`));
  }

  // Cross-check against BOQ's markedUpSldAttached checkbox: that checkbox is
  // a hard error when unticked, but slot 7 itself is otherwise optional, so
  // it can be ticked with no evidence attached. Catch that inconsistency
  // here rather than let it become a false attestation on a document going
  // for government vetting.
  if (survey.boqChecks.markedUpSldAttached) {
    const hasMarkedUpSldPhoto = survey.sitePhotos.some((p) => p.caption === SURVEY_PHOTO_SLOTS[6]);
    if (!hasMarkedUpSldPhoto) {
      issues.push(issue(STEP.photos, 'Marked-up SLD is confirmed attached, but no photo was added for that slot.'));
    }
  }

  return issues;
}

// ─── Section J — BOQ ──────────────────────────────────────────────────────────

/**
 * quantitiesCrossCheckedAgainstAnnexureI and markedUpSldAttached are errors
 * when unticked — both are things the surveyor genuinely does/confirms in
 * the field (markedUpSldAttached is additionally cross-checked against the
 * Photos step above, since the checkbox alone can't prove a photo exists).
 *
 * updatedInMsetclWebAppAndTracker is a warning instead: updating the MSETCL
 * web-application is an office activity the surveyor cannot perform from a
 * substation — the form itself hedges with "(if available)" — so a hard
 * gate here would either block a legitimate field submission or induce a
 * false attestation on a document going for government vetting.
 *
 * A blank BOQ line is only a warning: most sites won't need all 19 items,
 * and requiring a 0 on every line invites careless filling. One summarising
 * warning, not one per blank line.
 */
function validateBoq(survey: SurveyReport): SurveyValidationIssue[] {
  const issues: SurveyValidationIssue[] = [];

  if (!survey.boqChecks.quantitiesCrossCheckedAgainstAnnexureI) {
    issues.push(issue(STEP.boq, 'Confirm quantities were cross-checked against tender Annexure-I.'));
  }
  if (!survey.boqChecks.markedUpSldAttached) {
    issues.push(issue(STEP.boq, 'Confirm the marked-up SLD / architecture is attached.'));
  }
  if (!survey.boqChecks.updatedInMsetclWebAppAndTracker) {
    issues.push(issue(
      STEP.boq,
      'Reminder: update survey data in the MSETCL web-application and our tracker.',
      'warning',
    ));
  }

  const blankCount =
    survey.boqSupply.filter((l) => l.surveyedQty == null).length +
    survey.boqService.filter((l) => l.surveyedQty == null).length;
  if (blankCount > 0) {
    issues.push(issue(STEP.boq, `${blankCount} BOQ line${blankCount !== 1 ? 's' : ''} left blank.`, 'warning'));
  }

  return issues;
}

// ─── Sign-off ─────────────────────────────────────────────────────────────────

function validateSignOff(survey: SurveyReport): SurveyValidationIssue[] {
  const issues: SurveyValidationIssue[] = [];
  const signOff = survey.signOff;

  if (!signOff.msetclEngineerName || !signOff.msetclEngineerName.trim()) {
    issues.push(issue(STEP.signOff, 'MSETCL joint engineer name is required.'));
  }
  if (!signOff.msetclEngineerDesignation || !signOff.msetclEngineerDesignation.trim()) {
    issues.push(issue(STEP.signOff, 'MSETCL joint engineer designation is required.'));
  }
  // Keep this a hard error. Whether MSETCL and SE-PAC accept an on-screen
  // signature in place of wet ink has not been confirmed — until it is, the
  // photographed paper original is the document of record, and the two
  // on-screen signatures below are supplementary only. If that's ever
  // confirmed and someone wants to relax this photo requirement instead,
  // that should be a deliberate call informed by that confirmation, not a
  // side effect of touching this function for something else.
  if (signOff.signedPagePhotos.length === 0) {
    issues.push(issue(STEP.signOff, 'A photo of the signed BOQ page is required.'));
  }

  // Both on-screen signatures are warnings, not errors, for the same reason
  // the signed-page photo above stays a hard error: acceptance of a drawn
  // signature over wet ink is unconfirmed, so gating Submit on it would be
  // premature. Promote these to errors only once that's actually settled —
  // don't flip severity here without re-reading this comment first.
  if (!signOff.surveyorSignatureImage) {
    issues.push(issue(STEP.signOff, 'Surveyor on-screen signature not captured.', 'warning'));
  }
  if (!signOff.msetclSignatureImage) {
    issues.push(issue(STEP.signOff, 'MSETCL engineer on-screen signature not captured.', 'warning'));
  }

  return issues;
}

// ─── Entry point ──────────────────────────────────────────────────────────────

/**
 * Hard-validation gate for Submit. Pure function of the survey document —
 * used both for the submit-time block/summary and (via getStepStatuses
 * below) for the per-step soft-validation indicators. Navigation itself is
 * never blocked by this; only issues with severity 'error' gate Submit —
 * 'warning' issues (e.g. a bay with no photo, or blank BOQ lines) show in the
 * same summary and step indicators but never block.
 *
 * Sections E–G (Infrastructure) have no required fields — a reviewer can
 * chase gaps there, and a locked DC room shouldn't block a submission.
 */
export function validateSurvey(survey: SurveyReport): SurveyValidationIssue[] {
  return [
    ...validateSiteVisit(survey),
    ...validateBays(survey),
    ...validateDevices(survey),
    ...validateCableRuns(survey),
    ...validatePhotos(survey),
    ...validateBoq(survey),
    ...validateSignOff(survey),
  ];
}

// ─── Step completion status (soft validation) ──────────────────────────────────

export type StepCompletionState = 'complete' | 'incomplete' | 'untouched';

export interface StepStatus {
  state: StepCompletionState;
  missingCount: number;
}

const EMPTY_INFRASTRUCTURE_KEYS: (keyof SurveyInfrastructure)[] = [
  'panelSpaceAvailable', 'panelSpaceMeasurement', 'newPanelRequired', 'mountingNotes',
  'dcSupplyAvailable', 'acSupplyAvailable', 'spareMcbs', 'dcdbLocation',
  'ofcAvailable', 'routerAvailable', 'mplsAvailable', 'sldcPathNotes', 'earthingAvailable',
];

function isInfrastructureTouched(infra: SurveyInfrastructure): boolean {
  return (
    EMPTY_INFRASTRUCTURE_KEYS.some((k) => infra[k] !== null) ||
    infra.civilWork.length > 0 ||
    infra.dcVoltages.length > 0
  );
}

/**
 * Per-step soft-validation status for the wizard's step pills. "untouched"
 * only applies to steps where an empty/default state is a legitimate,
 * deliberate outcome (Devices and Cable Runs may have none; Infrastructure
 * has no required fields at all) — Bays, Photos, BOQ and Sign-Off can never
 * read as untouched since each has at least one hard-validation issue that's
 * present from a blank state (shows as incomplete instead). missingCount
 * mixes errors and warnings together (e.g. a bay missing a photo, or blank
 * BOQ lines, count here even though neither blocks Submit) — that's
 * deliberate, so the indicator surfaces anything worth a surveyor's
 * attention, not just blocking issues.
 */
export function getStepStatuses(survey: SurveyReport): StepStatus[] {
  const issues = validateSurvey(survey);
  const missingCountFor = (stepIndex: number) =>
    issues.filter((i) => i.stepIndex === stepIndex).length;

  const touched: boolean[] = [
    // Site & Visit
    !!survey.surveyorName?.trim() ||
      !!survey.location ||
      !!survey.surveyDate ||
      survey.surveyedTotalBays != null ||
      survey.surveyedNumPowerTransformers != null ||
      Object.values(survey.preVisit).some(Boolean),
    // Bays
    survey.bays.length > 0,
    // Devices
    survey.devices.length > 0,
    // Infrastructure
    isInfrastructureTouched(survey.infrastructure),
    // Cable Runs
    survey.cableRuns.length > 0 || !!survey.difficultRunsNotes?.trim(),
    // Photos
    survey.sitePhotos.length > 0,
    // BOQ
    Object.values(survey.boqChecks).some(Boolean) ||
      survey.boqSupply.some((l) => l.surveyedQty != null || !!l.remarks?.trim()) ||
      survey.boqService.some((l) => l.surveyedQty != null || !!l.remarks?.trim()),
    // Sign-off
    !!survey.signOff.msetclEngineerName?.trim() ||
      !!survey.signOff.msetclEngineerDesignation?.trim() ||
      !!survey.signOff.msetclEngineerEmpId?.trim() ||
      survey.signOff.signedPagePhotos.length > 0 ||
      !!survey.signOff.surveyorSignatureImage ||
      !!survey.signOff.msetclSignatureImage,
  ];

  return touched.map((isTouched, stepIndex) => {
    const missingCount = missingCountFor(stepIndex);
    if (missingCount > 0) return { state: 'incomplete', missingCount };
    if (!isTouched) return { state: 'untouched', missingCount: 0 };
    return { state: 'complete', missingCount: 0 };
  });
}
