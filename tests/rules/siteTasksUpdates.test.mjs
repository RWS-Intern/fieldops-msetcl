/**
 * siteTasks/{id}/updates — the audit trail with real users on it today.
 *
 * The recursive /{path=**}/updates rule no longer grants create, so this path
 * depends entirely on its new nested rule. Both legitimate writers must keep
 * working: submitSiteTaskUpdate (the assigned engineer) and reviewSiteTask
 * (the nominated approver, or an admin when the task has no approver).
 *
 * The approver case is the one an assignedTo-only rule would have silently
 * broken, so it is asserted explicitly.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, addDoc, collection, getDocs, collectionGroup } from 'firebase/firestore';

const [host, portStr] = (process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080').split(':');

// Rules file to test: argv[2] if given (resolved against the caller's cwd),
// otherwise the repo's own firestore.rules resolved relative to THIS file — so
// the suite runs correctly from the repo root or from tests/rules.
const RULES_PATH = process.argv[2]
  ? path.resolve(process.cwd(), process.argv[2])
  : fileURLToPath(new URL('../../firestore.rules', import.meta.url));
const testEnv = await initializeTestEnvironment({
  projectId: 'demo-sitetask-updates',
  firestore: { rules: fs.readFileSync(RULES_PATH, 'utf8'), host, port: Number(portStr) },
});

let pass = 0; const fail = [];
const allow = async (l, fn) => { try { await assertSucceeds(fn()); pass++; console.log(`  ok   ${l}`); } catch (e) { fail.push(`ALLOW-EXPECTED but DENIED: ${l} :: ${e.message}`); } };
const deny  = async (l, fn) => { try { await assertFails(fn());    pass++; console.log(`  ok   ${l} (denied)`); } catch (e) { fail.push(`DENY-EXPECTED but ALLOWED: ${l} :: ${e.message}`); } };

await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  for (const [id, role] of [['admin1','admin'],['viewer1','viewer'],
                            ['eng1','field'],['eng2','field'],
                            ['appr1','approver'],['appr2','approver']]) {
    await setDoc(doc(db, 'users', id), { role, active: true, name: id });
  }
  // Normal task: engineer eng1, approver appr1.
  await setDoc(doc(db, 'siteTasks/st1'), {
    taskCode: 'T1', assignedTo: 'eng1', approverUid: 'appr1',
    status: 'pending_approval', archived: false,
  });
  await setDoc(doc(db, 'siteTasks/st1/updates/u1'), {
    submittedBy: 'eng1', submittedByName: 'Eng One', submittedAt: new Date(), status: 'pending_approval',
  });
  // Legacy task with NO approverUid — the admin-fallback review path.
  await setDoc(doc(db, 'siteTasks/st_noappr'), {
    taskCode: 'T2', assignedTo: 'eng1', status: 'pending_approval', archived: false,
  });
  // Unassigned task — neither field present.
  await setDoc(doc(db, 'siteTasks/st_bare'), { taskCode: 'T3', status: 'pending', archived: false });
});

const as = (uid) => testEnv.authenticatedContext(uid).firestore();
const eng1 = as('eng1'), eng2 = as('eng2');
const appr1 = as('appr1'), appr2 = as('appr2');
const admin1 = as('admin1'), viewer1 = as('viewer1');

const snapshot = () => ({
  submittedBy: 'x', submittedByName: 'x', submittedAt: new Date(),
  status: 'pending_approval', blockedReason: null,
});

console.log('\n── CREATE: the two legitimate writers ──');
// submitSiteTaskUpdate — the assigned engineer.
await allow('assigned ENGINEER (eng1) CAN create a snapshot',
  () => addDoc(collection(eng1, 'siteTasks/st1/updates'), snapshot()));
// reviewSiteTask — the nominated approver. An assignedTo-only rule would have
// broken this, silently killing every site-task approval's audit entry.
await allow('nominated APPROVER (appr1) CAN create a snapshot',
  () => addDoc(collection(appr1, 'siteTasks/st1/updates'), snapshot()));
await allow('ADMIN can create a snapshot',
  () => addDoc(collection(admin1, 'siteTasks/st1/updates'), snapshot()));

console.log('\n── CREATE: everyone else is refused ──');
await deny('another engineer (eng2) CANNOT create',
  () => addDoc(collection(eng2, 'siteTasks/st1/updates'), snapshot()));
await deny('another approver (appr2) CANNOT create',
  () => addDoc(collection(appr2, 'siteTasks/st1/updates'), snapshot()));
await deny('VIEWER cannot create',
  () => addDoc(collection(viewer1, 'siteTasks/st1/updates'), snapshot()));

console.log('\n── admin-fallback task (no approverUid) ──');
await allow('its engineer can still create',
  () => addDoc(collection(eng1, 'siteTasks/st_noappr/updates'), snapshot()));
await allow('admin can still create (null-approver review fallback)',
  () => addDoc(collection(admin1, 'siteTasks/st_noappr/updates'), snapshot()));
await deny('an unrelated approver cannot create on it',
  () => addDoc(collection(appr1, 'siteTasks/st_noappr/updates'), snapshot()));

console.log('\n── task with neither assignedTo nor approverUid ──');
// .get(field, null) must yield false, not a rule evaluation error.
await deny('eng1 cannot create on a task assigned to nobody',
  () => addDoc(collection(eng1, 'siteTasks/st_bare/updates'), snapshot()));
await allow('admin can still create on it',
  () => addDoc(collection(admin1, 'siteTasks/st_bare/updates'), snapshot()));

console.log('\n── READ is unchanged (admin + viewer only, as before) ──');
await allow('admin can GET a snapshot',  () => getDoc(doc(admin1, 'siteTasks/st1/updates/u1')));
await allow('viewer can GET a snapshot', () => getDoc(doc(viewer1, 'siteTasks/st1/updates/u1')));
await allow('admin can LIST snapshots',  () => getDocs(collection(admin1, 'siteTasks/st1/updates')));
await deny('engineer still cannot read them (unchanged)',
  () => getDoc(doc(eng1, 'siteTasks/st1/updates/u1')));
await deny('approver still cannot read them (unchanged)',
  () => getDoc(doc(appr1, 'siteTasks/st1/updates/u1')));

console.log('\n── the Reports page collectionGroup query still works ──');
await allow('admin collectionGroup(updates)',  () => getDocs(collectionGroup(admin1, 'updates')));
await allow('viewer collectionGroup(updates)', () => getDocs(collectionGroup(viewer1, 'updates')));
await deny('engineer collectionGroup(updates) still refused',
  () => getDocs(collectionGroup(eng1, 'updates')));

console.log('\n── snapshots stay immutable ──');
await deny('engineer cannot overwrite an existing snapshot',
  () => setDoc(doc(eng1, 'siteTasks/st1/updates/u1'), snapshot()));
await deny('admin cannot overwrite an existing snapshot',
  () => setDoc(doc(admin1, 'siteTasks/st1/updates/u1'), snapshot()));

console.log('\n── tasks/{id}/updates (v2.1) keeps its own nested grant ──');
await testEnv.withSecurityRulesDisabled(async (ctx) => {
  await setDoc(doc(ctx.firestore(), 'tasks/t1'), { assignedTo: 'eng1', status: 'pending' });
});
await allow('any authenticated non-viewer can still create a v2.1 task update',
  () => addDoc(collection(eng1, 'tasks/t1/updates'), snapshot()));
await deny('viewer still cannot',
  () => addDoc(collection(viewer1, 'tasks/t1/updates'), snapshot()));

await testEnv.cleanup();
console.log(`\n${pass} assertions passed, ${fail.length} failed`);
if (fail.length) { console.log('FAILURES:'); fail.forEach((f) => console.log('  - ' + f)); process.exit(1); }
console.log('SITETASKS /UPDATES ACCESS PASSED');
