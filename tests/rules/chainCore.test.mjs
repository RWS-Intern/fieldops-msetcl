/**
 * Phase 1 verification for the three-level approval chain rules.
 *
 * Part A — READ scope: a past-stage owner keeps read, never gains write;
 *          legacy documents with no approvalStageOwnerUids stay readable.
 * Part B — WRITE integrity: the live stage owner can perform exactly the three
 *          well-formed transitions and nothing else. In particular the
 *          route-to-self and forge-another-stage exploits are refused.
 */
import fs from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, collection, getDocs, query, where } from 'firebase/firestore';

const [host, portStr] = (process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080').split(':');
const testEnv = await initializeTestEnvironment({
  projectId: 'demo-chain-phase1',
  firestore: { rules: fs.readFileSync(process.argv[2], 'utf8'), host, port: Number(portStr) },
});

let pass = 0; const fail = [];
const allow = async (l, fn) => { try { await assertSucceeds(fn()); pass++; } catch (e) { fail.push(`ALLOW-EXPECTED but DENIED: ${l} :: ${e.message}`); } };
const deny  = async (l, fn) => { try { await assertFails(fn());    pass++; } catch (e) { fail.push(`DENY-EXPECTED but ALLOWED: ${l} :: ${e.message}`); } };

// ── Stage fixtures ───────────────────────────────────────────────────────────
const stage = (owner, status, extra = {}) => ({
  stageKey:      `stage_${owner}`,
  stageLabel:    `Stage ${owner}`,
  status,
  ownerUid:      owner,
  ownerName:     owner.toUpperCase(),
  reviewNotes:   null,
  attachmentUrl: null,
  actedAt:       null,
  ...extra,
});

// live = 0 (a1 owns, nothing approved yet)
const CHAIN_AT_0 = [stage('a1', 'pending'),  stage('a2', 'pending'),  stage('a3', 'pending')];
// live = 1 (a2 owns, a1 already approved)
const CHAIN_AT_1 = [stage('a1', 'approved'), stage('a2', 'pending'),  stage('a3', 'pending')];
// live = 2 (a3 owns, a1 + a2 approved) — the final stage
const CHAIN_AT_2 = [stage('a1', 'approved'), stage('a2', 'approved'), stage('a3', 'pending')];

const OWNERS = ['a1', 'a2', 'a3'];

await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  for (const [id, role] of [['admin1','admin'],['eng1','field'],['a1','approver'],['a2','approver'],['a3','approver'],['a4','approver']]) {
    await setDoc(doc(db, 'users', id), { role, active: true, name: id });
  }

  const mk = (stages, live, owner) => ({
    assignedTo: 'eng1',
    approverUid: owner, approverName: owner.toUpperCase(),
    approvalStages: stages, currentStageIndex: live,
    approvalStageOwnerUids: OWNERS,
    status: 'pending_approval', archived: false, bays: [],
  });

  for (const c of ['workOrders', 'surveyReports']) {
    await setDoc(doc(db, `${c}/wo_first`), mk(CHAIN_AT_0, 0, 'a1'));  // a1 live
    await setDoc(doc(db, `${c}/wo_mid`),   mk(CHAIN_AT_1, 1, 'a2'));  // a2 live
    await setDoc(doc(db, `${c}/wo_last`),  mk(CHAIN_AT_2, 2, 'a3'));  // a3 live (final)
    // Pre-chain document: single approver, NO chain fields at all.
    await setDoc(doc(db, `${c}/legacy`), {
      assignedTo: 'eng1', approverUid: 'a1', approverName: 'A1',
      status: 'pending_approval', archived: false,
    });
  }
});

const as = (uid) => testEnv.authenticatedContext(uid).firestore();
const a1 = as('a1'), a2 = as('a2'), a3 = as('a3'), a4 = as('a4');

const now = () => new Date();
/** A chain array with only index `i` replaced — the legitimate shape. */
const withStageActed = (chain, i, status) =>
  chain.map((s, j) => (j === i ? { ...s, status, reviewNotes: 'ok', actedAt: now() } : s));

for (const c of ['workOrders', 'surveyReports']) {
  // ══ Part A — READ scope (unchanged from the first pass) ═══════════════════
  await allow(`${c}: PAST stage owner (a1) can GET`,      () => getDoc(doc(a1, `${c}/wo_mid`)));
  await allow(`${c}: LIVE stage owner (a2) can GET`,      () => getDoc(doc(a2, `${c}/wo_mid`)));
  await allow(`${c}: FUTURE stage owner (a3) can GET`,     () => getDoc(doc(a3, `${c}/wo_mid`)));
  await deny (`${c}: non-owner approver (a4) cannot GET`,  () => getDoc(doc(a4, `${c}/wo_mid`)));
  await allow(`${c}: a1 LIST via array-contains(approvalStageOwnerUids)`,
    () => getDocs(query(collection(a1, c), where('approvalStageOwnerUids', 'array-contains', 'a1'))));
  await deny (`${c}: a1 unfiltered LIST still refused`,    () => getDocs(collection(a1, c)));
  await allow(`${c}: legacy doc readable by its approverUid (a1)`, () => getDoc(doc(a1, `${c}/legacy`)));
  await deny (`${c}: legacy doc NOT readable by a3`,               () => getDoc(doc(a3, `${c}/legacy`)));

  // Non-live owners still cannot write at all.
  const anyTransition = {
    status: 'pending_approval', approvalStages: withStageActed(CHAIN_AT_1, 1, 'approved'),
    currentStageIndex: 2, approverUid: 'a3', approverName: 'A3', updatedAt: now(),
  };
  await deny(`${c}: PAST stage owner (a1) CANNOT update wo_mid`,   () => updateDoc(doc(a1, `${c}/wo_mid`), anyTransition));
  await deny(`${c}: FUTURE stage owner (a3) CANNOT update wo_mid`, () => updateDoc(doc(a3, `${c}/wo_mid`), anyTransition));
  await deny(`${c}: non-owner (a4) CANNOT update wo_mid`,          () => updateDoc(doc(a4, `${c}/wo_mid`), anyTransition));

  // ══ Part B — WRITE integrity, exploits first ═════════════════════════════

  // ▸ EXPLOIT 1: a1 approves their own stage but routes the chain back to
  //   THEMSELVES. a1 is a member of approvalStageOwnerUids, which is why the
  //   "in approvalStageOwnerUids" check was insufficient.
  await deny(`${c}: EXPLOIT a1 approves stage 1 routing approverUid to SELF`,
    () => updateDoc(doc(a1, `${c}/wo_first`), {
      status: 'pending_approval',
      approvalStages: withStageActed(CHAIN_AT_0, 0, 'approved'),
      currentStageIndex: 1,
      approverUid: 'a1', approverName: 'A1',   // ← self, not stage 2's owner a2
      updatedAt: now(),
    }));

  // ▸ EXPLOIT 2: a1 approves their own stage AND forges the FINAL stage's entry.
  await deny(`${c}: EXPLOIT a1 approves stage 1 while forging approvalStages[2]`,
    () => updateDoc(doc(a1, `${c}/wo_first`), {
      status: 'pending_approval',
      approvalStages: [
        { ...CHAIN_AT_0[0], status: 'approved', actedAt: now() },
        CHAIN_AT_0[1],
        { ...CHAIN_AT_0[2], status: 'approved', actedAt: now() },   // ← forged
      ],
      currentStageIndex: 1,
      approverUid: 'a2', approverName: 'A2',
      updatedAt: now(),
    }));

  // ▸ EXPLOIT 3: forging an EARLIER stage's approval (a2 rewriting a1's entry).
  await deny(`${c}: EXPLOIT a2 rewrites the already-approved approvalStages[0]`,
    () => updateDoc(doc(a2, `${c}/wo_mid`), {
      status: 'pending_approval',
      approvalStages: [
        { ...CHAIN_AT_1[0], reviewNotes: 'tampered' },   // ← a1's entry altered
        { ...CHAIN_AT_1[1], status: 'approved', actedAt: now() },
        CHAIN_AT_1[2],
      ],
      currentStageIndex: 2, approverUid: 'a3', approverName: 'A3', updatedAt: now(),
    }));

  // ▸ EXPLOIT 4: skipping a stage (jump straight from live 0 to index 2 / a3).
  await deny(`${c}: EXPLOIT a1 skips stage 2 entirely (index 0 -> 2)`,
    () => updateDoc(doc(a1, `${c}/wo_first`), {
      status: 'pending_approval',
      approvalStages: withStageActed(CHAIN_AT_0, 0, 'approved'),
      currentStageIndex: 2, approverUid: 'a3', approverName: 'A3', updatedAt: now(),
    }));

  // ▸ EXPLOIT 5: marking the whole survey approved from a NON-final stage.
  await deny(`${c}: EXPLOIT a1 marks survey fully approved from stage 1`,
    () => updateDoc(doc(a1, `${c}/wo_first`), {
      status: 'approved',
      approvalStages: withStageActed(CHAIN_AT_0, 0, 'approved'),
      currentStageIndex: 3, approverUid: null, approverName: null, updatedAt: now(),
    }));

  // ▸ EXPLOIT 6: advancing without touching the stage array at all.
  await deny(`${c}: EXPLOIT a1 advances approverUid with no stage entry written`,
    () => updateDoc(doc(a1, `${c}/wo_first`), {
      status: 'pending_approval', currentStageIndex: 1,
      approverUid: 'a1', approverName: 'A1', updatedAt: now(),
    }));

  // ▸ Stage-owner list stays admin-only.
  await deny(`${c}: a2 CANNOT rewrite approvalStageOwnerUids`,
    () => updateDoc(doc(a2, `${c}/wo_mid`), {
      status: 'changes_requested', approvalStageOwnerUids: ['a2'], updatedAt: now(),
    }));

  // ══ Part B — the LEGITIMATE transitions must all still work ══════════════

  // ▸ THE key case: a1 approves stage 1 correctly — approverUid -> a2 (stage 2's
  //   real owner), only approvalStages[0] changed, index advances by exactly 1.
  await allow(`${c}: LEGIT a1 approves stage 1 -> hands to a2, only stages[0] changed`,
    () => updateDoc(doc(a1, `${c}/wo_first`), {
      status: 'pending_approval',
      approvalStages: withStageActed(CHAIN_AT_0, 0, 'approved'),
      currentStageIndex: 1,
      approverUid: 'a2', approverName: 'A2',
      updatedAt: now(),
    }));

  // ▸ Final-stage approval: chain complete, owner cleared.
  await allow(`${c}: LEGIT a3 approves the FINAL stage -> approved, approverUid null`,
    () => updateDoc(doc(a3, `${c}/wo_last`), {
      status: 'approved',
      approvalStages: withStageActed(CHAIN_AT_2, 2, 'approved'),
      currentStageIndex: 3,
      approverUid: null, approverName: null,
      updatedAt: now(),
    }));

  // ▸ v2: a stage ABOVE Level 1 requesting changes does NOT reach the field. It
  //   starts the escalation cascade — one stage DOWN, direction backward, and
  //   the top-level status deliberately stays pending_approval.
  await allow(`${c}: LEGIT a2 requests changes -> cascades DOWN to a1, dir backward`,
    () => updateDoc(doc(a2, `${c}/wo_mid`), {
      status: 'pending_approval',
      approvalStages: withStageActed(CHAIN_AT_1, 1, 'changes_requested'),
      currentStageIndex: 0,
      approverUid: 'a1', approverName: 'A1',
      reviewDirection: 'backward',
      updatedAt: now(),
    }));

  // ▸ And the pre-v2 shape it replaces must now be REFUSED: a mid-chain stage
  //   may no longer send work straight to the field.
  await deny(`${c}: a2 requests changes the OLD way (straight to the field)`,
    () => updateDoc(doc(a2, `${c}/wo_mid`), {
      status: 'changes_requested',
      approvalStages: withStageActed(CHAIN_AT_1, 1, 'changes_requested'),
      currentStageIndex: 1,
      approverUid: 'a2', approverName: 'A2',
      updatedAt: now(),
    }));

  // ▸ Request changes must NOT be usable to move ownership.
  await deny(`${c}: a2 requests changes but tries to hand off to a3`,
    () => updateDoc(doc(a2, `${c}/wo_mid`), {
      status: 'changes_requested',
      approvalStages: withStageActed(CHAIN_AT_1, 1, 'changes_requested'),
      currentStageIndex: 1, approverUid: 'a3', approverName: 'A3', updatedAt: now(),
    }));

  // ▸ Pre-chain document: its single approver can still act, because the write
  //   touches no chain field (proves `true || <error>` absorbs the missing field).
  await allow(`${c}: LEGIT legacy doc approver (a1) can still act (no chain fields)`,
    () => updateDoc(doc(a1, `${c}/legacy`), { status: 'approved', updatedAt: now() }));

  // ▸ ...but cannot invent a chain transition on it.
  await deny(`${c}: legacy doc approver CANNOT write chain fields`,
    () => updateDoc(doc(a1, `${c}/legacy`), {
      status: 'pending_approval', currentStageIndex: 1, approverUid: 'a2', updatedAt: now(),
    }));

  // ▸ The hasOnly fence still holds independently of the new checks.
  await deny(`${c}: a2 CANNOT write a field outside the allowlist (bays)`,
    () => updateDoc(doc(a2, `${c}/wo_mid`), {
      status: 'changes_requested', bays: [{ uid: 'x' }], updatedAt: now(),
    }));
  await deny(`${c}: a2 CANNOT move to an engineer-owned status (in_progress)`,
    () => updateDoc(doc(a2, `${c}/wo_mid`), { status: 'in_progress', updatedAt: now() }));
}

await testEnv.cleanup();
console.log(`\n${pass} assertions passed, ${fail.length} failed`);
if (fail.length) { console.log('FAILURES:'); fail.forEach((f) => console.log('  - ' + f)); process.exit(1); }
console.log('ALL APPROVAL-CHAIN RULE ASSERTIONS PASSED');
