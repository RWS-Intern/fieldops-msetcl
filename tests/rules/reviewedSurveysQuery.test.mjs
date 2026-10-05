/**
 * Which surveyReports LIST queries a non-admin approver may actually run.
 *
 * WHY THIS EXISTS: the approver dashboard used
 * `where('reviewedBy', '==', uid)` and logged "Missing or insufficient
 * permissions" on every load for a non-admin approver. Firestore authorises a
 * list query from the QUERY'S OWN CONSTRAINTS, not from which documents happen
 * to match — so a query must constrain a field the rule actually tests. The
 * surveyReports list rule tests assignedTo / approverUid /
 * approvalStageOwnerUids, and `reviewedBy` is none of them.
 *
 * The documents below are the realistic shape: a Level 1 approver who has
 * already acted, so `reviewedBy` is them but `approverUid` has moved on to the
 * next stage. Only `approvalStageOwnerUids` still names them.
 *
 * Run: node reviewedSurveysQuery.test.mjs ../../firestore.rules
 */
import fs from 'node:fs';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, setDoc, collection, query, where, getDocs } from 'firebase/firestore';

const [host, portStr] = (process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080').split(':');
const testEnv = await initializeTestEnvironment({
  projectId: 'demo-reviewed-surveys',
  firestore: { rules: fs.readFileSync(process.argv[2], 'utf8'), host, port: Number(portStr) },
});

let pass = 0; const fail = [];
const allow = async (l, fn) => {
  try { await assertSucceeds(fn()); pass++; console.log(`  ok   ALLOW  ${l}`); }
  catch (e) { fail.push(`ALLOW expected but DENIED: ${l} :: ${e.message}`); console.log(`  FAIL ALLOW  ${l}`); }
};
const deny = async (l, fn) => {
  try { await assertFails(fn()); pass++; console.log(`  ok   DENY   ${l}`); }
  catch { fail.push(`DENY expected but ALLOWED: ${l}`); console.log(`  FAIL DENY   ${l}`); }
};

const stage = (key, label, uid, name, status) => ({
  stageKey: key, stageLabel: label, status,
  ownerUid: uid, ownerName: name,
  reviewNotes: null, attachmentUrl: null, actedAt: null,
});

await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  for (const [id, role] of [
    ['f1', 'field'], ['a1', 'approver'], ['a2', 'approver'], ['admin1', 'admin'], ['v1', 'viewer'],
  ]) {
    await setDoc(doc(db, 'users', id), { role, active: true, name: id });
  }

  // a1 reviewed it at Level 1 and the chain has moved to a2:
  //   reviewedBy        = a1   (a1 acted most recently on it)
  //   approverUid       = a2   (the LIVE stage owner now)
  //   approvalStageOwnerUids contains a1 — the only field that still names a1.
  for (const n of [1, 2]) {
    await setDoc(doc(db, 'surveyReports', `sv-${n}`), {
      workOrderId: `wo-${n}`, siteId: 's1', siteCode: 'SUB-00' + n, siteName: 'S',
      assignedTo: 'f1', assignedToName: 'F1',
      approverUid: 'a2', approverName: 'A2',
      approvalStages: [
        stage('level1', 'Approver Level 1', 'a1', 'A1', 'approved'),
        stage('level2', 'Approver Level 2', 'a2', 'A2', 'pending'),
      ],
      approvalStageOwnerUids: ['a1', 'a2'],
      currentStageIndex: 1, reviewDirection: 'forward',
      status: 'pending_approval',
      reviewedBy: 'a1', reviewedByName: 'A1', reviewedAt: new Date(),
      updatedAt: new Date(),
    });
  }
});

const as = (uid) => testEnv.authenticatedContext(uid).firestore();
const byReviewedBy = (db, uid) => getDocs(query(collection(db, 'surveyReports'), where('reviewedBy', '==', uid)));
const byStageOwner = (db, uid) => getDocs(query(collection(db, 'surveyReports'), where('approvalStageOwnerUids', 'array-contains', uid)));

console.log('\n-- non-admin approver (a1): which list query is provable? --');
await deny('reviewedBy == a1  (constrains no field the rule tests)', () => byReviewedBy(as('a1'), 'a1'));
await allow('approvalStageOwnerUids array-contains a1', () => byStageOwner(as('a1'), 'a1'));

console.log('\n-- the same two queries for every other role --');
await allow('admin:  reviewedBy == a1    (isAdmin short-circuits the rule)', () => byReviewedBy(as('admin1'), 'a1'));
await allow('viewer: reviewedBy == a1    (isViewer short-circuits the rule)', () => byReviewedBy(as('v1'), 'a1'));
await deny('field:  reviewedBy == f1    (proves nothing, even with no matches)', () => byReviewedBy(as('f1'), 'f1'));
await allow('field:  assignedTo == f1   (the field expert\'s own provable query)',
  () => getDocs(query(collection(as('f1'), 'surveyReports'), where('assignedTo', '==', 'f1'))));

console.log('\n-- an approver may not read another approver\'s history --');
await deny('a1 queries approvalStageOwnerUids array-contains a2',
  () => byStageOwner(as('a1'), 'a2'));

console.log(`\n${pass} passed, ${fail.length} failed`);
fail.forEach((f) => console.log(`  - ${f}`));
await testEnv.cleanup();
process.exit(fail.length === 0 ? 0 : 1);
