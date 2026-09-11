/**
 * Phase 4: every updates/ snapshot carries the stage it belonged to.
 *
 * Drives the full round trip with the EXACT payloads useSurveyActions writes
 * (submit → stage 1 approve → stage 2 request-changes → resubmit → stage 2
 * approve), then reads the subcollection back and asserts the stage label each
 * entry would render in the History section — including the resubmission.
 */
import fs from 'node:fs';
import { initializeTestEnvironment, assertSucceeds } from '@firebase/rules-unit-testing';
import {
  doc, getDoc, setDoc, updateDoc, collection, getDocs, query, orderBy, writeBatch,
} from 'firebase/firestore';

const [host, portStr] = (process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080').split(':');
const testEnv = await initializeTestEnvironment({
  projectId: 'demo-chain-audit',
  firestore: { rules: fs.readFileSync(process.argv[2], 'utf8'), host, port: Number(portStr) },
});

let pass = 0; const fail = [];
const allow = async (l, fn) => { try { await assertSucceeds(fn()); pass++; console.log(`  ok   ${l}`); } catch (e) { fail.push(`ALLOW-EXPECTED but DENIED: ${l} :: ${e.message}`); } };
const check = (l, cond) => { if (cond) { pass++; console.log(`  ok   ${l}`); } else fail.push(`ASSERT FAILED: ${l}`); };

// Mirrors src/lib/approvalStages.ts
const STAGES = [
  { key: 'approver_level_1', label: 'Approver Level 1' },
  { key: 'approver_level_2', label: 'Approver Level 2' },
  { key: 'final_approver',   label: 'Final Approver' },
];
const OWNERS = [{ uid: 'a1', name: 'One' }, { uid: 'a2', name: 'Two' }, { uid: 'a3', name: 'Three' }];

// Mirrors src/lib/approvalStages.ts findApprovalStage
const findApprovalStage = (key) => STAGES.find((s) => s.key === key);
/** Mirrors historyStageLabel() in ApproverSurveyReviewPage.tsx. */
function historyStageLabel(update, stages) {
  if (typeof update.stageIndex === 'number' && stages[update.stageIndex]) {
    return stages[update.stageIndex].stageLabel;
  }
  if (update.stageKey) return findApprovalStage(update.stageKey)?.label ?? null;
  return null;
}

await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  for (const [id, role] of [['eng1','field'],['a1','approver'],['a2','approver'],['a3','approver']]) {
    await setDoc(doc(db, 'users', id), { role, active: true, name: id });
  }
  const created = {
    workOrderCode: 'WO-X-SURVEY-01', siteId: 's1', siteCode: 'X', siteName: 'X',
    stage: 'survey', status: 'in_progress',
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
const eng1 = as('eng1'), a1 = as('a1'), a2 = as('a2');

async function readSurvey() {
  let out;
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    out = (await getDoc(doc(ctx.firestore(), 'surveyReports/wo1'))).data();
  });
  return out;
}

const UNWRITABLE = new Set([
  'id','workOrderId','siteId','assignedTo','assignedToName','approverUid','approverName',
  'approvalStages','currentStageIndex','approvalStageOwnerUids','createdAt','updatedAt',
]);

/** Mirrors useSurveyActions.resolveSubmittedStage. */
function resolveSubmittedStage(data) {
  const index = data.currentStageIndex;
  if (typeof index !== 'number' || index < 0) return { stageKey: null, stageIndex: null };
  return { stageKey: data.approvalStages?.[index]?.stageKey ?? null, stageIndex: index };
}

/** Mirrors useSurveyActions.submitSurvey, including the updates snapshot. */
async function submitSurvey(db, fullSurveyData) {
  const safeData = Object.fromEntries(
    Object.entries(fullSurveyData).filter(([k]) => !UNWRITABLE.has(k)),
  );
  const { stageKey, stageIndex } = resolveSubmittedStage(fullSurveyData);

  const batch = writeBatch(db);
  batch.update(doc(db, 'surveyReports/wo1'), {
    ...safeData, status: 'pending_approval',
    submittedBy: 'eng1', submittedByName: 'Eng',
    submittedAt: new Date(), updatedAt: new Date(),
  });
  batch.update(doc(db, 'workOrders/wo1'), { status: 'pending_approval', updatedAt: new Date() });
  batch.set(doc(collection(db, 'surveyReports/wo1/updates')), {
    action: 'submit', actorUid: 'eng1', actorName: 'Eng',
    createdAt: new Date(), stageKey, stageIndex, payload: safeData,
  });
  await batch.commit();
}

/** Mirrors useSurveyActions.reviewSurvey, including the updates snapshot. */
async function reviewSurvey(db, stored, decision, notes) {
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
    if (i === live) return { ...s, status: ownStatus, reviewNotes, attachmentUrl: null, actedAt: new Date() };
    if (dir === 'backward' && decision === 'disagree' && i === live + 1) {
      return { ...s, status: 'pending', reviewNotes: null, attachmentUrl: null, actedAt: null };
    }
    return s;
  });

  const batch = writeBatch(db);
  batch.update(doc(db, 'surveyReports/wo1'), {
    ...advance, approvalStages, reviewNotes,
    reviewedBy: 'x', reviewedByName: 'x', reviewedAt: new Date(), updatedAt: new Date(),
  });
  batch.update(doc(db, 'workOrders/wo1'), { ...advance, approvalStages, updatedAt: new Date() });
  batch.set(doc(collection(db, 'surveyReports/wo1/updates')), {
    action: decision, actorUid: 'x', actorName: 'x', createdAt: new Date(),
    stageKey: stages[live].stageKey, stageIndex: live,
    ...(decision === 'request_changes' || decision === 'agree' ? { reviewNotes } : {}),
  });
  await batch.commit();
}

console.log('\n── round trip ──');
await allow('1. eng1 submits (stage 1 live)', async () => submitSurvey(eng1, await readSurvey()));
await allow('2. a1 approves stage 1',          async () => reviewSurvey(a1, await readSurvey(), 'approve', ''));
await allow('3. a2 requests changes (cascades DOWN to a1)',
  async () => reviewSurvey(a2, await readSurvey(), 'request_changes', 'Fix bay 3'));
await allow('4. a1 AGREES -> reaches the field',
  async () => reviewSurvey(a1, await readSurvey(), 'agree', 'Agreed'));
await allow('5. eng1 RESUBMITS (restarts at Level 1)',
  async () => submitSurvey(eng1, await readSurvey()));
await allow('6. a1 approves on second pass',   async () => reviewSurvey(a1, await readSurvey(), 'approve', ''));
await allow('7. a2 approves on second pass',   async () => reviewSurvey(a2, await readSurvey(), 'approve', ''));

console.log('\n── History section, as rendered ──');
let entries;
await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const snap = await getDocs(query(collection(ctx.firestore(), 'surveyReports/wo1/updates'), orderBy('createdAt', 'asc')));
  entries = snap.docs.map((d) => d.data());
});
const stages = (await readSurvey()).approvalStages;

check('exactly 7 history entries', entries.length === 7);
const rendered = entries.map((e) => ({
  action: e.action,
  stageIndex: e.stageIndex,
  label: historyStageLabel(e, stages),
}));
rendered.forEach((r, i) => console.log(`  ${i + 1}. ${r.action.padEnd(16)} stageIndex=${r.stageIndex}  label="${r.label}"`));

const expected = [
  ['submit',          0, 'Approver Level 1'],
  ['approve',         0, 'Approver Level 1'],
  ['request_changes', 1, 'Approver Level 2'],   // ← starts the cascade
  ['agree',           0, 'Approver Level 1'],   // ← Level 1 agrees; reaches the field
  ['submit',          0, 'Approver Level 1'],   // ← the resubmission, now at Level 1
  ['approve',         0, 'Approver Level 1'],
  ['approve',         1, 'Approver Level 2'],
];
expected.forEach(([action, idx, label], i) => {
  check(`entry ${i + 1}: ${action} tagged "${label}"`,
    rendered[i].action === action && rendered[i].stageIndex === idx && rendered[i].label === label);
});
check('EVERY entry has a stage label (none blank)', rendered.every((r) => !!r.label));
check('RESUBMISSION tagged Level 1 — the chain restarts there now',
  rendered[4].action === 'submit' && rendered[4].label === 'Approver Level 1');
check('the cascade step is tagged with the AGREEING stage, not the flagging one',
  rendered[3].action === 'agree' && rendered[3].stageIndex === 0);

console.log('\n── pre-chain survey degrades to no label, not a wrong one ──');
await testEnv.withSecurityRulesDisabled(async (ctx) => {
  await setDoc(doc(ctx.firestore(), 'surveyReports/wo1/updates/legacy'), {
    action: 'submit', actorUid: 'eng1', actorName: 'Eng', createdAt: new Date(),
    stageKey: null, stageIndex: null,
  });
});
check('null stage renders no label (not "Approver Level 1")',
  historyStageLabel({ stageKey: null, stageIndex: null }, stages) === null);
check('an entry with only stageKey still resolves a label',
  historyStageLabel({ stageKey: 'final_approver' }, stages) === 'Final Approver');

await testEnv.cleanup();
console.log(`\n${pass} assertions passed, ${fail.length} failed`);
if (fail.length) { console.log('FAILURES:'); fail.forEach((f) => console.log('  - ' + f)); process.exit(1); }
console.log('CHAIN AUDIT TRAIL (v2) PASSED');
