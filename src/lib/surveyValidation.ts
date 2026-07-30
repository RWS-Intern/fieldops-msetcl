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

export interface SurveyValidationIssue {
  stepIndex: number;
  label: string;
  message: string;
}

function issue(stepIndex: number, message: string): SurveyValidationIssue {
  return { stepIndex, label: SURVEY_STEP_LABELS[stepIndex], message };
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

// ─── Entry point ──────────────────────────────────────────────────────────────

/**
 * Hard-validation gate for Submit. Pure function of the survey document —
 * used both for the submit-time block/summary and (via getStepStatuses
 * below) for the per-step soft-validation indicators. Navigation itself is
 * never blocked by this; only Submit is.
 *
 * Sections E–G (Infrastructure) have no required fields — a reviewer can
 * chase gaps there, and a locked DC room shouldn't block a submission.
 *
 * Section I (photos), Section J (BOQ) and sign-off are task 3b's job — no
 * rules exist for them yet. Add validatePhotos/validateBoq/validateSignOff
 * above and spread them into the array below when those steps land.
 */
export function validateSurvey(survey: SurveyReport): SurveyValidationIssue[] {
  return [
    ...validateSiteVisit(survey),
    ...validateBays(survey),
    ...validateDevices(survey),
    ...validateCableRuns(survey),
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
 * has no required fields at all) — Bays can never read as untouched since
 * zero bays is itself a hard-validation issue (shows as incomplete instead).
 * Photos/BOQ/Sign-off have no field content yet (task 3b), so they always
 * report untouched for now.
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
    // Photos — task 3b
    false,
    // BOQ — task 3b
    false,
    // Sign-off — task 3b
    false,
  ];

  return touched.map((isTouched, stepIndex) => {
    const missingCount = missingCountFor(stepIndex);
    if (missingCount > 0) return { state: 'incomplete', missingCount };
    if (!isTouched) return { state: 'untouched', missingCount: 0 };
    return { state: 'complete', missingCount: 0 };
  });
}
