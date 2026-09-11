/**
 * Phase 3: resume-at-flagging-stage, using the EXACT write payloads
 * useSurveyActions now sends (reviewSurvey / submitSurvey).
 *
 * Walk: a1 approves stage 1 -> a2 requests changes -> engineer resubmits ->
 * lands back on stage 2 (not stage 1) -> a2 approves -> a3 approves.
 * Stage 1's original approval must survive every step untouched.
 */
import fs from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';

const [host, portStr] = (process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080').split(':');
const testEnv = await initializeTestEnvironment({
  projectId: 'demo-chain-roundtrip',
  firestore: { rules: fs.readFileSync(process.argv[2], 'utf8'), host, port: Number(portStr) },
});

let pass = 0; const fail = [];
const allow = async (l, fn) => { try { await assertSucceeds(fn()); pass++; console.log(`  ok   ${l}`); } catch (e) { fail.push(`ALLOW-EXPECTED but DENIED: ${l} :: ${e.message}`); } };
const deny  = async (l, fn) => { try { await assertFails(fn());    pass++; console.log(`  ok   ${l} (denied)`); } catch (e) { fail.push(`DENY-EXPECTED but ALLOWED: ${l} :: ${e.message}`); } };
const check = (l, cond) => { if (cond) { pass++; console.log(`  ok   ${l}`); } else fail.push(`ASSERT FAILED: ${l}`); };

const STAGES = [
  { key: 'approver_level_1', label: 'Approver Level 1' },
  { key: 'approver_level_2', label: 'Approver Level 2' },
  { key: 'final_approver',   label: 'Final Approver' },
];
const OWNERS = [{ uid: 'a1', name: 'One' }, { uid: 'a2', name: 'Two' }, { uid: 'a3', name: 'Three' }];

await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  for (const [id, role] of [['eng1','field'],['a1','approver'],['a2','approver'],['a3','approver']]) {
    await setDoc(doc(db, 'users', id), { role, active: true, name: id });
  }
  const created = {
    workOrderCode: 'WO-X-SURVEY-01', siteId: 's1', siteCode: 'X', siteName: 'X',
    stage: 'survey', status: 'pending_approval',
    assignedTo: 'eng1', assignedToName: 'Eng',
    approverUid: 'a1', approverName: 'One',
    approvalStages: STAGES.map((s, i) => ({
      stageKey: s.key, stageLabel: s.label, status: 'pending',
      ownerUid: OWNERS[i].uid, ownerName: OWNERS[i].name,
      reviewNotes: null, attachmentUrl: null, actedAt: null,
    })),
    currentStageIndex: 0,
    approvalStageOwnerUids: ['a1','a2','a3'],
    archived: false, bays: [], reviewNotes: null,
  };
  await setDoc(doc(db, 'workOrders/wo1'),    created);
  await setDoc(doc(db, 'surveyReports/wo1'), created);
});

const as = (uid) => testEnv.authenticatedContext(uid).firestore();
const eng1 = as('eng1'), a1 = as('a1'), a2 = as('a2'), a3 = as('a3');

async function readDoc(c) {
  let out;
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    out = (await getDoc(doc(ctx.firestore(), `${c}/wo1`))).data();
  });
  return out;
}

/** Mirrors useSurveyActions.reviewSurvey exactly. */
function reviewPayloads(stored, decision, notes, attachmentUrl) {
  const stages = stored.approvalStages;
  const live   = stored.currentStageIndex;
  const reviewNotes = (decision === 'request_changes' || decision === 'agree')
    ? notes : (notes || null);


  // ── v2 transition table ────────────────────────────────────────────────────
  // Keyed on the direction the chain was travelling BEFORE this write, exactly
  // as firestore.rules keys isValidStageTransition. Decisions:
  //   forward : 'approve' | 'request_changes'
  //   backward: 'agree'   | 'disagree'
  const dir  = stored.reviewDirection ?? 'forward';
  const last = stages.length - 1;

  const toField   = { status: 'changes_requested', currentStageIndex: 0,
                      approverUid: stages[0].ownerUid, approverName: stages[0].ownerName,
                      reviewDirection: 'forward' };
  const complete  = { status: 'approved', currentStageIndex: stages.length,
                      approverUid: null, approverName: null, reviewDirection: 'forward' };
  const up = (d) => ({ status: 'pending_approval', currentStageIndex: live + 1,
                       approverUid: stages[live + 1].ownerUid,
                       approverName: stages[live + 1].ownerName, reviewDirection: d });
  const down = (d) => ({ status: 'pending_approval', currentStageIndex: live - 1,
                         approverUid: stages[live - 1].ownerUid,
                         approverName: stages[live - 1].ownerName, reviewDirection: d });

  const advance =
    dir === 'forward'
      ? (decision === 'approve'
          ? (live === last ? complete : up('forward'))
          // Level 1 has nothing below it, so its flag goes straight to the
          // field; any higher stage starts the escalation cascade instead.
          : (live === 0 ? toField : down('backward')))
      : (decision === 'agree'
          ? (live === 0 ? toField : down('backward'))
          // DISAGREE returns the chain to 'forward': the bounced-to stage's
          // next action is then an ordinary forward transition.
          : up('forward'));

  // What this reviewer records against their OWN stage.
  const ownStatus =
    dir === 'forward' ? (decision === 'approve' ? 'approved' : 'changes_requested')
                      : (decision === 'agree'   ? 'changes_requested' : 'approved');

  const approvalStages = stages.map((s, i) => {
    if (i === live) {
      return { ...s, status: ownStatus, reviewNotes,
               attachmentUrl: attachmentUrl ?? null, actedAt: new Date() };
    }
    // A Disagree is the ONE write that also touches another index: the stage it
    // bounces back up to is reset so its owner must reconsider.
    if (dir === 'backward' && decision === 'disagree' && i === live + 1) {
      return { ...s, status: 'pending', reviewNotes: null, attachmentUrl: null, actedAt: null };
    }
    return s;
  });

  return {
    survey: { ...advance, approvalStages, reviewNotes,
              reviewedBy: 'x', reviewedByName: 'x', reviewedAt: new Date(), updatedAt: new Date() },
    workOrder: { ...advance, approvalStages, updatedAt: new Date() },
  };
}

/** Mirrors submitSurvey — chain fields are stripped by UNWRITABLE_KEYS. */
const submitPayload = () => ({
  status: 'pending_approval',
  submittedBy: 'eng1', submittedByName: 'Eng',
  submittedAt: new Date(), updatedAt: new Date(),
  bays: [{ uid: 'b1', bayNumber: '1' }],
});

console.log('\n── stage 1: a1 approves ──');
for (const [c, db] of [['workOrders', a1], ['surveyReports', a1]]) {
  const stored = await readDoc(c);
  const p = reviewPayloads(stored, 'approve', '', 'https://res.cloudinary.com/x/raw/upload/note.pdf');
  await allow(`${c}: a1 approves stage 1 (with attachment)`,
    () => updateDoc(doc(db, `${c}/wo1`), c === 'workOrders' ? p.workOrder : p.survey));
}
const afterS1 = await readDoc('surveyReports');
check('index advanced to 1', afterS1.currentStageIndex === 1);
check('approverUid handed to a2', afterS1.approverUid === 'a2');
check('doc still pending_approval', afterS1.status === 'pending_approval');
check('stage 1 recorded approved', afterS1.approvalStages[0].status === 'approved');
check('stage 1 attachment stored', !!afterS1.approvalStages[0].attachmentUrl);

console.log('\n── stage 2: a2 requests changes -> CASCADES DOWN to a1 ──');
for (const [c, db] of [['workOrders', a2], ['surveyReports', a2]]) {
  const stored = await readDoc(c);
  const p = reviewPayloads(stored, 'request_changes', 'Fix bay 3 DI count', null);
  await allow(`${c}: a2 requests changes`,
    () => updateDoc(doc(db, `${c}/wo1`), c === 'workOrders' ? p.workOrder : p.survey));
}
const afterRC = await readDoc('surveyReports');
check('field does NOT see it yet (status still pending_approval)', afterRC.status === 'pending_approval');
check('index cascaded DOWN to 0', afterRC.currentStageIndex === 0);
check('approverUid handed DOWN to a1', afterRC.approverUid === 'a1');
check('direction is now backward', afterRC.reviewDirection === 'backward');
check('stage 2 entry marked changes_requested', afterRC.approvalStages[1].status === 'changes_requested');

console.log('\n── a1 AGREES -> the flag finally reaches the field ──');
for (const [c, db] of [['workOrders', a1], ['surveyReports', a1]]) {
  const stored = await readDoc(c);
  const p = reviewPayloads(stored, 'agree', 'Agreed, bay 3 is wrong', null);
  await allow(`${c}: a1 agrees at Level 1`,
    () => updateDoc(doc(db, `${c}/wo1`), c === 'workOrders' ? p.workOrder : p.survey));
}
const afterAgree = await readDoc('surveyReports');
check('NOW the field sees it', afterAgree.status === 'changes_requested');
check('direction reset to forward', afterAgree.reviewDirection === 'forward');
check('stage 1 also flagged by the agreeing reviewer',
  afterAgree.approvalStages[0].status === 'changes_requested');

console.log('\n── engineer resubmits (chain fields never sent) ──');
for (const c of ['workOrders', 'surveyReports']) {
  await allow(`${c}: eng1 resubmits`, () => updateDoc(doc(eng1, `${c}/wo1`), submitPayload()));
}
const afterResubmit = await readDoc('surveyReports');
check('doc back to pending_approval', afterResubmit.status === 'pending_approval');
check('RESTARTS AT LEVEL 1, not the flagging stage', afterResubmit.currentStageIndex === 0);
check('owned by a1 again', afterResubmit.approverUid === 'a1');
check('direction is forward', (afterResubmit.reviewDirection ?? 'forward') === 'forward');
check('engineer did not reset ANY stage entry (rules pin approvalStages)',
  afterResubmit.approvalStages[1].status === 'changes_requested'
  && afterResubmit.approvalStages[0].status === 'changes_requested');

console.log('\n── a2 must NOT be able to act after the restart ──');
for (const c of ['workOrders', 'surveyReports']) {
  await deny(`${c}: a2 cannot act — the restart handed the chain back to a1`,
    () => updateDoc(doc(a2, `${c}/wo1`), { status: 'changes_requested', updatedAt: new Date() }));
}

console.log('\n── second pass: a1 approves, then a2 approves ──');
for (const [c, db] of [['workOrders', a1], ['surveyReports', a1]]) {
  const stored = await readDoc(c);
  const p = reviewPayloads(stored, 'approve', '', null);
  await allow(`${c}: a1 approves on the second pass`,
    () => updateDoc(doc(db, `${c}/wo1`), c === 'workOrders' ? p.workOrder : p.survey));
}
for (const [c, db] of [['workOrders', a2], ['surveyReports', a2]]) {
  const stored = await readDoc(c);
  const p = reviewPayloads(stored, 'approve', '', null);
  await allow(`${c}: a2 approves on the second pass`,
    () => updateDoc(doc(db, `${c}/wo1`), c === 'workOrders' ? p.workOrder : p.survey));
}
const afterS2 = await readDoc('surveyReports');
check('index advanced to 2', afterS2.currentStageIndex === 2);
check('approverUid handed to a3', afterS2.approverUid === 'a3');
check('stage 2 now approved (overwrote changes_requested)', afterS2.approvalStages[1].status === 'approved');
check('stage 1 re-approved on the second pass', afterS2.approvalStages[0].status === 'approved');

console.log('\n── stage 3 (final): a3 approves, chain completes ──');
for (const [c, db] of [['workOrders', a3], ['surveyReports', a3]]) {
  const stored = await readDoc(c);
  const p = reviewPayloads(stored, 'approve', '', null);
  await allow(`${c}: a3 approves the final stage`,
    () => updateDoc(doc(db, `${c}/wo1`), c === 'workOrders' ? p.workOrder : p.survey));
}
const done = await readDoc('surveyReports');
check('doc status approved', done.status === 'approved');
check('currentStageIndex == chain length', done.currentStageIndex === 3);
check('approverUid cleared', done.approverUid === null);
check('all three stages approved', done.approvalStages.every((s) => s.status === 'approved'));
check('direction ended forward', (done.reviewDirection ?? 'forward') === 'forward');

await testEnv.cleanup();
console.log(`\n${pass} assertions passed, ${fail.length} failed`);
if (fail.length) { console.log('FAILURES:'); fail.forEach((f) => console.log('  - ' + f)); process.exit(1); }
console.log('CHAIN ROUND TRIP (v2 restart-at-Level-1) PASSED');
