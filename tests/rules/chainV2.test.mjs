/**
 * Approval chain v2 — bidirectional escalation cascade.
 *
 * Proves the four transition shapes keyed on reviewDirection, the one narrow
 * exception that lets a Disagree write an index other than the live one, the
 * engineer's restart-at-Level-1 resubmission, and the admin jump — plus the
 * exploit attempts specific to the new mechanic.
 *
 * Run with `npm run test:rules:chain` from the repo root, which starts the
 * emulator around it. Companion to rules.test.mjs, not a replacement.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  initializeTestEnvironment, assertFails, assertSucceeds,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';

const RULES_PATH = process.argv[2]
  ? path.resolve(process.cwd(), process.argv[2])
  : fileURLToPath(new URL('../../firestore.rules', import.meta.url));
const [host, portStr] = (process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080').split(':');

const testEnv = await initializeTestEnvironment({
  projectId: 'demo-chain-v2',
  firestore: { rules: fs.readFileSync(RULES_PATH, 'utf8'), host, port: Number(portStr) },
});

let pass = 0;
const failures = [];

async function expectAllowed(label, fn) {
  try { await assertSucceeds(fn()); pass++; }
  catch (e) { failures.push(`ALLOW-EXPECTED but DENIED: ${label} :: ${e.message}`); }
}
async function expectDenied(label, fn) {
  try { await assertFails(fn()); pass++; }
  catch (e) { failures.push(`DENY-EXPECTED but ALLOWED: ${label} :: ${e.message}`); }
}
function check(label, cond, extra = '') {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else failures.push(`STATE-CHECK FAILED: ${label} ${extra}`);
}

// ── Chain fixtures ───────────────────────────────────────────────────────────
// Three fixed stages: a1 = Approver Level 1, a2 = Level 2, a3 = Final.

const OWNER = { 0: 'a1', 1: 'a2', 2: 'a3' };
const NAME  = { 0: 'A1', 1: 'A2', 2: 'A3' };

function stage(i, status) {
  return {
    stageKey: ['level1', 'level2', 'final'][i],
    stageLabel: ['Approver Level 1', 'Approver Level 2', 'Final Approver'][i],
    status,
    ownerUid: OWNER[i],
    ownerName: NAME[i],
    reviewNotes: null,
    attachmentUrl: null,
    actedAt: null,
  };
}
const stages = (s0, s1, s2) => [stage(0, s0), stage(1, s1), stage(2, s2)];

function surveyDoc({ live, dir, status, chain }) {
  return {
    workOrderId: 'wo-1', siteId: 'site-1', siteCode: 'SUB-001', siteName: 'Test S/S',
    workOrderCode: 'WO-001',
    assignedTo: 'f1', assignedToName: 'F1',
    approverUid: live === 3 ? null : OWNER[live],
    approverName: live === 3 ? null : NAME[live],
    approvalStages: chain,
    currentStageIndex: live,
    approvalStageOwnerUids: ['a1', 'a2', 'a3'],
    reviewDirection: dir,
    status,
    updatedAt: new Date(),
  };
}

let seq = 0;
async function seed(state) {
  const id = `sv-${seq++}`;
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), `surveyReports/${id}`), surveyDoc(state));
  });
  return id;
}
async function readRaw(id) {
  let data;
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    data = (await getDoc(doc(ctx.firestore(), `surveyReports/${id}`))).data();
  });
  return data;
}
const as = (uid) => testEnv.authenticatedContext(uid).firestore();

await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  await setDoc(doc(db, 'users/admin1'), { role: 'admin', active: true, name: 'Ad' });
  await setDoc(doc(db, 'users/f1'),  { role: 'field',    active: true, name: 'F1' });
  await setDoc(doc(db, 'users/a1'),  { role: 'approver', active: true, name: 'A1' });
  await setDoc(doc(db, 'users/a2'),  { role: 'approver', active: true, name: 'A2' });
  await setDoc(doc(db, 'users/a3'),  { role: 'approver', active: true, name: 'A3' });
});

// ═══ A. Forward transitions ══════════════════════════════════════════════════
console.log('\n── A. forward transitions ──');
{
  let id = await seed({ live: 0, dir: 'forward', status: 'pending_approval', chain: stages('pending','pending','pending') });
  await expectAllowed('F1 L1 approves -> stage 2, owner a2', () =>
    updateDoc(doc(as('a1'), `surveyReports/${id}`), {
      status: 'pending_approval', currentStageIndex: 1, approverUid: 'a2', approverName: 'A2',
      reviewDirection: 'forward',
      approvalStages: stages('approved','pending','pending'), updatedAt: new Date(),
    }));

  id = await seed({ live: 2, dir: 'forward', status: 'pending_approval', chain: stages('approved','approved','pending') });
  await expectAllowed('F2 Final approves -> complete, nobody owns it', () =>
    updateDoc(doc(as('a3'), `surveyReports/${id}`), {
      status: 'approved', currentStageIndex: 3, approverUid: null, approverName: null,
      reviewDirection: 'forward',
      approvalStages: stages('approved','approved','approved'), updatedAt: new Date(),
    }));

  id = await seed({ live: 0, dir: 'forward', status: 'pending_approval', chain: stages('pending','pending','pending') });
  await expectAllowed('F3 L1 requests changes -> straight to the field', () =>
    updateDoc(doc(as('a1'), `surveyReports/${id}`), {
      status: 'changes_requested', currentStageIndex: 0, approverUid: 'a1', approverName: 'A1',
      reviewDirection: 'forward',
      approvalStages: stages('changes_requested','pending','pending'), updatedAt: new Date(),
    }));

  id = await seed({ live: 2, dir: 'forward', status: 'pending_approval', chain: stages('approved','approved','pending') });
  await expectAllowed('F4 Final rejects -> cascade begins, down to a2, dir backward', () =>
    updateDoc(doc(as('a3'), `surveyReports/${id}`), {
      status: 'pending_approval', currentStageIndex: 1, approverUid: 'a2', approverName: 'A2',
      reviewDirection: 'backward',
      approvalStages: stages('approved','approved','changes_requested'), updatedAt: new Date(),
    }));

  id = await seed({ live: 1, dir: 'forward', status: 'pending_approval', chain: stages('approved','pending','pending') });
  await expectAllowed('F4 L2 rejects -> cascade down to a1, dir backward', () =>
    updateDoc(doc(as('a2'), `surveyReports/${id}`), {
      status: 'pending_approval', currentStageIndex: 0, approverUid: 'a1', approverName: 'A1',
      reviewDirection: 'backward',
      approvalStages: stages('approved','changes_requested','pending'), updatedAt: new Date(),
    }));

  // Exploits on the forward side.
  id = await seed({ live: 2, dir: 'forward', status: 'pending_approval', chain: stages('approved','approved','pending') });
  await expectDenied('F4 must NOT surface to the field early (status changes_requested)', () =>
    updateDoc(doc(as('a3'), `surveyReports/${id}`), {
      status: 'changes_requested', currentStageIndex: 1, approverUid: 'a2', approverName: 'A2',
      reviewDirection: 'backward',
      approvalStages: stages('approved','approved','changes_requested'), updatedAt: new Date(),
    }));

  await expectDenied('F4 without setting dir backward', () =>
    updateDoc(doc(as('a3'), `surveyReports/${id}`), {
      status: 'pending_approval', currentStageIndex: 1, approverUid: 'a2', approverName: 'A2',
      reviewDirection: 'forward',
      approvalStages: stages('approved','approved','changes_requested'), updatedAt: new Date(),
    }));

  id = await seed({ live: 0, dir: 'forward', status: 'pending_approval', chain: stages('pending','pending','pending') });
  await expectDenied('F1 routing the survey to SELF', () =>
    updateDoc(doc(as('a1'), `surveyReports/${id}`), {
      status: 'pending_approval', currentStageIndex: 1, approverUid: 'a1', approverName: 'A1',
      reviewDirection: 'forward',
      approvalStages: stages('approved','pending','pending'), updatedAt: new Date(),
    }));

  await expectDenied('F1 skipping a stage (0 -> 2)', () =>
    updateDoc(doc(as('a1'), `surveyReports/${id}`), {
      status: 'pending_approval', currentStageIndex: 2, approverUid: 'a3', approverName: 'A3',
      reviewDirection: 'forward',
      approvalStages: stages('approved','pending','pending'), updatedAt: new Date(),
    }));
}

// ═══ B. Backward transitions ═════════════════════════════════════════════════
console.log('\n── B. backward transitions ──');
{
  let id = await seed({ live: 0, dir: 'backward', status: 'pending_approval', chain: stages('pending','changes_requested','pending') });
  await expectAllowed('B1 L1 agrees -> NOW it reaches the field, dir resets forward', () =>
    updateDoc(doc(as('a1'), `surveyReports/${id}`), {
      status: 'changes_requested', currentStageIndex: 0, approverUid: 'a1', approverName: 'A1',
      reviewDirection: 'forward',
      approvalStages: stages('changes_requested','changes_requested','pending'), updatedAt: new Date(),
    }));

  id = await seed({ live: 0, dir: 'backward', status: 'pending_approval', chain: stages('pending','changes_requested','pending') });
  await expectDenied('B1 must reset dir to forward, not leave it backward', () =>
    updateDoc(doc(as('a1'), `surveyReports/${id}`), {
      status: 'changes_requested', currentStageIndex: 0, approverUid: 'a1', approverName: 'A1',
      reviewDirection: 'backward',
      approvalStages: stages('changes_requested','changes_requested','pending'), updatedAt: new Date(),
    }));

  id = await seed({ live: 1, dir: 'backward', status: 'pending_approval', chain: stages('pending','pending','changes_requested') });
  await expectAllowed('B2 L2 agrees -> flag passes further down to a1', () =>
    updateDoc(doc(as('a2'), `surveyReports/${id}`), {
      status: 'pending_approval', currentStageIndex: 0, approverUid: 'a1', approverName: 'A1',
      reviewDirection: 'backward',
      approvalStages: stages('pending','changes_requested','changes_requested'), updatedAt: new Date(),
    }));

  id = await seed({ live: 1, dir: 'backward', status: 'pending_approval', chain: stages('pending','pending','changes_requested') });
  await expectDenied('B2 must NOT surface to the field mid-cascade', () =>
    updateDoc(doc(as('a2'), `surveyReports/${id}`), {
      status: 'changes_requested', currentStageIndex: 0, approverUid: 'a1', approverName: 'A1',
      reviewDirection: 'backward',
      approvalStages: stages('pending','changes_requested','changes_requested'), updatedAt: new Date(),
    }));

  // B3 — Disagree, the one transition that writes liveIndex + 1.
  id = await seed({ live: 1, dir: 'backward', status: 'pending_approval', chain: stages('pending','pending','changes_requested') });
  await expectAllowed('B3 L2 disagrees -> bounce up to a3, stage 2 reset, dir flips forward', () =>
    updateDoc(doc(as('a2'), `surveyReports/${id}`), {
      status: 'pending_approval', currentStageIndex: 2, approverUid: 'a3', approverName: 'A3',
      reviewDirection: 'forward',
      approvalStages: stages('pending','approved','pending'), updatedAt: new Date(),
    }));

  id = await seed({ live: 1, dir: 'backward', status: 'pending_approval', chain: stages('pending','pending','changes_requested') });
  await expectDenied('B3 leaving the direction backward (the removed B4 shape)', () =>
    updateDoc(doc(as('a2'), `surveyReports/${id}`), {
      status: 'pending_approval', currentStageIndex: 2, approverUid: 'a3', approverName: 'A3',
      reviewDirection: 'backward',
      approvalStages: stages('pending','approved','pending'), updatedAt: new Date(),
    }));

  id = await seed({ live: 1, dir: 'backward', status: 'pending_approval', chain: stages('pending','pending','changes_requested') });
  await expectDenied('B3 WITHOUT resetting stage 2 to pending', () =>
    updateDoc(doc(as('a2'), `surveyReports/${id}`), {
      status: 'pending_approval', currentStageIndex: 2, approverUid: 'a3', approverName: 'A3',
      reviewDirection: 'forward',
      approvalStages: stages('pending','approved','changes_requested'), updatedAt: new Date(),
    }));

  await expectDenied('B3 resetting stage 2 but hijacking its ownerUid', () =>
    updateDoc(doc(as('a2'), `surveyReports/${id}`), {
      status: 'pending_approval', currentStageIndex: 2, approverUid: 'a3', approverName: 'A3',
      reviewDirection: 'forward',
      approvalStages: [
        stage(0, 'pending'), stage(1, 'approved'),
        { ...stage(2, 'pending'), ownerUid: 'a2', ownerName: 'A2' },
      ],
      updatedAt: new Date(),
    }));

  id = await seed({ live: 0, dir: 'backward', status: 'pending_approval', chain: stages('pending','changes_requested','changes_requested') });
  await expectAllowed('B3 L1 disagrees -> bounce up to a2, stage 1 reset, dir flips forward', () =>
    updateDoc(doc(as('a1'), `surveyReports/${id}`), {
      status: 'pending_approval', currentStageIndex: 1, approverUid: 'a2', approverName: 'A2',
      reviewDirection: 'forward',
      approvalStages: stages('approved','pending','changes_requested'), updatedAt: new Date(),
    }));

  id = await seed({ live: 0, dir: 'backward', status: 'pending_approval', chain: stages('pending','changes_requested','changes_requested') });
  await expectDenied('B3 also corrupting a NON-adjacent index (stage 2)', () =>
    updateDoc(doc(as('a1'), `surveyReports/${id}`), {
      status: 'pending_approval', currentStageIndex: 1, approverUid: 'a2', approverName: 'A2',
      reviewDirection: 'forward',
      approvalStages: stages('approved','pending','approved'), updatedAt: new Date(),
    }));

  // After a Disagree the chain is 'forward' again, so the bounced-to stage's
  // next action is an ORDINARY forward transition — no special casing. These
  // two used to need a dedicated B4 branch; now they are plain F2 and F1.
  id = await seed({ live: 2, dir: 'forward', status: 'pending_approval', chain: stages('pending','approved','pending') });
  await expectAllowed('bounced-to Final reconsiders and approves -> complete (plain F2)', () =>
    updateDoc(doc(as('a3'), `surveyReports/${id}`), {
      status: 'approved', currentStageIndex: 3, approverUid: null, approverName: null,
      reviewDirection: 'forward',
      approvalStages: stages('pending','approved','approved'), updatedAt: new Date(),
    }));

  id = await seed({ live: 1, dir: 'forward', status: 'pending_approval', chain: stages('approved','pending','changes_requested') });
  await expectAllowed('bounced-to L2 reconsiders and approves -> on to a3 (plain F1)', () =>
    updateDoc(doc(as('a2'), `surveyReports/${id}`), {
      status: 'pending_approval', currentStageIndex: 2, approverUid: 'a3', approverName: 'A3',
      reviewDirection: 'forward',
      approvalStages: stages('approved','approved','changes_requested'), updatedAt: new Date(),
    }));

  id = await seed({ live: 2, dir: 'forward', status: 'pending_approval', chain: stages('approved','pending','pending') });
  await expectAllowed('bounced-to Final RE-REJECTS -> cascade restarts downward (plain F4)', () =>
    updateDoc(doc(as('a3'), `surveyReports/${id}`), {
      status: 'pending_approval', currentStageIndex: 1, approverUid: 'a2', approverName: 'A2',
      reviewDirection: 'backward',
      approvalStages: stages('approved','pending','changes_requested'), updatedAt: new Date(),
    }));
}

// ═══ C. Direction tampering ══════════════════════════════════════════════════
console.log('\n── C. direction tampering ──');
{
  let id = await seed({ live: 1, dir: 'forward', status: 'pending_approval', chain: stages('approved','pending','pending') });
  await expectDenied('setting reviewDirection alone, with no transition', () =>
    updateDoc(doc(as('a2'), `surveyReports/${id}`), {
      reviewDirection: 'backward', updatedAt: new Date(),
    }));

  await expectDenied('flipping direction while otherwise idling on the doc', () =>
    updateDoc(doc(as('a2'), `surveyReports/${id}`), {
      status: 'pending_approval', reviewDirection: 'backward', updatedAt: new Date(),
    }));

  id = await seed({ live: 1, dir: 'backward', status: 'pending_approval', chain: stages('pending','pending','changes_requested') });
  await expectDenied('a NON-live stage owner acting during a cascade', () =>
    updateDoc(doc(as('a3'), `surveyReports/${id}`), {
      status: 'pending_approval', currentStageIndex: 0, approverUid: 'a1', approverName: 'A1',
      reviewDirection: 'backward',
      approvalStages: stages('pending','changes_requested','changes_requested'), updatedAt: new Date(),
    }));
}

// ═══ D. Full cascade walkthroughs ════════════════════════════════════════════
console.log('\n── D. walkthrough 1: Final rejects -> L2 disagrees -> Final approves -> complete ──');
{
  const id = await seed({ live: 2, dir: 'forward', status: 'pending_approval', chain: stages('approved','approved','pending') });

  await expectAllowed('1. Final rejects', () =>
    updateDoc(doc(as('a3'), `surveyReports/${id}`), {
      status: 'pending_approval', currentStageIndex: 1, approverUid: 'a2', approverName: 'A2',
      reviewDirection: 'backward',
      approvalStages: stages('approved','approved','changes_requested'), updatedAt: new Date(),
    }));
  let d = await readRaw(id);
  check('   field does NOT see it yet (status still pending_approval)', d.status === 'pending_approval', d.status);

  await expectAllowed('2. L2 disagrees -> bounces back up to Final, dir flips forward', () =>
    updateDoc(doc(as('a2'), `surveyReports/${id}`), {
      status: 'pending_approval', currentStageIndex: 2, approverUid: 'a3', approverName: 'A3',
      reviewDirection: 'forward',
      approvalStages: stages('approved','approved','pending'), updatedAt: new Date(),
    }));
  d = await readRaw(id);
  check('   Final\'s stage is genuinely back to pending', d.approvalStages[2].status === 'pending', d.approvalStages[2].status);
  check('   L2 recorded as approved (found nothing wrong)', d.approvalStages[1].status === 'approved');
  check('   chain is travelling forward again', d.reviewDirection === 'forward', d.reviewDirection);

  await expectAllowed('3. Final reconsiders and APPROVES (ordinary F2) -> survey completes', () =>
    updateDoc(doc(as('a3'), `surveyReports/${id}`), {
      status: 'approved', currentStageIndex: 3, approverUid: null, approverName: null,
      reviewDirection: 'forward',
      approvalStages: stages('approved','approved','approved'), updatedAt: new Date(),
    }));
  d = await readRaw(id);
  check('   survey is approved and unowned', d.status === 'approved' && d.approverUid === null);
}

console.log('\n── D. walkthrough 2: Final rejects -> L2 agrees -> L1 disagrees -> L2 reconsiders -> agrees -> L1 agrees -> field ──');
{
  const id = await seed({ live: 2, dir: 'forward', status: 'pending_approval', chain: stages('approved','approved','pending') });

  await expectAllowed('1. Final rejects', () =>
    updateDoc(doc(as('a3'), `surveyReports/${id}`), {
      status: 'pending_approval', currentStageIndex: 1, approverUid: 'a2', approverName: 'A2',
      reviewDirection: 'backward',
      approvalStages: stages('approved','approved','changes_requested'), updatedAt: new Date(),
    }));

  await expectAllowed('2. L2 AGREES -> flag passes down to L1', () =>
    updateDoc(doc(as('a2'), `surveyReports/${id}`), {
      status: 'pending_approval', currentStageIndex: 0, approverUid: 'a1', approverName: 'A1',
      reviewDirection: 'backward',
      approvalStages: stages('approved','changes_requested','changes_requested'), updatedAt: new Date(),
    }));
  let d = await readRaw(id);
  check('   field still does NOT see it', d.status === 'pending_approval', d.status);

  await expectAllowed('3. L1 DISAGREES -> bounces back up to L2, dir flips forward', () =>
    updateDoc(doc(as('a1'), `surveyReports/${id}`), {
      status: 'pending_approval', currentStageIndex: 1, approverUid: 'a2', approverName: 'A2',
      reviewDirection: 'forward',
      approvalStages: stages('approved','pending','changes_requested'), updatedAt: new Date(),
    }));
  d = await readRaw(id);
  check('   L2\'s status is GENUINELY back to pending', d.approvalStages[1].status === 'pending', d.approvalStages[1].status);
  check('   L1 recorded as approved', d.approvalStages[0].status === 'approved');
  check('   Final\'s original flag is untouched history', d.approvalStages[2].status === 'changes_requested');
  check('   chain is travelling forward again', d.reviewDirection === 'forward', d.reviewDirection);

  await expectAllowed('4. L2 reconsiders and RE-REJECTS (ordinary F4) -> cascade restarts downward', () =>
    updateDoc(doc(as('a2'), `surveyReports/${id}`), {
      status: 'pending_approval', currentStageIndex: 0, approverUid: 'a1', approverName: 'A1',
      reviewDirection: 'backward',
      approvalStages: stages('approved','changes_requested','changes_requested'), updatedAt: new Date(),
    }));

  await expectAllowed('5. L1 AGREES -> the flag finally reaches the field', () =>
    updateDoc(doc(as('a1'), `surveyReports/${id}`), {
      status: 'changes_requested', currentStageIndex: 0, approverUid: 'a1', approverName: 'A1',
      reviewDirection: 'forward',
      approvalStages: stages('changes_requested','changes_requested','changes_requested'), updatedAt: new Date(),
    }));
  d = await readRaw(id);
  check('   field NOW sees it', d.status === 'changes_requested');
  check('   direction reset to forward', d.reviewDirection === 'forward');
}

// ═══ E. Engineer restart-at-Level-1 resubmission ═════════════════════════════
console.log('\n── E. engineer resubmission restarts the chain at Level 1 ──');
{
  const base = { live: 0, dir: 'forward', status: 'changes_requested',
                 chain: stages('changes_requested','changes_requested','changes_requested') };

  let id = await seed({ ...base, live: 2 });
  await expectAllowed('resubmit restarts at stage 0, owner a1', () =>
    updateDoc(doc(as('f1'), `surveyReports/${id}`), {
      status: 'pending_approval', currentStageIndex: 0, approverUid: 'a1', approverName: 'A1',
      reviewDirection: 'forward', updatedAt: new Date(),
    }));

  id = await seed({ ...base, live: 2 });
  await expectDenied('resubmit routing the survey to the engineer themselves', () =>
    updateDoc(doc(as('f1'), `surveyReports/${id}`), {
      status: 'pending_approval', currentStageIndex: 0, approverUid: 'f1', approverName: 'F1',
      reviewDirection: 'forward', updatedAt: new Date(),
    }));

  await expectDenied('resubmit restarting at stage 1 instead of 0', () =>
    updateDoc(doc(as('f1'), `surveyReports/${id}`), {
      status: 'pending_approval', currentStageIndex: 1, approverUid: 'a2', approverName: 'A2',
      reviewDirection: 'forward', updatedAt: new Date(),
    }));

  await expectDenied('resubmit while also rewriting approvalStages', () =>
    updateDoc(doc(as('f1'), `surveyReports/${id}`), {
      status: 'pending_approval', currentStageIndex: 0, approverUid: 'a1', approverName: 'A1',
      reviewDirection: 'forward',
      approvalStages: stages('pending','pending','pending'), updatedAt: new Date(),
    }));

  await expectDenied('resubmit forcing direction backward', () =>
    updateDoc(doc(as('f1'), `surveyReports/${id}`), {
      status: 'pending_approval', currentStageIndex: 0, approverUid: 'a1', approverName: 'A1',
      reviewDirection: 'backward', updatedAt: new Date(),
    }));

  id = await seed({ live: 1, dir: 'backward', status: 'pending_approval', chain: stages('pending','pending','changes_requested') });
  await expectDenied('engineer flipping direction on an ordinary save', () =>
    updateDoc(doc(as('f1'), `surveyReports/${id}`), {
      status: 'in_progress', reviewDirection: 'forward', updatedAt: new Date(),
    }));

  id = await seed({ live: 0, dir: 'forward', status: 'changes_requested', chain: stages('changes_requested','pending','pending') });
  await expectAllowed('ordinary engineer save touches no chain field', () =>
    updateDoc(doc(as('f1'), `surveyReports/${id}`), {
      status: 'in_progress', reviewNotes: null, updatedAt: new Date(),
    }));
}

// ═══ F. Admin jump ═══════════════════════════════════════════════════════════
console.log('\n── F. admin jump ──');
{
  let id = await seed({ live: 0, dir: 'forward', status: 'pending_approval', chain: stages('pending','pending','pending') });
  await expectAllowed('admin jumps a submitted survey straight to the Final stage', () =>
    updateDoc(doc(as('admin1'), `surveyReports/${id}`), {
      currentStageIndex: 2, approverUid: 'a3', approverName: 'A3',
      reviewDirection: 'forward',
      approvalStages: stages('pending','pending','pending'), updatedAt: new Date(),
    }));

  id = await seed({ live: 2, dir: 'backward', status: 'pending_approval', chain: stages('pending','pending','changes_requested') });
  await expectAllowed('admin jumps back down to Level 1, clearing the cascade', () =>
    updateDoc(doc(as('admin1'), `surveyReports/${id}`), {
      currentStageIndex: 0, approverUid: 'a1', approverName: 'A1',
      reviewDirection: 'forward',
      approvalStages: stages('pending','pending','changes_requested'), updatedAt: new Date(),
    }));

  id = await seed({ live: 0, dir: 'forward', status: 'pending_approval', chain: stages('pending','pending','pending') });
  await expectDenied('a NON-live stage owner attempting the admin jump', () =>
    updateDoc(doc(as('a3'), `surveyReports/${id}`), {
      currentStageIndex: 2, approverUid: 'a3', approverName: 'A3',
      reviewDirection: 'forward',
      approvalStages: stages('pending','pending','pending'), updatedAt: new Date(),
    }));

  await expectDenied('the live owner attempting an arbitrary jump (not a transition)', () =>
    updateDoc(doc(as('a1'), `surveyReports/${id}`), {
      currentStageIndex: 2, approverUid: 'a3', approverName: 'A3',
      reviewDirection: 'forward',
      approvalStages: stages('pending','pending','pending'), updatedAt: new Date(),
    }));

  await expectDenied('the assigned engineer attempting the admin jump', () =>
    updateDoc(doc(as('f1'), `surveyReports/${id}`), {
      currentStageIndex: 2, approverUid: 'a3', approverName: 'A3',
      reviewDirection: 'forward',
      approvalStages: stages('pending','pending','pending'), updatedAt: new Date(),
    }));
}

await testEnv.cleanup();
console.log(`\n${pass} assertions passed, ${failures.length} failed`);
if (failures.length) {
  console.log('FAILURES:');
  failures.forEach((f) => console.log('  - ' + f));
  process.exit(1);
}
console.log('CHAIN V2 CASCADE VERIFIED');
