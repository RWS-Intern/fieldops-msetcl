/**
 * Survey render-regression walk.
 *
 * Renders all ten wizard steps with react-dom/server against a survey that
 * has real data in every repeatable group, and calls the two functions
 * SurveyWizardPage runs unconditionally in its render body
 * (validateSurvey / getStepStatuses).
 *
 * WHY THIS EXISTS: three separate crashes have shipped past a clean-looking
 * `tsc -b` during the survey rebuild — a removed named export that broke the
 * whole module graph, `survey.bays.length` in a render body, and
 * `survey.bays.reduce` on the Sign-Off step. `tsc`'s error count can't tell
 * "wrong type in a deferred file" from "app won't boot", and a deferred type
 * error in a file that IS mounted is a runtime crash. This walk executes the
 * render bodies, so that class of bug fails here instead of in the field.
 *
 * Run it with `npm run test:survey-render` after ANY change to the survey
 * types, mappers, steps or validation.
 *
 * WHAT IT DOES NOT COVER — do not read a clean run as "the wizard works":
 *   - no useEffect (GPS capture, draft autosave, BOQ derivation are untested)
 *   - no event handlers (typing, tri-state taps, photo upload are untested)
 *   - no createPortal, so SurveyPreview itself is not rendered here
 *   - no browser APIs, no Firestore, no auth
 *   - not type-checked: `tsc -b` only covers `src`, and esbuild strips types
 *     without checking them, so a wrong field name in the fixtures below
 *     fails at runtime here rather than at compile time
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { createEmptySurveyReport } from '@/lib/boqMaster';
import { validateSurvey, getStepStatuses } from '@/lib/surveyValidation';
import { StepSiteVisit } from '@/components/survey/steps/StepSiteVisit';
import { StepFeederList } from '@/components/survey/steps/StepFeederList';
import { StepRelayDetails } from '@/components/survey/steps/StepRelayDetails';
import { StepCapacitorBanks } from '@/components/survey/steps/StepCapacitorBanks';
import { StepTransformerDetails } from '@/components/survey/steps/StepTransformerDetails';
import { StepInfrastructure } from '@/components/survey/steps/StepInfrastructure';
import { StepCableRuns } from '@/components/survey/steps/StepCableRuns';
import { StepPhotos } from '@/components/survey/steps/StepPhotos';
import { StepBoq } from '@/components/survey/steps/StepBoq';
import { StepSignOff } from '@/components/survey/steps/StepSignOff';
import type { SurveyStepProps } from '@/components/survey/steps/StepProps';
import type { SurveyReport } from '@/types';

/** A survey with one entry in every repeatable group — not an empty state. */
function buildPopulatedSurvey(): SurveyReport {
  const survey = createEmptySurveyReport({
    workOrderId: 'wo-1', workOrderCode: 'WO-001', siteId: 'site-1',
    siteCode: 'SUB-001', siteName: 'Test Substation',
  });

  survey.surveyorName = 'Test Surveyor';
  survey.surveyDate   = new Date();
  survey.location     = { lat: 19.07, lng: 72.87 };

  survey.contactDetails.substationInchargeName = 'A. Patil';
  survey.contactDetails.substationLandline     = '022-1234';
  survey.contactDetails.substationVoip         = '5001';
  survey.contactDetails.commissionedDate       = new Date('2011-06-01');
  survey.controlRoom.layoutNotes               = 'Panels along north wall.';
  survey.controlRoom.acAvailable               = true;
  survey.controlRoom.acCondition               = 'Working';
  survey.controlRoom.cableTrenchAvailable      = true;
  survey.controlRoom.cableTrenchLengthM        = 40;
  survey.assetCounts.baysByVoltage['132']      = 4;
  survey.assetCounts.transformerCount          = 2;

  survey.feeders.push({
    uid: 'f1', bayName: 'Bay-01', nominalVoltage: '132',
    feederOrTransformerDescription: 'Line to Nashik', cableTrenchLengthM: 30,
    panelSpaceAvailable: true, existingMfmAvailableWorking: true,
    existingMfmRs485Available: false, mfmRequired: 2, cmrRequired: 1,
    ctPtRatio: '800/1', shutdownRequired: false, diStatusPoints: 12,
    frtuModulesRequired: 1, remarks: 'ok', photos: [],
  });
  survey.relays.push({
    uid: 'r1', bayName: 'Bay-01', nominalVoltage: '132',
    relayMakeModel: 'ABB REL670', relayType: 'numeric', protocol: 'iec_61850',
    ipAddress: '192.168.1.10', optical: 'yes', ctRatio: '800/1',
    remarks: null, photos: [],
  });
  survey.capacitorBanks.push({
    uid: 'c1', bankNumber: 'CB-1', voltageLevel: '66_33', numberOfBanks: 3,
    controlType: 'auto', ratingPerBank: '5 MVAR',
    workingStatus: '2 of 3 in service', remarks: null,
  });
  survey.transformers.push({
    uid: 't1', transformerNumber: 'TR-1', voltageLevel: '132',
    mvaRating: '50/63 MVA', rtccHighStep: '+9', rtccLowStep: '-9',
    tapPositionConnectionType: 'Resistor chain', rtccPanelWorking: true,
    existingTpiWorking: true, existingTpi4to20mAAvailable: false,
    tptRequired: true, remarks: null,
  });
  survey.cableRuns.push({
    uid: 'cr1', cableType: 'cat6', fromTo: 'RTU to Bay-01',
    lengthM: 55, trays: 'available',
  });
  survey.sitePhotos.push({
    url: 'https://example.test/a.jpg', caption: 'Substation nameplate / entrance',
  });
  survey.boqSupply[0].requiredToSupply = 1;
  survey.boqSupply[1].existingUsable   = 1;

  return survey;
}

const STEPS: readonly [string, React.ComponentType<SurveyStepProps>][] = [
  ['1. Site & Visit',        StepSiteVisit],
  ['2. Feeder List',         StepFeederList],
  ['3. CRP Relay Details',   StepRelayDetails],
  ['4. Capacitor Banks',     StepCapacitorBanks],
  ['5. Transformer Details', StepTransformerDetails],
  ['6. Site Infrastructure', StepInfrastructure],
  ['7. Cable Runs',          StepCableRuns],
  ['8. Photos',              StepPhotos],
  ['9. BOQ',                 StepBoq],
  ['10. Sign-Off',           StepSignOff],
];

/** Returns the number of failures; 0 means the walk is clean. */
export function runSurveyWalk(): number {
  const survey = buildPopulatedSurvey();
  const props: SurveyStepProps = {
    survey,
    onChange: () => {},
    readOnly: false,
    siteName: 'Test Substation',
    workOrderCode: 'WO-001',
    siteMaster: { totalBays: 6, numPowerTransformers: 2 },
    onReplacePhotoRef: () => {},
  };

  let failures = 0;

  console.log('── wizard render-body calls (run on EVERY render) ──');
  try {
    const issues   = validateSurvey(survey);
    const statuses = getStepStatuses(survey);
    const errors   = issues.filter((i) => i.severity === 'error').length;
    console.log(`  ok   validateSurvey  -> ${issues.length} issues (${errors} errors, ${issues.length - errors} warnings)`);
    console.log(`  ok   getStepStatuses -> ${statuses.map((s) => s.state).join(', ')}`);
  } catch (err) {
    failures++;
    console.log(`  FAIL validateSurvey/getStepStatuses: ${(err as Error).message}`);
  }

  console.log('\n── step-by-step walk (each rendered with real data) ──');
  for (const [label, Component] of STEPS) {
    try {
      const html = renderToStaticMarkup(<Component {...props} />);
      console.log(`  ok   ${label}  (${html.length} chars rendered)`);
    } catch (err) {
      failures++;
      console.log(`  FAIL ${label}: ${(err as Error).message}`);
    }
  }

  console.log(`\n${failures === 0 ? 'WALK CLEAN — 0 uncaught errors' : `${failures} STEP(S) THREW`}`);
  return failures;
}
