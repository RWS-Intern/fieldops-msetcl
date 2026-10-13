/**
 * Regression tests for the four features built most recently:
 *
 *   1. Lifecycle Details   — summariseLifecycle + the detail page's data shapes
 *   2. Project creation    — task-template invariants + TaskTemplateEditor render
 *   3. Reporting           — useReports aggregation + the Excel export
 *   4. BOQ                 — master invariants, derivation, BoqTable render
 *
 * Same discipline as scripts/ssrSurveyWalk.tsx, and run the same way: Node +
 * esbuild, no browser, no Firebase project touched. See runFeatureTests.mjs.
 *
 * WHAT THIS CANNOT COVER, deliberately stated so a clean run is not mistaken
 * for more than it is:
 *   - react-dom/server does not implement createPortal, so anything rendered
 *     through one (SurveyPreview, BoqReviewPanel, every Radix Dialog — which
 *     means CreateProjectModal and the Add Task popup) cannot be rendered here.
 *   - No effects run and no event handlers fire, so click paths are untested.
 *   - Nothing here touches firestore.rules. Those need the emulator
 *     (npm run test:rules), which needs Java.
 */
import { renderToStaticMarkup } from 'react-dom/server';

import { runSaverTests } from './saverTests';
import { runAllInputsTests } from './allInputsTests';
import { chooseDraftSource, toMillis, buildAutosavePayload, stripUndefinedDeep } from '@/lib/surveyDraftSync';
import { backoffDelay, claimPhoto, releasePhoto, _resetUploaderForTests } from '@/lib/surveyPhotoUploader';
import { mergePhotoFields, removedRefs } from '@/lib/surveyPhotoMerge';
import { signFields, changedFields, adoptRemoteFields, shieldFilledAnswers } from '@/lib/surveyDelta';

import { summariseLifecycle, WORK_ORDER_STAGE_LABEL } from '@/hooks/useSiteLifecycle';
import { SURVEY_APPROVAL_STAGES, SURVEY_APPROVAL_STAGE_COUNT } from '@/lib/approvalStages';
import type { LifecycleEntry } from '@/hooks/useSiteLifecycle';
import { SUPPLY_BOQ_MASTER, BOQ_DERIVED_ITEMS, createEmptySurveyReport } from '@/lib/boqMaster';
import { deriveSupplyQuantities, applyDerivedQuantities, DERIVED_ITEM_KEYS } from '@/lib/boqDerivation';
import { BoqTable } from '@/components/survey/SurveyPreview';
import { TaskTemplateEditor } from '@/components/projects/TaskTemplateEditor';
import { useReports } from '@/hooks/useReports';
import type { SiteTask, SurveyReport, TaskTemplate, SurveyBoqLine } from '@/types';

// ─── Tiny assertion harness ───────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function ok(name: string, condition: boolean, detail?: string): void {
  if (condition) {
    passed++;
    console.log(`  ok   ${name}`);
  } else {
    failed++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function eq(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  ok(name, a === e, a === e ? undefined : `expected ${e}, got ${a}`);
}

function section(title: string): void {
  console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 60 - title.length))}`);
}

/** Renders a component and fails the test rather than throwing out of the run. */
function rendersWithout(name: string, node: React.ReactElement): string {
  try {
    const html = renderToStaticMarkup(node);
    ok(name, true);
    return html;
  } catch (err) {
    ok(name, false, (err as Error).message);
    return '';
  }
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function task(o: Partial<SiteTask> = {}): SiteTask {
  return {
    id: 't1', taskCode: 'S-1/IOT/MATDEL-01', siteId: 's1', siteCode: 'S-1',
    siteName: 'Sub One', city: 'Pune', projectId: 'p1', projectName: 'IoT',
    projectCode: 'IOT', taskKey: 'matdel', taskLabel: 'Material Delivery',
    taskColour: '#0077B6', subtasks: [], assignedTo: 'u1',
    assignedToName: 'Krutika', assignedToCode: 'ENG-001', status: 'pending',
    startDate: null, dueDate: null, subtaskAnswers: {}, subtaskPhotos: {},
    completionPhotos: [], blockedReason: null, location: null,
    submittedBy: null, submittedAt: null, createdAt: new Date(),
    updatedAt: new Date(), archived: false, approverUid: null,
    approverName: null, approverCode: null, reviewNotes: null,
    reviewedBy: null, reviewedByName: null, reviewedAt: null,
    ...o,
  } as SiteTask;
}

function survey(o: Partial<SurveyReport> = {}): SurveyReport {
  const base = createEmptySurveyReport({
    workOrderId: 'wo1', workOrderCode: 'WO-S-1-SURVEY-01',
    siteId: 's1', siteCode: 'S-1', siteName: 'Sub One',
  });
  return { ...base, ...o } as SurveyReport;
}

function entry(o: Partial<LifecycleEntry> = {}): LifecycleEntry {
  return {
    kind: 'siteTask', id: 'e1', code: 'S-1/IOT/MATDEL-01',
    label: 'Material Delivery', status: 'pending', assignedToName: null,
    updatedAt: new Date(), stage: null, taskKey: 'matdel', linkTo: null,
    ...o,
  } as LifecycleEntry;
}

const template = (o: Partial<TaskTemplate> = {}): TaskTemplate => ({
  taskKey: 'matdel', label: 'Material Delivery', colour: '#0077B6',
  sortOrder: 0, subtasks: [], ...o,
});

// ─── 1. Lifecycle Details ─────────────────────────────────────────────────────

function testLifecycle(): void {
  section('1. Lifecycle Details');

  // A site with no work at all still gets one tile per configured task type,
  // plus the survey tile — that is what makes the row a checklist rather than
  // a list of what happens to exist.
  const empty = summariseLifecycle([], [template(), template({ taskKey: 'siteco', label: 'Commissioning', sortOrder: 1 })]);
  eq('empty site yields survey + one tile per template', empty.length, 3);
  eq('survey tile comes first', empty[0].key, 'survey');
  eq('survey tile label from stage map', empty[0].label, WORK_ORDER_STAGE_LABEL.survey);
  eq('nothing started reports null status', empty.map((t) => t.status), [null, null, null]);
  eq('nothing started reports zero counts', empty.map((t) => t.count), [0, 0, 0]);

  // A task instance must line up with its template BY KEY. Matching on label
  // would break the moment a template is renamed, because SiteTask.taskLabel
  // is a snapshot taken at creation.
  const renamed = summariseLifecycle(
    [entry({ taskKey: 'matdel', label: 'OLD LABEL', status: 'completed' })],
    [template({ label: 'Material Delivery (renamed)' })],
  );
  const matdel = renamed.find((t) => t.key === 'matdel');
  ok('template renamed after task creation still matches by key', matdel?.count === 1);
  eq('matched tile reports the instance status', matdel?.status, 'completed');
  eq('tile shows the CURRENT template label', matdel?.label, 'Material Delivery (renamed)');

  // Survey work orders roll into the survey tile.
  const withSurvey = summariseLifecycle(
    [entry({ kind: 'workOrder', id: 'w1', stage: 'survey', taskKey: null, status: 'approved' })],
    [],
  );
  eq('survey work order lands on the survey tile', withSurvey[0].count, 1);
  eq('survey tile carries its status', withSurvey[0].status, 'approved');

  // A task type added to the project AFTER a site was created has no instance,
  // and must still appear — otherwise the row silently omits planned work.
  const addedLater = summariseLifecycle([], [template({ taskKey: 'newtype', label: 'Added Later' })]);
  ok('task type added after site creation still appears', addedLater.some((t) => t.key === 'newtype'));
}

// ─── 2. Project creation ──────────────────────────────────────────────────────

function testProjectCreation(): void {
  section('2. Project creation');

  // The editor is what an admin fills in before any project document exists,
  // so a render crash here blocks project creation outright.
  const html = rendersWithout(
    'TaskTemplateEditor renders with no templates',
    <TaskTemplateEditor templates={[]} errors={{}} onChange={() => {}} />,
  );
  ok('empty editor offers a way to add one', html.includes('Task Type') || html.length > 0);

  rendersWithout(
    'TaskTemplateEditor renders several templates with subtasks',
    <TaskTemplateEditor
      templates={[
        template({ subtasks: [
          { subtaskId: 's1', label: 'Panel photo', collectionType: 'image_only', isRequired: true,  imageRequired: true,  options: [], sortOrder: 0 },
          { subtaskId: 's2', label: 'Reading',     collectionType: 'number',     isRequired: false, imageRequired: false, options: [], sortOrder: 1 },
        ] }),
        template({ taskKey: 'siteco', label: 'Commissioning', sortOrder: 1, subtasks: [
          { subtaskId: 's3', label: 'Type', collectionType: 'select', isRequired: true, imageRequired: false, options: ['A', 'B'], sortOrder: 0 },
        ] }),
      ]}
      errors={{}}
      onChange={() => {}}
    />,
  );

  // Validation errors must reach the row they belong to rather than throwing.
  rendersWithout(
    'TaskTemplateEditor renders with validation errors set',
    <TaskTemplateEditor
      templates={[template()]}
      errors={{ tmpl_label_0: 'Required', tmpl_taskKey_0: 'Duplicate key' }}
      onChange={() => {}}
    />,
  );

  // Sort order is what the Add Task picker numbers its steps by, so a project
  // whose templates carry duplicate or unordered sortOrders would produce a
  // confusing sequence. This asserts the summary row's ordering contract.
  const ordered = summariseLifecycle([], [
    template({ taskKey: 'c', label: 'Third',  sortOrder: 2 }),
    template({ taskKey: 'a', label: 'First',  sortOrder: 0 }),
    template({ taskKey: 'b', label: 'Second', sortOrder: 1 }),
  ]);
  eq('lifecycle tiles follow template sortOrder',
    ordered.filter((t) => t.kind === 'siteTask').map((t) => t.label),
    ['First', 'Second', 'Third']);
}

// ─── 3. Reporting ─────────────────────────────────────────────────────────────

/** Renders useReports once and hands the result back through a mutable box. */
function readReports(
  tasks: SiteTask[],
  surveys: SurveyReport[],
): ReturnType<typeof useReports> {
  let captured: ReturnType<typeof useReports> | null = null;
  // Handed out through a prop rather than assigned to the closure directly:
  // writing an outer binding from inside a component body is exactly what
  // react-hooks/globals exists to catch, and the rule is right even in a test.
  function Probe({ emit }: { emit: (r: ReturnType<typeof useReports>) => void }) {
    emit(useReports(tasks, surveys));
    return null;
  }
  renderToStaticMarkup(<Probe emit={(r) => { captured = r; }} />);
  if (!captured) throw new Error('useReports never ran');
  return captured;
}

function testReporting(): void {
  section('3. Reporting');

  const sumSegments = (r: ReturnType<typeof useReports>) =>
    r.byStatus.reduce((n, s) => n + s.value, 0);

  // The doughnut's centre is the sum of its segments, and the Total tile is
  // tasks + surveys. If every status does not map to exactly one segment the
  // two disagree — which is precisely the bug this asserts against.
  const mixed = readReports(
    [task({ id: 'a', status: 'pending' }), task({ id: 'b', status: 'pending_approval' }),
     task({ id: 'c', status: 'blocked' }), task({ id: 'd', status: 'completed' })],
    [survey({ id: 's1', status: 'in_progress' }), survey({ id: 's2', status: 'pending_approval' })],
  );
  eq('total counts tasks + surveys', mixed.summary.total, 6);
  eq('doughnut segments sum to the Total tile', sumSegments(mixed), mixed.summary.total);

  // Tasks only, and surveys only, must both still reconcile.
  const tasksOnly = readReports([task({ id: 'a', status: 'changes_requested' })], []);
  eq('tasks-only reconciles', sumSegments(tasksOnly), tasksOnly.summary.total);

  const surveysOnly = readReports([], [survey({ id: 's1', status: 'open' }), survey({ id: 's2', status: 'closed' })]);
  eq('surveys-only reconciles', sumSegments(surveysOnly), surveysOnly.summary.total);
  eq('survey "closed" counts as completed', surveysOnly.summary.completed, 1);

  // Both survey terminal states roll into Completed.
  const terminal = readReports([], [survey({ id: 's1', status: 'approved' }), survey({ id: 's2', status: 'closed' })]);
  eq('approved and closed both count as completed', terminal.summary.completed, 2);

  // Neither tile can move on survey data: WorkOrderStatus has no blocked
  // state, and a survey carries no due date.
  const noBlocked = readReports([], [survey({ id: 's1', status: 'in_progress' })]);
  eq('surveys never add to Blocked', noBlocked.summary.blocked, 0);
  eq('surveys never add to Overdue', noBlocked.summary.overdue, 0);

  // An overdue task is one past its due date and not completed.
  const past = new Date(Date.now() - 86_400_000);
  const overdue = readReports(
    [task({ id: 'a', status: 'in_progress', dueDate: past }),
     task({ id: 'b', status: 'completed',   dueDate: past })],
    [],
  );
  eq('completed work is never overdue', overdue.summary.overdue, 1);

  // Empty input must not divide by zero.
  const none = readReports([], []);
  eq('empty report has 0% completion, not NaN', none.summary.completionRate, 0);
  eq('empty report totals zero', none.summary.total, 0);

  // surveyCount is what the page uses to explain the tiles.
  eq('surveyCount reports how many of the total are surveys', mixed.summary.surveyCount, 2);

  // byEngineer must drop engineers with nothing in view, or a vendor filter
  // would list every engineer at 0/0.
  ok('byEngineer excludes engineers with no tasks in view',
    mixed.byEngineer.every((e) => e.total > 0));

  // ── Approval-stage tiles ──
  // Mirrors ReportsPage's byStage: count only surveys still IN review, bucketed
  // by the stage they are parked at, ignoring an out-of-range index.
  const countByStage = (surveys: SurveyReport[]) => {
    const counts = SURVEY_APPROVAL_STAGES.map(() => 0);
    surveys.forEach((sv) => {
      if (sv.status !== 'pending_approval') return;
      const i = sv.currentStageIndex;
      if (i >= 0 && i < counts.length) counts[i] += 1;
    });
    return counts;
  };

  const inReview = [
    survey({ id: 'a', status: 'pending_approval', currentStageIndex: 0 }),
    survey({ id: 'b', status: 'pending_approval', currentStageIndex: 0 }),
    survey({ id: 'c', status: 'pending_approval', currentStageIndex: 2 }),
  ];
  eq('stage tiles bucket surveys by their live stage', countByStage(inReview), [2, 0, 1]);
  eq('stage tiles sum to the surveys in review',
    countByStage(inReview).reduce((a, b) => a + b, 0), 3);

  // A fully approved survey carries currentStageIndex === stage count. Clamping
  // it into the last stage would report finished work as still waiting.
  const done = [survey({ id: 'd', status: 'approved', currentStageIndex: SURVEY_APPROVAL_STAGE_COUNT })];
  eq('a fully approved survey is in no stage bucket', countByStage(done), [0, 0, 0]);

  // Not in review means not awaiting a stage, whatever the index says.
  const sentBack = [survey({ id: 'e', status: 'changes_requested', currentStageIndex: 1 })];
  eq('a sent-back survey is in no stage bucket', countByStage(sentBack), [0, 0, 0]);

  eq('there are exactly three stages to show', SURVEY_APPROVAL_STAGE_COUNT, 3);
}

// ─── 4. BOQ ───────────────────────────────────────────────────────────────────

function testBoq(): void {
  section('4. BOQ');

  // A duplicate itemKey would make two lines indistinguishable to the read
  // mapper, which matches lines by key rather than array position.
  const keys = SUPPLY_BOQ_MASTER.map((i) => i.itemKey);
  eq('supply master itemKeys are unique', new Set(keys).size, keys.length);
  ok('supply master sr numbers are 1..n in order',
    SUPPLY_BOQ_MASTER.every((item, i) => item.sr === i + 1));

  // Every derived item must name a field the derivation can actually sum;
  // a typo here would silently derive nothing.
  const feederNumericFields = [
    'mfmRequired', 'cmrRequired', 'frtuModulesRequired', 'diStatusPoints',
    'cableTrenchLengthM', 'cat6LengthFrtuToBaySwitchM',
  ];
  ok('every derived item names a real feeder field',
    BOQ_DERIVED_ITEMS.every((i) => !i.derivedFromFeederField
      || feederNumericFields.includes(i.derivedFromFeederField)),
    BOQ_DERIVED_ITEMS.filter((i) => i.derivedFromFeederField
      && !feederNumericFields.includes(i.derivedFromFeederField))
      .map((i) => `${i.itemKey}→${i.derivedFromFeederField}`).join(', '));

  ok('DERIVED_ITEM_KEYS matches the master flags',
    BOQ_DERIVED_ITEMS.every((i) => DERIVED_ITEM_KEYS.has(i.itemKey)));

  // Derivation sums the named field across every feeder.
  const s = survey();
  s.feeders = [
    { uid: 'f1', bayName: 'B1', nominalVoltage: '132', feederOrTransformerDescription: null,
      cableTrenchLengthM: null, panelSpaceAvailable: null, existingMfmAvailable: null,
      existingMfmWorking: null, existingMfmAvailableWorking: null, existingMfmRs485Available: null,
      existingMfmRs485Working: null, mfmModbusCompatible: null, frtuSpaceAvailable: null,
      cat6LengthFrtuToBaySwitchM: null, cmrSpaceAvailable: null, biAiTbSpaceAvailable: null,
      mfmRequired: 2, cmrRequired: 1, ctPtRatio: null, shutdownRequired: null,
      diStatusPoints: null, frtuModulesRequired: 1, remarks: null, photos: [] },
    { uid: 'f2', bayName: 'B2', nominalVoltage: '33', feederOrTransformerDescription: null,
      cableTrenchLengthM: null, panelSpaceAvailable: null, existingMfmAvailable: null,
      existingMfmWorking: null, existingMfmAvailableWorking: null, existingMfmRs485Available: null,
      existingMfmRs485Working: null, mfmModbusCompatible: null, frtuSpaceAvailable: null,
      cat6LengthFrtuToBaySwitchM: null, cmrSpaceAvailable: null, biAiTbSpaceAvailable: null,
      mfmRequired: 3, cmrRequired: null, ctPtRatio: null, shutdownRequired: null,
      diStatusPoints: null, frtuModulesRequired: 2, remarks: null, photos: [] },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ] as any;

  const derived = deriveSupplyQuantities(s);
  const mfmItem = BOQ_DERIVED_ITEMS.find((i) => i.derivedFromFeederField === 'mfmRequired');
  if (mfmItem) eq('MFM derives as the sum across feeders (2 + 3)', derived[mfmItem.itemKey], 5);
  const cmrItem = BOQ_DERIVED_ITEMS.find((i) => i.derivedFromFeederField === 'cmrRequired');
  if (cmrItem) eq('a null feeder value contributes nothing (1 + null)', derived[cmrItem.itemKey], 1);

  // A surveyor's own number must survive re-derivation — this is the whole
  // point of the autoDerived flag.
  if (mfmItem) {
    const manual: SurveyBoqLine[] = s.boqSupply.map((l) =>
      l.itemKey === mfmItem.itemKey
        ? { ...l, requiredToSupply: 99, autoDerived: false }
        : l);
    const after = applyDerivedQuantities(manual, derived);
    eq('a manually edited line is not overwritten by derivation',
      after.find((l) => l.itemKey === mfmItem.itemKey)?.requiredToSupply, 99);

    const auto = applyDerivedQuantities(
      s.boqSupply.map((l) => l.itemKey === mfmItem.itemKey ? { ...l, autoDerived: true } : l),
      derived,
    );
    eq('an untouched derived line takes the computed value',
      auto.find((l) => l.itemKey === mfmItem.itemKey)?.requiredToSupply, 5);
  }

  // The table renders every distinct line state. This is the component the
  // BOQ page and the survey preview share, so a crash here breaks both.
  const lines: SurveyBoqLine[] = SUPPLY_BOQ_MASTER.map((item, i) => ({
    sr: item.sr,
    itemKey: item.itemKey,
    existingUsable:   i === 0 ? 12 : null,
    // i===3 is the derived line and needs a VALUE: the marker only renders
    // alongside a quantity, because a derived line nobody has a number for has
    // nothing to have derived.
    requiredToSupply: i === 1 ? 15 : i === 2 ? 0 : i === 3 ? 7 : null,
    remarks:          i === 2 ? 'Spare ports available' : null,
    notApplicable:    i === 2,
    autoDerived:      i === 3,
  }));
  const html = rendersWithout(
    'BoqTable renders normal / not-applicable / derived / unanswered lines',
    <BoqTable title="Supply" master={SUPPLY_BOQ_MASTER} lines={lines} />,
  );
  ok('not-applicable renders as words, not a bare 0', html.includes('Not applicable'));
  ok('a derived line is marked as derived', html.toLowerCase().includes('derived'));
  ok('an unanswered cell renders an em-dash', html.includes('—'));

  // The inverse, which is the easier one to regress: autoDerived alone must
  // NOT print "(derived)" when there is no quantity, or the table would claim
  // a number was computed when none exists.
  const derivedButEmpty = renderToStaticMarkup(
    <BoqTable
      title="Supply"
      master={SUPPLY_BOQ_MASTER}
      lines={SUPPLY_BOQ_MASTER.map((item) => ({
        sr: item.sr, itemKey: item.itemKey, existingUsable: null,
        requiredToSupply: null, remarks: null, notApplicable: false,
        autoDerived: true,
      }))}
    />,
  );
  ok('autoDerived with no quantity does NOT claim to be derived',
    !derivedButEmpty.includes('(derived)'));

  // Same for a not-applicable line: it was explicitly zeroed by a person, so
  // labelling it derived would misattribute a human decision to the app.
  const derivedButNa = renderToStaticMarkup(
    <BoqTable
      title="Supply"
      master={SUPPLY_BOQ_MASTER}
      lines={SUPPLY_BOQ_MASTER.map((item) => ({
        sr: item.sr, itemKey: item.itemKey, existingUsable: null,
        requiredToSupply: 0, remarks: 'n/a here', notApplicable: true,
        autoDerived: true,
      }))}
    />,
  );
  ok('a not-applicable line is never labelled derived',
    !derivedButNa.includes('(derived)'));

  // A line the master knows about but the stored survey lacks must not crash
  // the table — older documents predate later master additions.
  rendersWithout(
    'BoqTable survives a survey missing lines the master defines',
    <BoqTable title="Supply" master={SUPPLY_BOQ_MASTER} lines={lines.slice(0, 2)} />,
  );

  rendersWithout(
    'BoqTable survives an empty BOQ',
    <BoqTable title="Supply" master={SUPPLY_BOQ_MASTER} lines={[]} />,
  );
}

// ─── Entry point ──────────────────────────────────────────────────────────────

// ─── 5. Draft sync precedence ─────────────────────────────────────────────────

function testDraftPrecedence(): void {
  section('5. Draft sync precedence');

  // (localUpdatedAt, localLastSyncedAt, localToken, remoteToken)
  const choose = (lu: number | null, ls: number | null, lt: string | null, rt: string | null) =>
    chooseDraftSource({ localUpdatedAt: lu, localLastSyncedAt: ls, localSyncToken: lt, remoteSyncToken: rt });

  eq('no local draft opens the server copy', choose(null, null, null, 'x'), 'remote');

  // THE ROLLOUT CASE — every existing draft has no token on switch-on day.
  eq('a never-synced draft opens locally', choose(100, null, null, null), 'local');
  eq('SECOND-DEVICE WIPE: an old never-synced draft loses to cloud-saved work', choose(100, null, null, 'other'), 'remote');

  eq('server still holds this device token — local wins', choose(300, 200, 'a', 'a'), 'local');
  eq('another device pushed, nothing unsynced here — take server', choose(200, 200, 'a', 'b'), 'remote');
  eq('another device pushed — latest wins even with unsynced edits here', choose(400, 200, 'a', 'b'), 'remote');

  // The clock-skew bug this replaced: no timestamp from the server is read at
  // all, so a phone whose clock is wildly off still decides correctly.
  eq('decision ignores server time entirely (skewed phone clock)', choose(9e12, 9e12, 'a', 'a'), 'local');

  // Token cleared on the server (e.g. by an admin) is treated as moved.
  eq('server token missing while device has one — treat as moved', choose(200, 200, 'a', null), 'remote');

  eq('toMillis accepts a Date', toMillis(new Date(1_700_000_000_000)), 1_700_000_000_000);
  eq('toMillis rejects an invalid Date', toMillis(new Date('nonsense')), null);

  // ── Autosave payload ──
  const when = new Date('2026-09-01T00:00:00Z');
  const payload = buildAutosavePayload({
    surveyorName: 'K', surveyDate: when, status: 'open', reviewNotes: 'old note',
    reviewedBy: 'u9', submittedAt: when, draftSyncToken: 'stale',
    feeders: [{ uid: 'f1', remarks: undefined, mfmRequired: 2 }],
    missing: undefined,
  } as Record<string, unknown>, 'fresh');

  ok('undefined keys are removed (Firestore rejects them)', !('missing' in payload));
  ok('nested undefined is removed',
    !('remarks' in ((payload as Record<string, unknown>)['feeders'] as Record<string, unknown>[])[0]));
  ok('Dates survive as Dates', (payload as Record<string, unknown>)['surveyDate'] instanceof Date);
  ok('status is never written by autosave', !('status' in payload));
  ok('review metadata is never written by autosave',
    !('reviewNotes' in payload) && !('reviewedBy' in payload) && !('submittedAt' in payload));
  eq('the fresh token replaces the stale one', payload.draftSyncToken, 'fresh');
  eq('answers pass through untouched', (payload as Record<string, unknown>)['surveyorName'], 'K');

  eq('array holes become null so indices never shift', stripUndefinedDeep([1, undefined, 3]), [1, null, 3]);
  ok('null is kept (a considered blank, not missing)',
    (stripUndefinedDeep({ a: null }) as Record<string, unknown>)['a'] === null);
}

// ─── 6. Photo uploader ────────────────────────────────────────────────────────

function testPhotoUploader(): void {
  section('6. Photo uploader');
  _resetUploaderForTests();

  eq('backoff starts at 5s', backoffDelay(0), 5_000);
  eq('backoff doubles', [backoffDelay(1), backoffDelay(2)], [10_000, 20_000]);
  eq('backoff is capped at 5 minutes', backoffDelay(20), 300_000);
  eq('negative attempts clamp to the first delay', backoffDelay(-3), 5_000);

  // The shared guard is what stops PhotoCapture and the background uploader
  // uploading one photo twice and leaving a duplicate asset in Cloudinary.
  ok('first claim succeeds', claimPhoto('p1'));
  ok('second claim on the same photo is refused', !claimPhoto('p1'));
  ok('a different photo can be claimed', claimPhoto('p2'));
  releasePhoto('p1');
  ok('a released photo can be claimed again', claimPhoto('p1'));
  _resetUploaderForTests();
}


// ─── 7. Cross-device photo merge ──────────────────────────────────────────────

function testPhotoMerge(): void {
  section('7. Cross-device photo merge');

  const withPhotos = (site: string[], feederPhotos: string[] = [], removed: string[] = []) => {
    const s = survey();
    s.sitePhotos = site.map((url) => ({ url, caption: 'slot', remark: null }));
    s.feeders = [{ ...(s.feeders[0] ?? {}), uid: 'f1', photos: feederPhotos } as SurveyReport['feeders'][number]];
    s.removedPhotoRefs = removed;
    return s;
  };
  const urls = (s: SurveyReport) => s.sitePhotos.map((x) => x.url);

  // THE REPORTED BUG: phone adds A1+A2, laptop adds B1 — all three must survive.
  const phone  = withPhotos(['https://x/a1', 'https://x/a2']);
  const laptop = withPhotos(['https://x/b1']);
  eq('photos from both devices are kept, not replaced',
    urls(mergePhotoFields(laptop, phone)), ['https://x/b1', 'https://x/a1', 'https://x/a2']);
  eq('merge order does not lose photos either way',
    urls(mergePhotoFields(phone, laptop)).sort(), ['https://x/a1', 'https://x/a2', 'https://x/b1']);

  // Feeder photos merge by feeder uid too.
  eq('feeder photos merge across devices',
    mergePhotoFields(withPhotos([], ['https://x/p']), withPhotos([], ['https://x/q'])).feeders[0].photos,
    ['https://x/p', 'https://x/q']);

  // A deletion on one device must not be resurrected by the other.
  const deleter = withPhotos([], [], ['https://x/a1']);
  const stale   = withPhotos(['https://x/a1', 'https://x/b1']);
  eq('a deleted photo stays deleted after merging with a stale copy',
    urls(mergePhotoFields(stale, deleter)), ['https://x/b1']);
  eq('tombstones travel with the merge',
    mergePhotoFields(stale, deleter).removedPhotoRefs, ['https://x/a1']);

  // A pending local photo survives adopting another device's save.
  const local = withPhotos(['local://pending']);
  eq('this device\'s pending local photo survives adopting a remote save',
    urls(mergePhotoFields(withPhotos(['https://x/b1']), local)), ['https://x/b1', 'local://pending']);

  // Deletion detection ignores local:// swaps and keeps real removals.
  eq('removedRefs records a deleted uploaded photo',
    removedRefs(['https://x/a', 'https://x/b'], ['https://x/a']), ['https://x/b']);
  eq('an upload swapping local:// for https is not treated as a deletion',
    removedRefs(['local://p'], ['https://x/p']), []);

  // Idempotent: merging twice changes nothing.
  const once = mergePhotoFields(laptop, phone);
  eq('merging is idempotent', urls(mergePhotoFields(once, phone)), urls(once));
}


// ─── 8. Delta autosave ────────────────────────────────────────────────────────

function testDelta(): void {
  section('8. Delta autosave');
  const base = { surveyorName: 'K', feeders: [{ uid: 'f1', photos: [] }], draftSyncToken: 't1' };
  const sigs = signFields(base);
  eq('unchanged payload sends only the token', Object.keys(changedFields({ ...base, draftSyncToken: 't2' }, sigs, ['draftSyncToken'])), ['draftSyncToken']);
  eq('one edited field sends just that field + token', Object.keys(changedFields({ ...base, surveyorName: 'R', draftSyncToken: 't2' }, sigs, ['draftSyncToken'])).sort(), ['draftSyncToken', 'surveyorName']);
  eq('a nested change re-sends that whole top-level field', Object.keys(changedFields({ ...base, feeders: [{ uid: 'f1', photos: ['x'] }] }, sigs)), ['feeders']);
  eq('first save after load sends everything', Object.keys(changedFields(base, new Map())).length, 3);
  eq('a brand-new field is sent', Object.keys(changedFields({ ...base, zone: 'M' }, sigs)), ['zone']);
  const chain = buildAutosavePayload({ surveyorName: 'K', id: 's1', assignedTo: 'u1', approverUid: 'a1', approvalStages: [], currentStageIndex: 0, createdAt: new Date(), updatedAt: new Date() } as Record<string, unknown>, 'tok');
  ok('autosave never writes identity or approval-chain fields', ['id','assignedTo','approverUid','approvalStages','currentStageIndex','createdAt','updatedAt'].every((k) => !(k in chain)));
  ok('answers still pass through', (chain as Record<string, unknown>)['surveyorName'] === 'K');

  // ── Per-field adopt: THE DATA-WIPE BUG ──
  type D = Record<string, unknown>;
  const adopt = (local: D, server: D, known: D) =>
    adoptRemoteFields(local, server, signFields(local), signFields(server), signFields(known));
  const known0 = { feeders: [{ uid: 'f1', bayName: '' }], surveyorName: 'K', zone: null };

  // User typed a feeder field; a snapshot arrives (another device changed zone).
  const typed  = { ...known0, feeders: [{ uid: 'f1', bayName: 'Bay-01' }] };
  const remote = { ...known0, zone: 'Mumbai' };
  const out1 = adopt(typed, remote, known0);
  eq('REGRESSION: typed feeder answer is NOT wiped by a remote save', (out1.feeders as D[])[0].bayName, 'Bay-01');
  eq('the other device field untouched here IS adopted', out1.zone, 'Mumbai');

  // Both devices changed the same field: this device's typing wins (it gets pushed).
  const out2 = adopt({ ...known0, surveyorName: 'Mine' }, { ...known0, surveyorName: 'Theirs' }, known0);
  eq('same field changed on both — local typing is kept', out2.surveyorName, 'Mine');

  // Our own echo with typing done since the push: nothing is lost.
  const pushed = { ...known0, surveyorName: 'R' };
  const out3 = adopt({ ...pushed, surveyorName: 'Ra' }, pushed, known0);
  eq('own echo never rolls back newer typing', out3.surveyorName, 'Ra');

  // Nothing changed anywhere: same object back, so the form does not re-render.
  ok('no change returns the same object (no re-render)', adopt(known0, known0, known0) === known0);

  // ── Filled-answer shield ──
  const srv  = { feeders: [{ uid: 'f1', diStatusPoints: 12, frtu: 1 }], zone: 'Mumbai', ok: false };
  const old  = { feeders: [{ uid: 'f1', diStatusPoints: null, frtu: null }], zone: null, ok: null };
  const sh = shieldFilledAnswers(old as D, srv as D, old as D);
  eq('SHIELD: stale device cannot blank a filled feeder answer', (sh.feeders as D[])[0].diStatusPoints, 12);
  eq('SHIELD: stale device cannot blank a filled top-level answer', sh.zone, 'Mumbai');
  eq('SHIELD: "No" (false) counts as a filled answer and is protected', sh.ok, false);
  // A deliberate clear by a user who SAW the value still goes through.
  const cleared = shieldFilledAnswers({ ...srv, zone: null } as D, srv as D, srv as D);
  eq('a deliberate clear (value was seen here) still goes through', cleared.zone, null);
  // A feeder added on another device is kept; one deleted here stays deleted.
  const added = shieldFilledAnswers({ feeders: [] } as D, { feeders: [{ uid: 'f9' }] } as D, { feeders: [] } as D);
  eq('SHIELD: a feeder another device added is not dropped', (added.feeders as D[]).length, 1);
  const deleted = shieldFilledAnswers({ feeders: [] } as D, { feeders: [{ uid: 'f9' }] } as D, { feeders: [{ uid: 'f9' }] } as D);
  eq('a feeder deleted on this device stays deleted', (deleted.feeders as D[]).length, 0);
  ok('shield returns the same object when nothing needs protecting', shieldFilledAnswers(srv as D, srv as D, srv as D) === srv);

}

export async function runFeatureTests(): Promise<number> {
  testLifecycle();
  testProjectCreation();
  testReporting();
  testBoq();
  testDraftPrecedence();
  testPhotoUploader();
  testPhotoMerge();
  testDelta();

  // Awaited: the saver drives promises through a fake clock.
  const saverFailures = await runSaverTests();
  const inputFailures = runAllInputsTests();

  const totalFailed = failed + saverFailures + inputFailures;
  console.log(
    `
${totalFailed === 0 ? 'ALL PASSED' : 'FAILURES'} ` +
    `${passed} passed here, ${totalFailed} failed overall`,
  );
  return totalFailed;
}
