import { SUPPLY_BOQ_MASTER } from '@/lib/boqMaster';
import type {
  SurveyReport, SurveyInfrastructure, SurveyAssetCounts, SurveyBoqLine,
} from '@/types';

// ─── Step indices ───────────────────────────────────────────────────────────────
// Mirrors the STEPS array in SurveyWizardPage.tsx — kept as plain constants here
// (rather than imported) so this file stays a pure data module with no
// dependency on the page/React. If the wizard's step order ever changes, both
// places must move together.

// The wizard is now TEN steps, but this array is still the EIGHT-entry
// positional space the wizard's `validationIndex` maps onto — see the
// WizardStep type in SurveyWizardPage.tsx. Deliberately not changed here:
// realigning the two is the job of the proper validation rewrite, not of this
// crash fix. Only the two renamed labels changed, so the validation summary
// says "Feeder List", not "Bays".
//
// Capacitor Banks and Transformer Details have NO entry here at all: both
// carry validationIndex: null in the wizard and therefore no rules yet.
export const SURVEY_STEP_LABELS = [
  'Site & Visit',
  'Feeder List',
  'CRP Relay Details',
  'Infrastructure',
  'Cable Runs',
  'Photos',
  'BOQ',
  'Sign-Off',
] as const;

const STEP = {
  siteVisit:      0,
  feeders:        1,
  relays:         2,
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

// ─── Feeder List (was Section C — Bays) ─────────────────────────────────────────

/**
 * Remapped from validateBays. What carried over and what did NOT:
 *
 *   bayNumber        -> bayName              (1:1, error kept)
 *   voltageLevel     -> nominalVoltage       (1:1, error kept)
 *   diPoints         -> diStatusPoints       (1:1, error kept)
 *   photos empty     -> photos empty         (1:1, warning kept)
 *   "at least one"   -> "at least one"       (1:1, error kept)
 *
 *   bayType          -> DROPPED. The Feeder List has no bay-type column.
 *   doPoints/aiPoints-> DROPPED. The checklist asks only for DI status points;
 *                       nothing in the new shape holds DO or AI counts.
 *   tapChangerPresent/
 *   tapPositions     -> MOVED OUT, not dropped: tap data now lives on
 *                       survey.transformers (rtccHighStep/rtccLowStep/
 *                       tptRequired). Transformer Details has no rules yet
 *                       (validationIndex: null), so these are UNVALIDATED for
 *                       now — flagged in the phase report, not silently lost.
 *
 * The three BOQ-driving counts are WARNINGS, not errors — see the note below.
 */
function validateFeeders(survey: SurveyReport): SurveyValidationIssue[] {
  const issues: SurveyValidationIssue[] = [];

  if (survey.feeders.length === 0) {
    issues.push(issue(STEP.feeders, 'At least one feeder is required.'));
    return issues;
  }

  survey.feeders.forEach((feeder, i) => {
    const label = feeder.bayName?.trim() ? `Feeder ${feeder.bayName}` : `Feeder #${i + 1}`;
    if (!feeder.bayName || !feeder.bayName.trim()) {
      issues.push(issue(STEP.feeders, `${label}: bay name is required.`));
    }
    if (!feeder.nominalVoltage) {
      issues.push(issue(STEP.feeders, `${label}: nominal voltage is required.`));
    }
    if (feeder.diStatusPoints == null || feeder.diStatusPoints < 0) {
      issues.push(issue(STEP.feeders, `${label}: number of DI status points is required.`));
    }

    // These three sum straight into the BOQ's F-RTU / MFM / CMR lines. The
    // old DI/DO/AI rules were hard errors precisely because derivation
    // consumed them, and these are what derivation consumes now — but making
    // them errors would be a NEW hard gate on Submit that this crash fix was
    // not asked to introduce. Warnings keep a feeder that silently
    // contributes nothing to the BOQ visible without changing what blocks
    // Submit. One-line change to promote them if that's wanted.
    if (feeder.mfmRequired == null) {
      issues.push(issue(STEP.feeders, `${label}: MFM required not answered — it feeds the BOQ.`, 'warning'));
    }
    if (feeder.cmrRequired == null) {
      issues.push(issue(STEP.feeders, `${label}: CMR required not answered — it feeds the BOQ.`, 'warning'));
    }
    if (feeder.frtuModulesRequired == null) {
      issues.push(issue(STEP.feeders, `${label}: F-RTU / Remote-IO modules required not answered — it feeds the BOQ.`, 'warning'));
    }

    // Warning, not an error — a relay panel may genuinely be
    // un-photographable in a live substation, so this must never block Submit.
    if (feeder.photos.length === 0) {
      issues.push(issue(STEP.feeders, `${label}: no photo attached.`, 'warning'));
    }
  });

  return issues;
}

// ─── CRP Relay Details (was Section D — Devices) ────────────────────────────────

/**
 * Remapped from validateDevices. Still optional to have any; each present one
 * must be filled.
 *
 *   deviceType -> relayType  (1:1, error kept — both answer "what kind is it")
 *   protocol   -> protocol   (1:1, error kept)
 *
 *   quantity   -> DROPPED. A device row could stand for several units; a relay
 *                 row is exactly one relay, so there is nothing to count.
 *   reusable   -> DROPPED. No equivalent column on the relay table.
 *
 * bayName is a warning rather than an error: the step marks it required, but
 * the old Device shape had no name field at all, so an error here would be a
 * new hard gate rather than a remap.
 */
function validateRelays(survey: SurveyReport): SurveyValidationIssue[] {
  const issues: SurveyValidationIssue[] = [];

  survey.relays.forEach((relay, i) => {
    const label = relay.bayName?.trim() ? `Relay ${relay.bayName}` : `Relay #${i + 1}`;
    if (!relay.bayName || !relay.bayName.trim()) {
      issues.push(issue(STEP.relays, `${label}: bay name not filled in.`, 'warning'));
    }
    if (!relay.relayType) {
      issues.push(issue(STEP.relays, `${label}: relay type is required.`));
    }
    if (!relay.protocol) {
      issues.push(issue(STEP.relays, `${label}: protocol is required.`));
    }
  });

  return issues;
}

// ─── Cable runs — BOTH types now required ───────────────────────────────────
//
// Reverses the earlier "cable runs may legitimately be empty" decision: every
// site needs both a CAT6 route and a power route, so each is now a hard error
// rather than an optional group. Each entry present must still be complete.

function validateCableRuns(survey: SurveyReport): SurveyValidationIssue[] {
  const issues: SurveyValidationIssue[] = [];

  if (!survey.cableRuns.some((r) => r.cableType === 'cat6')) {
    issues.push(issue(STEP.cableRuns, 'At least one CAT6 cable run is required.'));
  }
  if (!survey.cableRuns.some((r) => r.cableType === 'power')) {
    issues.push(issue(STEP.cableRuns, 'At least one power cable run is required.'));
  }

  survey.cableRuns.forEach((run, i) => {
    // The type is set by whichever group's Add button created the entry, so a
    // missing one means a document written before the split — still worth
    // flagging, since it belongs to neither group on screen.
    const label = run.cableType === 'cat6' ? `CAT6 run #${i + 1}`
                : run.cableType === 'power' ? `Power run #${i + 1}`
                : `Cable run #${i + 1}`;
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
    survey.feeders.reduce((n, f) => n + f.photos.length, 0) +
    survey.relays.reduce((n, r) => n + r.photos.length, 0);

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
 * Line-level rules are driven by BoqMasterItem.required, NOT by a list kept
 * here — the master is the single place that decides which items matter.
 *
 * A required line must end up with either a quantity or an explicit
 * notApplicable + reason. This replaces the previous "one summarising warning
 * for blank lines" behaviour: because the jointly-signed surveyed BOQ governs
 * supply at the site, a silently blank required line is a supply gap, not a
 * tidiness issue. Errors are per line (matching how bays report) so the
 * surveyor can see WHICH item is missing, not just how many.
 *
 * notApplicable with an empty remark is an error too — recording *why* is the
 * entire point of the toggle, and without it a considered zero is
 * indistinguishable from a careless one.
 *
 * TWO-COLUMN REMAP: the single `surveyedQty` became `existingUsable` +
 * `requiredToSupply`. The old rule maps onto `requiredToSupply` — that is the
 * column that governs what gets supplied, which is what the rule was always
 * protecting. `existingUsable` is deliberately NOT required: nobody was ever
 * asked it before, and a blank there is "not surveyed", not a supply gap.
 * Flagged for the proper validation rewrite to decide.
 *
 * The `!master.required` branch below is currently unreachable — every item
 * in both masters is required:true since rtuFrtuConfigToolLicense was dropped
 * in Phase 1. It is kept because `required` is master-driven and a future
 * optional line must not silently become a hard gate.
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

  // Matched by itemKey, never array position — same convention as StepBoq.
  //
  // SUPPLY ONLY. The service/ITC table was removed from the survey form, so
  // its lines can never be filled — auditing them here would make Submit
  // permanently impossible. SERVICE_BOQ_MASTER is retained in boqMaster.ts for
  // a possible future export, but nothing validates it.
  const auditable = SUPPLY_BOQ_MASTER.map(
    (m) => ({ master: m, line: survey.boqSupply.find((l) => l.itemKey === m.itemKey) }),
  );

  let optionalBlankCount = 0;

  for (const { master, line } of auditable) {
    if (!line) continue;

    if (!master.required) {
      if (line.requiredToSupply == null && !line.notApplicable) optionalBlankCount++;
      continue;
    }

    if (line.notApplicable) {
      if (!line.remarks?.trim()) {
        issues.push(issue(
          STEP.boq,
          `${master.item}: marked not applicable — record why in Remarks.`,
        ));
      }
    } else if (line.requiredToSupply == null) {
      issues.push(issue(
        STEP.boq,
        `${master.item}: required-to-supply quantity is required, or mark it not applicable with a reason.`,
      ));
    }
  }

  if (optionalBlankCount > 0) {
    issues.push(issue(
      STEP.boq,
      `${optionalBlankCount} optional BOQ line${optionalBlankCount !== 1 ? 's' : ''} left blank.`,
      'warning',
    ));
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
    ...validateFeeders(survey),
    ...validateRelays(survey),
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
 * True if any field of a flat all-nullable group has been answered. Used for
 * the Site & Visit groups that are pure touch-detection — they carry no
 * validation rules yet, so this only decides "untouched" vs "complete".
 */
// Takes `object`, not Record<string, unknown> — a TS interface has no index
// signature, so the nominal group types don't satisfy Record.
function isAnyValueSet(group: object): boolean {
  return Object.values(group).some((v) => v !== null && v !== undefined && v !== '');
}

function isAssetCountsTouched(counts: SurveyAssetCounts): boolean {
  return (
    Object.values(counts.baysByVoltage).some((n) => n != null) ||
    Object.values(counts.busesByVoltage).some((n) => n != null) ||
    Object.values(counts.capacitorBanksByVoltage).some((n) => n != null) ||
    Object.values(counts.transformersByVoltage).some((n) => n != null) ||
    // The superseded flat totals still count as "touched" — an in-progress
    // survey that answered them has not left this step untouched.
    counts.transformerCount   != null ||
    counts.busCount           != null ||
    counts.capacitorBankCount != null
  );
}

/** Either quantity column, a remark, or an explicit not-applicable. */
function isBoqLineTouched(line: SurveyBoqLine): boolean {
  return (
    line.existingUsable   != null ||
    line.requiredToSupply != null ||
    !!line.remarks?.trim() ||
    line.notApplicable
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
    // Site & Visit — the two flat counts became assetCounts, and the step now
    // also carries contactDetails / controlRoom, so all three count as touch.
    // No RULES are added for the new groups (this pass invents none); they
    // only affect whether the pill reads "untouched".
    !!survey.surveyorName?.trim() ||
      !!survey.location ||
      !!survey.surveyDate ||
      isAssetCountsTouched(survey.assetCounts) ||
      isAnyValueSet(survey.contactDetails) ||
      isAnyValueSet(survey.controlRoom),
    // Feeder List
    survey.feeders.length > 0,
    // CRP Relay Details
    survey.relays.length > 0,
    // Infrastructure
    isInfrastructureTouched(survey.infrastructure),
    // Cable Runs
    survey.cableRuns.length > 0 || !!survey.difficultRunsNotes?.trim(),
    // Photos
    survey.sitePhotos.length > 0,
    // BOQ — notApplicable counts as touched: ticking it is an answer. Either
    // quantity column counts; an answered "existing & usable" is a real
    // survey observation even with the supply column still blank.
    Object.values(survey.boqChecks).some(Boolean) ||
      survey.boqSupply.some(isBoqLineTouched),
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
