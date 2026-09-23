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
import { deriveSupplyQuantities, applyDerivedQuantities } from '@/lib/boqDerivation';
import { validateSurvey, getStepStatuses } from '@/lib/surveyValidation';
import { StepSiteVisit } from '@/components/survey/steps/StepSiteVisit';
import { StepFeederList } from '@/components/survey/steps/StepFeederList';
import { StepRelayDetails } from '@/components/survey/steps/StepRelayDetails';
import { StepCapacitorBanks } from '@/components/survey/steps/StepCapacitorBanks';
import { StepTransformerDetails } from '@/components/survey/steps/StepTransformerDetails';
import { StepInfrastructure } from '@/components/survey/steps/StepInfrastructure';
import { StepAcdcDetails } from '@/components/survey/steps/StepAcdcDetails';
import { StepCableRuns } from '@/components/survey/steps/StepCableRuns';
import { StepPhotos } from '@/components/survey/steps/StepPhotos';
import { StepBoq } from '@/components/survey/steps/StepBoq';
import { StepSignOff } from '@/components/survey/steps/StepSignOff';
import type { SurveyStepProps } from '@/components/survey/steps/StepProps';
import { LEGACY_COMBINED_VOLTAGE_LEVEL } from '@/types';
import { surveyHasLegacyVoltageData, findLegacyVoltageData } from '@/lib/legacyVoltage';
import { LegacyVoltageBanner } from '@/components/survey/LegacyVoltageBanner';
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

  survey.contactDetails.substationContactNo    = '022-27812345';
  survey.contactDetails.email                  = 'vashi.ss@example.test';
  survey.contactDetails.pinCode                = '400703';
  survey.contactDetails.zoneName               = 'Mumbai Zone';
  survey.contactDetails.omCircle               = 'Vashi O&M Circle';
  survey.contactDetails.omDivision             = 'Vashi O&M Division';
  survey.contactDetails.omDivisionContactNo    = '022-27819999';
  survey.contactDetails.pacCircle              = 'Mumbai PAC Circle';
  survey.contactDetails.pacDivision            = 'Mumbai PAC Division';
  survey.contactDetails.pacDivisionContactNo   = '022-27817777';
  survey.contactDetails.commissionedDate       = new Date('2011-06-01');
  survey.controlRoom.layoutNotes               = 'Panels along north wall.';

  survey.controlRoom.cableTrenchAvailable      = true;
  survey.controlRoom.cableTrenchLengthM        = 40;
  survey.assetCounts.baysByVoltage['132']           = 4;
  survey.assetCounts.baysByVoltage['33']            = 6;
  survey.assetCounts.busesByVoltage['132']          = 2;
  survey.assetCounts.capacitorBanksByVoltage['33']  = 1;
  survey.assetCounts.transformersByVoltage['132']   = 2;

  survey.feeders.push({
    uid: 'f1', bayName: 'Bay-01', nominalVoltage: '132',
    feederOrTransformerDescription: 'Line to Nashik', cableTrenchLengthM: 30,
    panelSpaceAvailable: true,
    existingMfmAvailable: true, existingMfmWorking: false,
    existingMfmAvailableWorking: null,
    existingMfmRs485Available: true, existingMfmRs485Working: false,
    frtuSpaceAvailable: true, cat6LengthFrtuToBaySwitchM: 45,
    cmrSpaceAvailable: false,
    mfmRequired: 2, cmrRequired: 1,
    ctPtRatio: '800/1', shutdownRequired: false, diStatusPoints: 12,
    frtuModulesRequired: 1, remarks: 'ok', photos: [],
  });
  survey.relays.push({
    uid: 'r1', bayName: 'Bay-01', nominalVoltage: '132',
    relayMakeModel: 'ABB REL670', relayType: 'numeric',
    // Superseded and no longer collected — null on the clean fixture so it
    // stays genuinely unflagged.
    protocol: null, ipAddress: null,
    optical: 'yes', ctRatio: '800/1',
    remarks: null, photos: [],
  });
  survey.capacitorBanks.push({
    uid: 'c1', bankNumber: 'CB-1', voltageLevel: '33', numberOfBanks: 3,
    controlType: 'auto', ratingPerBank: '5 MVAR',
    workingStatus: '2 of 3 in service', remarks: null,
  });
  survey.transformers.push({
    uid: 't1', transformerNumber: 'TR-1', voltageLevel: '132',
    mvaRating: '50/63 MVA', rtccHighStep: '+9', rtccLowStep: '-9',
    tapPositionConnectionType: 'resistance', rtccPanelWorking: true,
    existingTptWorking: true, existingTpi4to20mAAvailable: false,
    tptRequired: true, requiredTptCount: 2, remarks: null,
  });
  // Both cable types — each is now a REQUIRED group, and each renders in its
  // own list on the step and in the preview.
  survey.cableRuns.push({
    uid: 'cr1', cableType: 'cat6', fromTo: 'RTU to Bay-01',
    lengthM: 55, trays: 'available',
  });
  survey.cableRuns.push({
    uid: 'cr2', cableType: 'power', fromTo: 'DCDB to RTU panel',
    lengthM: 18, trays: 'new_required',
  });

  // Site checklist (the official table 2) and the retained infrastructure
  // fields the Infrastructure step still renders alongside it.
  survey.siteChecklist.communication.distanceToProposedRtuLocationM = 25;
  survey.siteChecklist.communication.channelType           = 'FOTE';
  survey.siteChecklist.communication.cableLayingMethod     = 'trench';
  survey.siteChecklist.communication.baySwitchToRtuDistanceM = 60;
  survey.siteChecklist.acDcSupply.ac230vAvailable          = true;
  survey.siteChecklist.acDcSupply.dcBreakerVoltageByLevel['132'] = '110';
  survey.siteChecklist.acDcSupply.dcBreakerVoltageByLevel['66'] = '48';
  survey.siteChecklist.acDcSupply.dcBreakerVoltageByLevel['11'] = '24';
  survey.siteChecklist.acDcSupply.distanceToAcdbM          = 12;
  survey.siteChecklist.acDcSupply.distanceToDcdbM          = 18;
  survey.siteChecklist.sld.sldDrawnAndConfirmed            = true;
  survey.siteChecklist.sld.sldShowsExistingAndFutureBays   = false;
  survey.siteChecklist.sld.allEquipmentTypesShownOnSld     = false;
  survey.siteChecklist.sld.sldHandoverFormat               = 'soft_copy';
  survey.siteChecklist.earthing.matExtendedToControlRoom   = true;
  survey.siteChecklist.earthing.matIntact                  = true;
  survey.siteChecklist.earthing.distanceToEarthStripM      = 8;
  survey.siteChecklist.storage.siteAccessAvailable         = true;
  survey.siteChecklist.storage.spaceForUnloading           = false;
  survey.siteChecklist.storage.materialStorageLocation     = 'control_room';

  survey.infrastructure.panelSpaceAvailable   = true;
  survey.infrastructure.panelSpaceMeasurement = '1200 x 800 mm free';
  survey.infrastructure.newPanelRequired      = true;
  survey.infrastructure.mountingNotes         = 'Floor-mounted, north wall.';
  survey.infrastructure.spareMcbs             = true;
  survey.infrastructure.dcdbLocation          = 'Control room, east side';
  survey.infrastructure.ofcAvailable          = true;
  survey.infrastructure.routerAvailable       = false;
  survey.infrastructure.mplsAvailable         = false;
  survey.infrastructure.sldcPathNotes         = 'Existing OFC to SLDC via Nashik.';

  // ACDB / DCDB — PARTIALLY filled on purpose: a few slots answered, the rest
  // left null, so both the filled and the unanswered ("—") render paths run.
  // ACDB / DCDB — the two-row board detail. Partially filled on purpose so
  // both the answered and the unanswered render paths run.
  survey.acdcMcbDetails.acdb.spareMcbCount   = 3;
  survey.acdcMcbDetails.acdb.spareMcbPole    = 'double';
  survey.acdcMcbDetails.acdb.spareMcbRating  = '32 A';
  survey.acdcMcbDetails.acdb.spareMcbRemarks = 'In main ACDB, lower tier.';
  survey.acdcMcbDetails.acdb.mcbUtilisedForNetworkPanel = 'Yes — spare way 4';
  survey.acdcMcbDetails.acdb.utilisedMcbPole   = 'single';
  survey.acdcMcbDetails.acdb.utilisedMcbRating = '16 A';
  survey.acdcMcbDetails.dcdbChargerOutputVoltage = '220 V';
  survey.acdcMcbDetails.dcdbBatteryOutputVoltage = '218 V';
  survey.acdcMcbDetails.dcdb.spareMcbCount  = 2;
  survey.acdcMcbDetails.dcdb.spareMcbPole   = 'double';
  survey.acdcMcbDetails.dcdb.spareMcbRating = '10 A';
  // One photo WITH a remark and one WITHOUT, so both branches of the optional
  // remark render (and the preview's omit-when-empty path) are exercised.
  survey.sitePhotos.push({
    url: 'https://example.test/a.jpg', caption: 'Substation nameplate / entrance',
    remark: 'Nameplate partly obscured by creeper.',
  });
  survey.sitePhotos.push({
    url: 'https://example.test/b.jpg', caption: 'Existing SLD (photo)',
    remark: null,
  });
  // BOQ lines in three distinct states, so the step renders every branch:
  // a plain two-column entry, an existing-usable-only observation, and a
  // not-applicable line with its reason.
  survey.boqSupply[0].requiredToSupply = 1;
  survey.boqSupply[1].existingUsable   = 1;
  survey.boqSupply[3].notApplicable    = true;
  survey.boqSupply[3].requiredToSupply = 0;
  survey.boqSupply[3].autoDerived      = false;
  survey.boqSupply[3].remarks          = 'Existing switch has spare ports.';
  survey.boqService[0].requiredToSupply = 1;

  // Apply the REAL derivation to the four auto-derived lines (MFM / CMR /
  // F-RTU summed from the feeders above, tap-position transducer counted from
  // the transformers above). StepBoq does this in an effect, and
  // renderToStaticMarkup never runs effects — so doing it here is what makes
  // the step's "Auto-calculated — adjust if needed" branch render at all, and
  // it exercises deriveSupplyQuantities/applyDerivedQuantities themselves.
  survey.boqSupply = applyDerivedQuantities(survey.boqSupply, deriveSupplyQuantities(survey));

  return survey;
}

/**
 * A SECOND fixture: the same survey with pre-split values deliberately left in
 * place, exercising the legacy-detection banner and the old-value context.
 *
 * Nothing in the app can produce these values any more — only stored documents
 * carry them, which is exactly the case being covered.
 */
function buildLegacySurvey(): SurveyReport {
  const survey = buildPopulatedSurvey();
  survey.feeders[0].nominalVoltage = LEGACY_COMBINED_VOLTAGE_LEVEL;
  survey.capacitorBanks[0].voltageLevel = LEGACY_COMBINED_VOLTAGE_LEVEL;
  survey.siteChecklist.acDcSupply.dcBreakerVoltageByLevel[LEGACY_COMBINED_VOLTAGE_LEVEL] = '48';
  survey.assetCounts.baysByVoltage[LEGACY_COMBINED_VOLTAGE_LEVEL] = 3;
  // The three flat totals the 4 x 7 grid replaced — an in-progress survey may
  // hold any of them, and each must surface for manual distribution.
  survey.assetCounts.transformerCount   = 5;
  survey.assetCounts.busCount           = 2;
  survey.assetCounts.capacitorBankCount = 1;
  // Step 6 rows retired by the reconciliation against the document's own five
  // tables. All REFERENCE hits, including two booleans recorded as `false`.
  survey.siteChecklist.outdoorCivilWorkStatus = 'Trenching part-complete on the north side.';
  survey.siteChecklist.communication.channelMake = 'Tejas';
  survey.siteChecklist.communication.cableRouteExists = true;
  survey.siteChecklist.lightningProtectionToControlRoom = false;
  survey.siteChecklist.storage.storageSpaceForRtuPanel = true;
  survey.siteChecklist.storage.installSpaceForFrtuSwitchMfmCmr = false;
  // Fields removed outright from Contact Details and Control Room. All
  // REFERENCE hits — including acAvailable: false, which must surface, since a
  // recorded "no" is as much an answer as a "yes".
  survey.contactDetails.substationLandline    = '022-27811234';
  survey.contactDetails.substationVoip        = '5001';
  survey.contactDetails.shiftOperatorContacts = 'A shift — Patil 9812345678';
  survey.controlRoom.roomTemperature          = '28 °C';
  survey.controlRoom.acAvailable              = false;
  survey.controlRoom.acCondition              = 'Compressor faulty';
  survey.controlRoom.mountingStructureOrRtuPanelDimensions = '600 x 800 x 2200 mm';
  // The single Circle / Division the two-office O&M/PAC table replaced.
  survey.contactDetails.circle   = 'Vashi Circle';
  survey.contactDetails.division = 'Vashi Division';
  // Protocol / IP Address, which the relay step no longer asks for. These are
  // REFERENCE hits: they must show in the banner's second list and must NOT
  // count towards the re-enter total.
  survey.relays[0].protocol  = 'iec_61850';
  survey.relays[0].ipAddress = '192.168.1.10';
  // The combined MFM answer the two toggles replaced. Left set ALONGSIDE the
  // two new fields being unanswered, which is exactly how a stored document
  // written before the split looks.
  survey.feeders[0].existingMfmAvailableWorking = false;
  survey.feeders[0].existingMfmAvailable = null;
  survey.feeders[0].existingMfmWorking   = null;
  // One filled slot on each superseded 10-slot board table.
  survey.acdcMcbDetails.acdbMcbSlots = [
    { poleType: 'single', ratingA: '16 A' },
    { poleType: null, ratingA: null },
  ];
  survey.acdcMcbDetails.dcdbMcbSlots = [
    { poleType: null, ratingA: null },
    { poleType: 'double', ratingA: '10 A' },
  ];
  return survey;
}

/**
 * A THIRD fixture: a survey shaped like a STALE LOCAL DRAFT — one saved before
 * the recent structural changes, so the fields added since are genuinely
 * ABSENT keys, not null values.
 *
 * This is exactly the object a restored IndexedDB draft produced in
 * production, and `Object.values(undefined)` on it crashed the wizard's render
 * body. Deleting the keys (rather than setting them null) is the whole point:
 * a null-valued field would never have reproduced the bug.
 */
function buildStaleDraftSurvey(): SurveyReport {
  const survey = buildPopulatedSurvey();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const counts = survey.assetCounts as any;
  delete counts.busesByVoltage;
  delete counts.capacitorBanksByVoltage;
  delete counts.transformersByVoltage;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const acdc = survey.acdcMcbDetails as any;
  delete acdc.acdb;
  delete acdc.dcdb;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const checklist = survey.siteChecklist as any;
  delete checklist.acDcSupply;
  return survey;
}

const STEPS: readonly [string, React.ComponentType<SurveyStepProps>][] = [
  ['1. Site & Visit',        StepSiteVisit],
  ['2. Feeder List',         StepFeederList],
  ['3. CRP Relay Details',   StepRelayDetails],
  ['4. Capacitor Banks',     StepCapacitorBanks],
  ['5. Transformer Details', StepTransformerDetails],
  ['6. Site Infrastructure', StepInfrastructure],
  ['7. ACDB & DCDB Details', StepAcdcDetails],
  ['8. Cable Runs',          StepCableRuns],
  ['9. Photos',              StepPhotos],
  ['10. BOQ',                StepBoq],
  ['11. Sign-Off',           StepSignOff],
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

  console.log('── BOQ auto-derivation (from the feeder / transformer fixtures) ──');
  try {
    const derived = deriveSupplyQuantities(survey);
    for (const [itemKey, value] of Object.entries(derived)) {
      console.log(`  ok   ${itemKey} -> ${value === null ? 'null (nothing answered)' : value}`);
    }
  } catch (err) {
    failures++;
    console.log(`  FAIL deriveSupplyQuantities: ${(err as Error).message}`);
  }

  console.log('\n── wizard render-body calls (run on EVERY render) ──');
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

  console.log('\n── legacy 66/33kV detection ──');
  try {
    const legacy     = buildLegacySurvey();
    const cleanHits  = findLegacyVoltageData(survey);
    const legacyHits = findLegacyVoltageData(legacy);

    const cleanOk = surveyHasLegacyVoltageData(survey) === false && cleanHits.length === 0;
    console.log(`  ${cleanOk ? 'ok  ' : 'FAIL'} clean survey: NOT flagged (${cleanHits.length} hits)`);
    if (!cleanOk) failures++;

    // Split by kind, not just counted: a REFERENCE hit (a question that is
    // gone, with no field to re-enter it into) must never count towards the
    // re-enter total, or the banner could never be cleared.
    const reenter   = legacyHits.filter((h) => h.kind !== 'reference');
    const reference = legacyHits.filter((h) => h.kind === 'reference');
    const legacyOk = surveyHasLegacyVoltageData(legacy) === true
      && legacyHits.length === 26 && reenter.length === 12 && reference.length === 14;
    console.log(`  ${legacyOk ? 'ok  ' : 'FAIL'} legacy survey: flagged, ${legacyHits.length} hits`
      + ` — ${reenter.length} to re-enter (expected 12), ${reference.length} reference (expected 14)`);
    if (!legacyOk) failures++;
    legacyHits.forEach((h) => console.log(
      `         - [${h.kind ?? 're-enter'}] ${h.section}: ${h.label}${h.value ? ` (was ${h.value})` : ''}`));

    // A survey whose ONLY orphaned answers are reference ones must not raise
    // the banner — nothing could ever clear it.
    const refOnly = buildPopulatedSurvey();
    refOnly.relays[0].protocol = 'iec_61850';
    const refOnlyBanner = renderToStaticMarkup(<LegacyVoltageBanner survey={refOnly} />);
    const refOnlyOk = findLegacyVoltageData(refOnly).length === 1
      && surveyHasLegacyVoltageData(refOnly) === false && refOnlyBanner.length === 0;
    console.log(`  ${refOnlyOk ? 'ok  ' : 'FAIL'} reference-only survey: detected but banner NOT raised`);
    if (!refOnlyOk) failures++;

    // Absent entirely when clean, present when affected — the two states the
    // supervisor asked to see proven, not asserted.
    const cleanBanner  = renderToStaticMarkup(<LegacyVoltageBanner survey={survey} />);
    const legacyBanner = renderToStaticMarkup(<LegacyVoltageBanner survey={legacy} />);
    const bannerOk = cleanBanner === '' && legacyBanner.includes('no longer have a field of their own');
    console.log(`  ${bannerOk ? 'ok  ' : 'FAIL'} banner: absent when clean (${cleanBanner.length} chars), present when legacy (${legacyBanner.length} chars)`);
    if (!bannerOk) failures++;
  } catch (err) {
    failures++;
    console.log(`  FAIL legacy detection: ${(err as Error).message}`);
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

  console.log('\n── step walk with PRE-SPLIT data (legacy context must render) ──');
  const legacyProps: SurveyStepProps = { ...props, survey: buildLegacySurvey() };
  for (const [label, Component] of STEPS) {
    try {
      const html = renderToStaticMarkup(<Component {...legacyProps} />);
      console.log(`  ok   ${label}  (${html.length} chars rendered)`);
    } catch (err) {
      failures++;
      console.log(`  FAIL ${label} [legacy]: ${(err as Error).message}`);
    }
  }

  console.log('\n── stale-draft shape (fields genuinely ABSENT, not null) ──');
  const stale = buildStaleDraftSurvey();
  try {
    // The exact call that crashed production: the wizard runs this in its
    // render body on EVERY render, so an undefined record takes down the whole
    // wizard rather than one step.
    const issues = validateSurvey(stale);
    const statuses = getStepStatuses(stale);
    console.log(`  ok   validateSurvey/getStepStatuses survive a stale draft (${issues.length} issues, ${statuses.length} statuses)`);
  } catch (err) {
    failures++;
    console.log(`  FAIL render-body calls threw on a stale draft: ${(err as Error).message}`);
  }

  const staleProps: SurveyStepProps = { ...props, survey: stale };
  for (const [label, Component] of STEPS) {
    try {
      renderToStaticMarkup(<Component {...staleProps} />);
      console.log(`  ok   ${label}`);
    } catch (err) {
      failures++;
      console.log(`  FAIL ${label} [stale draft]: ${(err as Error).message}`);
    }
  }

  console.log(`\n${failures === 0 ? 'WALK CLEAN — 0 uncaught errors' : `${failures} STEP(S) THREW`}`);
  return failures;
}
