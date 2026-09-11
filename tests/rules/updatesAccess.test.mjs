/**
 * surveyReports/{id}/updates access must match the PARENT's broadened read
 * scope: any past-or-present stage owner can read the History, while create
 * stays restricted to whoever holds the document right now.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, collection, getDocs } from 'firebase/firestore';

const [host, portStr] = (process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080').split(':');

// Rules file to test: argv[2] if given (resolved against the caller's cwd),
// otherwise the repo's own firestore.rules resolved relative to THIS file — so
// the suite runs correctly from the repo root or from tests/rules.
const RULES_PATH = process.argv[2]
  ? path.resolve(process.cwd(), process.argv[2])
  : fileURLToPath(new URL('../../firestore.rules', import.meta.url));
const testEnv = await initializeTestEnvironment({
  projectId: 'demo-updates-access',
  firestore: { rules: fs.readFileSync(RULES_PATH, 'utf8'), host, port: Number(portStr) },
});

let pass = 0; const fail = [];
const allow = async (l, fn) => { try { await assertSucceeds(fn()); pass++; console.log(`  ok   ${l}`); } catch (e) { fail.push(`ALLOW-EXPECTED but DENIED: ${l} :: ${e.message}`); } };
const deny  = async (l, fn) => { try { await assertFails(fn());    pass++; console.log(`  ok   ${l} (denied)`); } catch (e) { fail.push(`DENY-EXPECTED but ALLOWED: ${l} :: ${e.message}`); } };

const stage = (o, s) => ({
  stageKey: `stage_${o}`, stageLabel: `Stage ${o}`, status: s,
  ownerUid: o, ownerName: o.toUpperCase(),
  reviewNotes: null, attachmentUrl: null, actedAt: null,
});

await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  for (const [id, role] of [['admin1','admin'],['viewer1','viewer'],['eng1','field'],
                            ['a1','approver'],['a2','approver'],['a3','approver'],['a4','approver']]) {
    await setDoc(doc(db, 'users', id), { role, active: true, name: id });
  }
  // a1's stage has ALREADY CLEARED — a2 holds the document now.
  await setDoc(doc(db, 'surveyReports/wo1'), {
    assignedTo: 'eng1', approverUid: 'a2', approverName: 'A2',
    approvalStages: [stage('a1', 'approved'), stage('a2', 'pending'), stage('a3', 'pending')],
    currentStageIndex: 1,
    approvalStageOwnerUids: ['a1', 'a2', 'a3'],
    status: 'pending_approval',
  });
  await setDoc(doc(db, 'surveyReports/wo1/updates/u1'), {
    action: 'approve', actorUid: 'a1', actorName: 'A1',
    createdAt: new Date(), stageKey: 'stage_a1', stageIndex: 0,
  });

  // Pre-chain survey: single approver, no chain fields at all.
  await setDoc(doc(db, 'surveyReports/legacy'), {
    assignedTo: 'eng1', approverUid: 'a1', approverName: 'A1', status: 'pending_approval',
  });
  await setDoc(doc(db, 'surveyReports/legacy/updates/u1'), {
    action: 'submit', actorUid: 'eng1', actorName: 'Eng', createdAt: new Date(),
  });
});

const as = (uid) => testEnv.authenticatedContext(uid).firestore();
const a1 = as('a1'), a2 = as('a2'), a3 = as('a3'), a4 = as('a4');
const eng1 = as('eng1'), admin1 = as('admin1'), viewer1 = as('viewer1');

const getUpdate = (db, path = 'wo1') => getDoc(doc(db, `surveyReports/${path}/updates/u1`));
const listUpdates = (db, path = 'wo1') => getDocs(collection(db, `surveyReports/${path}/updates`));

console.log('\n── parity with the parent: who can read the survey vs its History ──');
// The inconsistency this exists to catch: a1's stage has cleared, so a1 can
// still GET the parent survey (Phase 1). Reading its History must match.
await allow('a1 (PAST stage owner) can GET the parent survey',   () => getDoc(doc(a1, 'surveyReports/wo1')));
await allow('a1 (PAST stage owner) can GET /updates',            () => getUpdate(a1));
await allow('a1 (PAST stage owner) can LIST /updates',           () => listUpdates(a1));

await allow('a2 (LIVE stage owner) can GET /updates',            () => getUpdate(a2));
await allow('a2 (LIVE stage owner) can LIST /updates',           () => listUpdates(a2));
await allow('a3 (FUTURE stage owner) can GET /updates',          () => getUpdate(a3));
await allow('a3 (FUTURE stage owner) can LIST /updates',         () => listUpdates(a3));

await allow('eng1 (assigned engineer) can GET /updates',         () => getUpdate(eng1));
await allow('admin can GET /updates',                            () => getUpdate(admin1));
await allow('viewer can GET /updates',                           () => getUpdate(viewer1));

console.log('\n── a non-owner still cannot read ──');
await deny('a4 (NOT a stage owner) cannot GET the parent survey', () => getDoc(doc(a4, 'surveyReports/wo1')));
await deny('a4 (NOT a stage owner) cannot GET /updates',          () => getUpdate(a4));
await deny('a4 (NOT a stage owner) cannot LIST /updates',         () => listUpdates(a4));

console.log('\n── create: the nested rule intends current-owner-only ──');
const entry = { action: 'approve', actorUid: 'x', actorName: 'x', createdAt: new Date() };
await allow('a2 (LIVE owner) can CREATE a History entry',
  () => setDoc(doc(a2, 'surveyReports/wo1/updates/new_a2'), entry));
await allow('eng1 (assigned engineer) CAN create — submit snapshots',
  () => setDoc(doc(eng1, 'surveyReports/wo1/updates/new_eng'), entry));
await deny('viewer CANNOT create',
  () => setDoc(doc(viewer1, 'surveyReports/wo1/updates/new_v'), entry));

// Previously ALLOWED (documented gap): the recursive /{path=**}/updates rule
// granted create to any authenticated non-viewer, ORing past the nested
// parent-ownership check. That rule's create is now `false`, so the nested
// rule is the only grant and these three are refused.
await deny('a1 (PAST owner) CANNOT create — read-only past access',
  () => setDoc(doc(a1, 'surveyReports/wo1/updates/new_a1'), entry));
await deny('a3 (FUTURE owner) CANNOT create yet',
  () => setDoc(doc(a3, 'surveyReports/wo1/updates/new_a3'), entry));
await deny('a4 (NON-owner) CANNOT create — no forged audit entries',
  () => setDoc(doc(a4, 'surveyReports/wo1/updates/new_a4'), entry));

console.log('\n── audit trail stays immutable ──');
await deny('a2 CANNOT update an existing entry',
  () => setDoc(doc(a2, 'surveyReports/wo1/updates/u1'), { ...entry, actorName: 'tampered' }));
await deny('admin CANNOT update an existing entry',
  () => setDoc(doc(admin1, 'surveyReports/wo1/updates/u1'), { ...entry, actorName: 'tampered' }));

console.log('\n── pre-chain survey: no approvalStageOwnerUids on the parent ──');
await allow('legacy: its single approver (a1) can still GET /updates', () => getUpdate(a1, 'legacy'));
await deny ('legacy: a3 cannot GET /updates',                          () => getUpdate(a3, 'legacy'));

await testEnv.cleanup();
console.log(`\n${pass} assertions passed, ${fail.length} failed`);
if (fail.length) { console.log('FAILURES:'); fail.forEach((f) => console.log('  - ' + f)); process.exit(1); }
console.log('UPDATES SUBCOLLECTION ACCESS PASSED');
