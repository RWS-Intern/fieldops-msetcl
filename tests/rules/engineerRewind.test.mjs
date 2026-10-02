/**
 * The engineer branch must not rewind a review that is already under way.
 *
 * WHY THIS EXISTS: the duplicate-submit investigation found that the engineer
 * branch of the surveyReports/workOrders update rules constrains only
 * `request.resource.data.status` (the value being written) and never
 * `resource.data.status` (the value already stored). isChainRestart likewise
 * checks six things, none of them the survey's status or stage BEFORE the
 * write. A stale submit — an offline queue item drained hours late, an old
 * cached bundle, or a direct API call — therefore satisfied every condition
 * and reset a chain that had already moved on, because submitSurvey copies
 * `approvalStages` verbatim from the live document and so trivially passes the
 * byte-equality check.
 *
 * Payloads here are HAND-WRITTEN to mirror exactly what submitSurvey and
 * saveProgress write. App code is deliberately not imported: doing so pulls a
 * second copy of the Firestore SDK into the process and every ref built here
 * is rejected with "Type does not match the expected instance".
 *
 * Run: node engineerRewind.test.mjs ../../firestore.rules
 */
import fs from 'node:fs';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc } from 'firebase/firestore';

const [host, portStr] = (process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080').split(':');
const testEnv = await initializeTestEnvironment({
  projectId: 'demo-engineer-rewind',
  firestore: { rules: fs.readFileSync(process.argv[2], 'utf8'), host, port: Number(portStr) },
});

let pass = 0; const fail = [];
const allow = async (l, fn) => {
  try { await assertSucceeds(fn()); pass++; console.log(`  ok   ALLOW  ${l}`); }
  catch (e) { fail.push(`ALLOW expected but DENIED: ${l} :: ${e.message}`); console.log(`  FAIL ALLOW  ${l}`); }
};
const deny = async (l, fn) => {
  try { await assertFails(fn()); pass++; console.log(`  ok   DENY   ${l}`); }
  catch { fail.push(`DENY expected but ALLOWED: ${l}`); console.log(`  FAIL DENY   ${l}  <-- accepted today`); }
};

const OWNER = { 0: 'a1', 1: 'a2', 2: 'a3' };
const NAME  = { 0: 'A1', 1: 'A2', 2: 'A3' };
const stage = (i, status) => ({
  stageKey: ['level1', 'level2', 'final'][i],
  stageLabel: ['Approver Level 1', 'Approver Level 2', 'Final Approver'][i],
  status, ownerUid: OWNER[i], ownerName: NAME[i],
  reviewNotes: null, attachmentUrl: null, actedAt: null,
});
const stages = (s0, s1, s2) => [stage(0, s0), stage(1, s1), stage(2, s2)];
const ALL_PENDING = stages('pending', 'pending', 'pending');

await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  for (const [id, role] of [['f1', 'field'], ['a1', 'approver'], ['a2', 'approver'], ['a3', 'approver']]) {
    await setDoc(doc(db, 'users', id), { role, active: true, name: id });
  }
});

let seq = 0;
/** Seeds a surveyReports + workOrders pair in the same state, returns its id. */
async function seed({ live, dir, status, chain }) {
  const id = `s-${seq++}`;
  const body = {
    workOrderId: id, siteId: 'site-1', siteCode: 'SUB-001', siteName: 'Test S/S',
    workOrderCode: 'WO-001', stage: 'survey',
    assignedTo: 'f1', assignedToName: 'F1',
    approverUid: live === 3 ? null : OWNER[live],
    approverName: live === 3 ? null : NAME[live],
    approvalStages: chain, currentStageIndex: live,
    approvalStageOwnerUids: ['a1', 'a2', 'a3'],
    reviewDirection: dir, status, updatedAt: new Date(),
  };
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const d = ctx.firestore();
    await setDoc(doc(d, `surveyReports/${id}`), body);
    await setDoc(doc(d, `workOrders/${id}`), body);
  });
  return id;
}

// ONE context, reused. Calling authenticatedContext().firestore() per
// assertion re-applies emulator settings to an already-started instance,
// which throws 'settings can no longer be changed'.
const engDb = testEnv.authenticatedContext('f1').firestore();
const eng = () => engDb;

/**
 * Exactly what submitSurvey writes: the chain restarted at Level 1, with
 * approvalStages copied VERBATIM from the live document (which is what makes
 * isChainRestart's byte-equality check pass even mid-review).
 */
const submitPayload = (chain) => ({
  siteCode: 'SUB-001',
  approvalStages: chain, currentStageIndex: 0,
  approverUid: OWNER[0], approverName: NAME[0],
  reviewDirection: 'forward',
  status: 'pending_approval',
  submittedBy: 'f1', submittedByName: 'F1',
  submittedAt: new Date(), updatedAt: new Date(),
});
/** An answer-only edit: no chain field mentioned at all. */
const contentOnly = (status) => ({ siteCode: 'EDITED', status, updatedAt: new Date() });

const submitS = (id, chain) => updateDoc(doc(eng(), `surveyReports/${id}`), submitPayload(chain));
const submitW = (id, chain) => updateDoc(doc(eng(), `workOrders/${id}`),    submitPayload(chain));

// ── Step 1: states the engineer must NOT be able to write from ───────────────

console.log('\n(a) submit against a survey mid-review — Level 1 approved, live stage 2');
{
  const midReview = stages('approved', 'pending', 'pending');
  const id = await seed({ live: 1, dir: 'forward', status: 'pending_approval', chain: midReview });
  await deny('surveyReports: rewind to Level 1 from an in-progress review', () => submitS(id, midReview));
  await deny('workOrders:    rewind to Level 1 from an in-progress review', () => submitW(id, midReview));
}

console.log('\n(b) submit during a BACKWARD escalation');
{
  const esc = stages('pending', 'changes_requested', 'pending');
  const id = await seed({ live: 0, dir: 'backward', status: 'pending_approval', chain: esc });
  await deny('surveyReports: rewind during an escalation', () => submitS(id, esc));
  await deny('workOrders:    rewind during an escalation', () => submitW(id, esc));
}

console.log('\n(c) submit against an APPROVED survey (chain complete)');
{
  const done = stages('approved', 'approved', 'approved');
  const id = await seed({ live: 3, dir: 'forward', status: 'approved', chain: done });
  await deny('surveyReports: reopen a fully approved survey', () => submitS(id, done));
  await deny('workOrders:    reopen a fully approved work order', () => submitW(id, done));
}

console.log('\n(e) ANSWER-ONLY edits while under review / after approval');
{
  const midReview = stages('approved', 'pending', 'pending');
  const a = await seed({ live: 1, dir: 'forward', status: 'pending_approval', chain: midReview });
  await deny('mid-review: edit answers, keep status pending_approval',
    () => updateDoc(doc(eng(), `surveyReports/${a}`), contentOnly('pending_approval')));
  await deny('mid-review: edit answers, drop status to in_progress',
    () => updateDoc(doc(eng(), `surveyReports/${a}`), contentOnly('in_progress')));

  const esc = stages('pending', 'changes_requested', 'pending');
  const b = await seed({ live: 0, dir: 'backward', status: 'pending_approval', chain: esc });
  await deny('escalation: edit answers, keep status pending_approval',
    () => updateDoc(doc(eng(), `surveyReports/${b}`), contentOnly('pending_approval')));

  const done = stages('approved', 'approved', 'approved');
  const c = await seed({ live: 3, dir: 'forward', status: 'approved', chain: done });
  await deny('approved: edit answers, set status in_progress',
    () => updateDoc(doc(eng(), `surveyReports/${c}`), contentOnly('in_progress')));
  await deny('approved: edit answers, set status pending_approval',
    () => updateDoc(doc(eng(), `surveyReports/${c}`), contentOnly('pending_approval')));
}

// ── Legitimate paths that MUST keep working ──────────────────────────────────

console.log('\nlegitimate: first submit from every state the engineer owns');
for (const from of ['open', 'in_progress', 'changes_requested']) {
  const id = await seed({ live: 0, dir: 'forward', status: from, chain: ALL_PENDING });
  await allow(`surveyReports: submit from "${from}"`, () => submitS(id, ALL_PENDING));
  const id2 = await seed({ live: 0, dir: 'forward', status: from, chain: ALL_PENDING });
  await allow(`workOrders:    submit from "${from}"`, () => submitW(id2, ALL_PENDING));
}

console.log('\nlegitimate: resubmit restart after changes_requested at a higher stage');
{
  // Level 2 sent it back to the field: live stage is 1, status changes_requested.
  const sentBack = stages('approved', 'changes_requested', 'pending');
  const id = await seed({ live: 1, dir: 'forward', status: 'changes_requested', chain: sentBack });
  await allow('surveyReports: resubmit restarts the chain at Level 1', () => submitS(id, sentBack));
  const id2 = await seed({ live: 1, dir: 'forward', status: 'changes_requested', chain: sentBack });
  await allow('workOrders:    resubmit restarts the chain at Level 1', () => submitW(id2, sentBack));
}

console.log('\nlegitimate: saveProgress and the open -> in_progress transition');
{
  const p = await seed({ live: 0, dir: 'forward', status: 'in_progress', chain: ALL_PENDING });
  await allow('saveProgress: in_progress -> in_progress, answers only',
    () => updateDoc(doc(eng(), `surveyReports/${p}`), contentOnly('in_progress')));

  const o = await seed({ live: 0, dir: 'forward', status: 'open', chain: ALL_PENDING });
  await allow('open -> in_progress',
    () => updateDoc(doc(eng(), `surveyReports/${o}`), contentOnly('in_progress')));
  const ow = await seed({ live: 0, dir: 'forward', status: 'open', chain: ALL_PENDING });
  await allow('workOrders: open -> in_progress',
    () => updateDoc(doc(eng(), `workOrders/${ow}`), contentOnly('in_progress')));

  const c = await seed({ live: 0, dir: 'forward', status: 'changes_requested', chain: ALL_PENDING });
  await allow('changes_requested -> in_progress',
    () => updateDoc(doc(eng(), `surveyReports/${c}`), contentOnly('in_progress')));
}

console.log(`\n${pass} passed, ${fail.length} failed`);
fail.forEach((f) => console.log(`  - ${f}`));
await testEnv.cleanup();
process.exit(fail.length === 0 ? 0 : 1);
