/**
 * Rule tests for the `viewer` role — run against the local Firestore emulator.
 *
 * Purpose: prove per-collection that a viewer is admitted to every read and to
 * NO write, and that the field-engineer / approver / admin write paths still
 * work.
 *
 * Not part of the app build and deliberately not in the app's dependency tree
 * — see tests/rules/README.md. Run it with `npm run test:rules` from the repo
 * root, which starts the emulator around it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing';
import {
  doc, getDoc, setDoc, updateDoc, deleteDoc,
  collection, collectionGroup, getDocs, addDoc, query, where,
} from 'firebase/firestore';

// Rules file to test: argv[2] if given (resolved against the caller's cwd, so
// `node rules.test.mjs ../../firestore.rules` works from this directory),
// otherwise the repo's own firestore.rules resolved relative to THIS file —
// which keeps the default correct no matter where it is invoked from.
const RULES_PATH = process.argv[2]
  ? path.resolve(process.cwd(), process.argv[2])
  : fileURLToPath(new URL('../../firestore.rules', import.meta.url));
const [host, portStr] = (process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080').split(':');

const testEnv = await initializeTestEnvironment({
  projectId: 'demo-fieldops-rules',
  firestore: {
    rules: fs.readFileSync(RULES_PATH, 'utf8'),
    host,
    port: Number(portStr),
  },
});

let pass = 0;
const failures = [];

async function expectAllowed(label, fn) {
  try {
    await assertSucceeds(fn());
    pass++;
  } catch (e) {
    failures.push(`ALLOW-EXPECTED but DENIED: ${label} :: ${e.message}`);
  }
}

async function expectDenied(label, fn) {
  try {
    await assertFails(fn());
    pass++;
  } catch (e) {
    failures.push(`DENY-EXPECTED but ALLOWED: ${label} :: ${e.message}`);
  }
}

// ── Seed ─────────────────────────────────────────────────────────────────────
// siteTasks/workOrders/surveyReports/tasks marked `_v` are owned by viewer1 —
// the worst case: someone who WAS a field engineer / approver, still named on
// the work, and has since been demoted to viewer.
await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  const now = new Date();

  await setDoc(doc(db, 'users/admin1'),  { role: 'admin',    active: true, name: 'A' });
  await setDoc(doc(db, 'users/viewer1'), { role: 'viewer',   active: true, name: 'V' });
  await setDoc(doc(db, 'users/field1'),  { role: 'field',    active: true, name: 'F' });
  await setDoc(doc(db, 'users/appr1'),   { role: 'approver', active: true, name: 'P' });
  await setDoc(doc(db, 'users/admin2'),  { role: 'admin',    active: true, name: 'A2' });

  await setDoc(doc(db, 'appConfig/global'), { orgName: 'x', engineerNumCounter: 1 });
  await setDoc(doc(db, 'taskMaster/tm1'),   { typeLabel: 'x' });
  await setDoc(doc(db, 'auditLog/a1'),      { action: 'SEED' });
  await setDoc(doc(db, 'bulkUploads/b1'),   { fileName: 'x' });
  await setDoc(doc(db, 'invites/i1'),       { status: 'pending', role: 'field' });
  await setDoc(doc(db, 'projects/p1'),      { title: 'P', status: 'pending', archived: false });
  await setDoc(doc(db, 'sites/s1'),         { siteName: 'S', archived: false, status: 'active',
                                              completedTaskCount: 0, inProgressTaskCount: 0,
                                              blockedTaskCount: 0, pendingApprovalTaskCount: 0 });

  // Owned by viewer1 (demoted-user worst case)
  await setDoc(doc(db, 'tasks/tk_v'),           { assignedTo: 'viewer1', status: 'pending' });
  await setDoc(doc(db, 'tasks/tk_v/updates/u1'), { submittedBy: 'viewer1' });
  await setDoc(doc(db, 'siteTasks/st_v'),        { assignedTo: 'viewer1', approverUid: 'viewer1',
                                                   status: 'pending_approval', archived: false });
  await setDoc(doc(db, 'siteTasks/st_v/updates/u1'), { submittedBy: 'viewer1', status: 'pending' });
  await setDoc(doc(db, 'workOrders/wo_v'),       { assignedTo: 'viewer1', approverUid: 'viewer1',
                                                   status: 'pending_approval', archived: false });
  await setDoc(doc(db, 'surveyReports/wo_v'),    { assignedTo: 'viewer1', approverUid: 'viewer1',
                                                   status: 'pending_approval' });
  await setDoc(doc(db, 'surveyReports/wo_v/updates/u1'), { action: 'submit', actorUid: 'viewer1' });

  // Owned by the real field engineer / approver (regression fixtures)
  await setDoc(doc(db, 'siteTasks/st_f'),     { assignedTo: 'field1', approverUid: 'appr1',
                                                status: 'in_progress', archived: false });
  await setDoc(doc(db, 'siteTasks/st_p'),     { assignedTo: 'field1', approverUid: 'appr1',
                                                status: 'pending_approval', archived: false });
  await setDoc(doc(db, 'workOrders/wo_f'),    { assignedTo: 'field1', approverUid: 'appr1',
                                                status: 'in_progress', archived: false });
  await setDoc(doc(db, 'workOrders/wo_p'),    { assignedTo: 'field1', approverUid: 'appr1',
                                                status: 'pending_approval', archived: false });
  await setDoc(doc(db, 'surveyReports/wo_f'), { assignedTo: 'field1', approverUid: 'appr1',
                                                status: 'in_progress', updatedAt: now });
  await setDoc(doc(db, 'surveyReports/wo_p'), { assignedTo: 'field1', approverUid: 'appr1',
                                                status: 'pending_approval', updatedAt: now });
});

const viewer = testEnv.authenticatedContext('viewer1').firestore();
const admin  = testEnv.authenticatedContext('admin1').firestore();
const field  = testEnv.authenticatedContext('field1').firestore();
const appr   = testEnv.authenticatedContext('appr1').firestore();
const fresh  = testEnv.authenticatedContext('brandnew').firestore();

// ── 1. Viewer READS — every collection in the task list ──────────────────────
const READ_TARGETS = [
  ['projects',                      'projects/p1'],
  ['sites',                         'sites/s1'],
  ['siteTasks',                     'siteTasks/st_v'],
  ['siteTasks (not theirs)',        'siteTasks/st_f'],
  ['workOrders',                    'workOrders/wo_f'],
  ['surveyReports',                 'surveyReports/wo_f'],
  ['users',                         'users/admin1'],
  ['appConfig',                     'appConfig/global'],
  ['auditLog',                      'auditLog/a1'],
  ['bulkUploads',                   'bulkUploads/b1'],
  ['taskMaster',                    'taskMaster/tm1'],
  ['tasks',                         'tasks/tk_v'],
  ['siteTasks/{id}/updates',        'siteTasks/st_v/updates/u1'],
  ['surveyReports/{id}/updates',    'surveyReports/wo_v/updates/u1'],
  ['tasks/{id}/updates',            'tasks/tk_v/updates/u1'],
];
for (const [label, path] of READ_TARGETS) {
  await expectAllowed(`viewer GET ${label}`, () => getDoc(doc(viewer, path)));
}

const LIST_TARGETS = [
  'projects', 'sites', 'siteTasks', 'workOrders', 'surveyReports',
  'users', 'appConfig', 'auditLog', 'bulkUploads', 'taskMaster', 'tasks',
];
for (const c of LIST_TARGETS) {
  await expectAllowed(`viewer LIST ${c} (unfiltered)`, () => getDocs(collection(viewer, c)));
}
await expectAllowed('viewer LIST siteTasks/{id}/updates',
  () => getDocs(collection(viewer, 'siteTasks/st_v/updates')));
await expectAllowed('viewer LIST surveyReports/{id}/updates',
  () => getDocs(collection(viewer, 'surveyReports/wo_v/updates')));
// The oversight page's own filtered query shape
await expectAllowed('viewer LIST surveyReports where status ==',
  () => getDocs(query(collection(viewer, 'surveyReports'), where('status', '==', 'pending_approval'))));
// The Reports page's cross-collection updates query
await expectAllowed('viewer collectionGroup(updates)',
  () => getDocs(collectionGroup(viewer, 'updates')));
// Field-engineer-shaped scoped query still permitted for a viewer
await expectAllowed('viewer LIST siteTasks where assignedTo ==',
  () => getDocs(query(collection(viewer, 'siteTasks'), where('assignedTo', '==', 'field1'))));
await expectAllowed('viewer LIST workOrders where siteId == (site history)',
  () => getDocs(query(collection(viewer, 'workOrders'), where('siteId', '==', 's1'))));
await expectAllowed('viewer LIST sites where archived == false',
  () => getDocs(query(collection(viewer, 'sites'), where('archived', '==', false))));
await expectAllowed('viewer LIST sites where archived == true (archived view)',
  () => getDocs(query(collection(viewer, 'sites'), where('archived', '==', true))));
// The EditUserModal orphaned-work counting queries, run as admin
await expectAllowed('admin LIST siteTasks where assignedTo == (orphan check)',
  () => getDocs(query(collection(admin, 'siteTasks'), where('assignedTo', '==', 'field1'))));
await expectAllowed('admin LIST workOrders where assignedTo == (orphan check)',
  () => getDocs(query(collection(admin, 'workOrders'), where('assignedTo', '==', 'field1'))));
await expectAllowed('admin LIST siteTasks where approverUid == (orphan check)',
  () => getDocs(query(collection(admin, 'siteTasks'), where('approverUid', '==', 'appr1'))));
await expectAllowed('admin LIST surveyReports where approverUid == (orphan check)',
  () => getDocs(query(collection(admin, 'surveyReports'), where('approverUid', '==', 'appr1'))));

// ── 2. Viewer WRITES — must ALL be denied ────────────────────────────────────
const WRITE_COLLECTIONS = [
  'projects', 'sites', 'siteTasks', 'workOrders', 'surveyReports',
  'users', 'appConfig', 'auditLog', 'bulkUploads', 'taskMaster', 'tasks', 'invites',
];
for (const c of WRITE_COLLECTIONS) {
  await expectDenied(`viewer CREATE ${c}`,
    () => setDoc(doc(viewer, `${c}/new_by_viewer`), { x: 1 }));
  await expectDenied(`viewer ADD ${c}`,
    () => addDoc(collection(viewer, c), { x: 1 }));
}

// Updates on documents the viewer is still named on (the demoted-user case)
await expectDenied('viewer UPDATE tasks (assignedTo == self)',
  () => updateDoc(doc(viewer, 'tasks/tk_v'), { status: 'in_progress' }));
await expectDenied('viewer UPDATE siteTasks as engineer (assignedTo == self)',
  () => updateDoc(doc(viewer, 'siteTasks/st_v'), { status: 'in_progress' }));
await expectDenied('viewer UPDATE siteTasks as approver (approverUid == self)',
  () => updateDoc(doc(viewer, 'siteTasks/st_v'), {
    status: 'completed', reviewNotes: null, reviewedBy: 'viewer1',
    reviewedByName: 'V', reviewedAt: new Date(), updatedAt: new Date() }));
await expectDenied('viewer UPDATE workOrders as engineer',
  () => updateDoc(doc(viewer, 'workOrders/wo_v'), {
    status: 'in_progress', assignedTo: 'viewer1', approverUid: 'viewer1' }));
await expectDenied('viewer UPDATE workOrders as approver',
  () => updateDoc(doc(viewer, 'workOrders/wo_v'), { status: 'approved', updatedAt: new Date() }));
await expectDenied('viewer UPDATE surveyReports as engineer',
  () => updateDoc(doc(viewer, 'surveyReports/wo_v'), {
    status: 'in_progress', assignedTo: 'viewer1', approverUid: 'viewer1' }));
await expectDenied('viewer UPDATE surveyReports as approver',
  () => updateDoc(doc(viewer, 'surveyReports/wo_v'), {
    status: 'approved', reviewNotes: null, reviewedBy: 'viewer1',
    reviewedByName: 'V', reviewedAt: new Date(), updatedAt: new Date() }));
await expectDenied('viewer UPDATE sites counter fields',
  () => updateDoc(doc(viewer, 'sites/s1'), { completedTaskCount: 5, updatedAt: new Date() }));
await expectDenied('viewer UPDATE projects (was: any authenticated user)',
  () => updateDoc(doc(viewer, 'projects/p1'), { status: 'completed' }));
await expectDenied('viewer UPDATE invites (was: any authenticated user)',
  () => updateDoc(doc(viewer, 'invites/i1'), { status: 'accepted' }));
await expectDenied('viewer UPDATE own user doc (role escalation)',
  () => updateDoc(doc(viewer, 'users/viewer1'), { role: 'admin' }));
await expectDenied('viewer UPDATE own user doc (name only)',
  () => updateDoc(doc(viewer, 'users/viewer1'), { name: 'V2' }));
await expectDenied('viewer UPDATE another user doc',
  () => updateDoc(doc(viewer, 'users/field1'), { role: 'viewer' }));
await expectDenied('viewer UPDATE appConfig',
  () => updateDoc(doc(viewer, 'appConfig/global'), { orgName: 'y' }));
await expectDenied('viewer UPDATE taskMaster',
  () => updateDoc(doc(viewer, 'taskMaster/tm1'), { typeLabel: 'y' }));
await expectDenied('viewer UPDATE bulkUploads',
  () => updateDoc(doc(viewer, 'bulkUploads/b1'), { fileName: 'y' }));
await expectDenied('viewer UPDATE auditLog',
  () => updateDoc(doc(viewer, 'auditLog/a1'), { action: 'X' }));

// Audit-trail subcollection creates
await expectDenied('viewer CREATE surveyReports/{id}/updates (owns parent)',
  () => setDoc(doc(viewer, 'surveyReports/wo_v/updates/hack'), { action: 'approve' }));
await expectDenied('viewer CREATE siteTasks/{id}/updates',
  () => setDoc(doc(viewer, 'siteTasks/st_v/updates/hack'), { status: 'completed' }));
await expectDenied('viewer CREATE tasks/{id}/updates',
  () => setDoc(doc(viewer, 'tasks/tk_v/updates/hack'), { status: 'completed' }));
await expectDenied('viewer UPDATE surveyReports/{id}/updates (immutable)',
  () => updateDoc(doc(viewer, 'surveyReports/wo_v/updates/u1'), { action: 'approve' }));

// Deletes
for (const path of [
  'projects/p1', 'sites/s1', 'siteTasks/st_v', 'workOrders/wo_v', 'surveyReports/wo_v',
  'users/field1', 'users/viewer1', 'appConfig/global', 'taskMaster/tm1', 'auditLog/a1',
  'bulkUploads/b1', 'invites/i1', 'tasks/tk_v',
  'siteTasks/st_v/updates/u1', 'surveyReports/wo_v/updates/u1', 'tasks/tk_v/updates/u1',
]) {
  await expectDenied(`viewer DELETE ${path}`, () => deleteDoc(doc(viewer, path)));
}

// ── 3. Regressions — the other three roles must be unaffected ────────────────

// Field engineer lifecycle
await expectAllowed('field UPDATE own siteTask -> pending_approval',
  () => updateDoc(doc(field, 'siteTasks/st_f'), {
    status: 'pending_approval', assignedTo: 'field1', approverUid: 'appr1' }));
await expectAllowed('field UPDATE own workOrder -> pending_approval',
  () => updateDoc(doc(field, 'workOrders/wo_f'), {
    status: 'pending_approval', assignedTo: 'field1', approverUid: 'appr1' }));
await expectAllowed('field UPDATE own surveyReport -> pending_approval',
  () => updateDoc(doc(field, 'surveyReports/wo_f'), {
    status: 'pending_approval', assignedTo: 'field1', approverUid: 'appr1' }));
await expectAllowed('field CREATE siteTask update snapshot',
  () => setDoc(doc(field, 'siteTasks/st_f/updates/u2'), { submittedBy: 'field1', status: 'pending_approval' }));
await expectAllowed('field CREATE surveyReport audit entry',
  () => setDoc(doc(field, 'surveyReports/wo_f/updates/u2'), { action: 'submit', actorUid: 'field1' }));
await expectAllowed('field UPDATE site counters',
  () => updateDoc(doc(field, 'sites/s1'), { pendingApprovalTaskCount: 1, updatedAt: new Date() }));
await expectAllowed('field UPDATE project status (updateProjectStatus)',
  () => updateDoc(doc(field, 'projects/p1'), { status: 'in_progress' }));
await expectAllowed('field CREATE auditLog entry',
  () => addDoc(collection(field, 'auditLog'), { action: 'SUBMIT_SITE_TASK' }));
await expectAllowed('field READ own siteTask', () => getDoc(doc(field, 'siteTasks/st_f')));
await expectAllowed('field LIST own siteTasks',
  () => getDocs(query(collection(field, 'siteTasks'), where('assignedTo', '==', 'field1'))));

// Approver review
await expectAllowed('approver UPDATE siteTask -> completed',
  () => updateDoc(doc(appr, 'siteTasks/st_p'), {
    status: 'completed', reviewNotes: null, reviewedBy: 'appr1',
    reviewedByName: 'P', reviewedAt: new Date(), updatedAt: new Date() }));
await expectAllowed('approver UPDATE workOrder -> approved',
  () => updateDoc(doc(appr, 'workOrders/wo_p'), { status: 'approved', updatedAt: new Date() }));
await expectAllowed('approver UPDATE surveyReport -> approved',
  () => updateDoc(doc(appr, 'surveyReports/wo_p'), {
    status: 'approved', reviewNotes: null, reviewedBy: 'appr1',
    reviewedByName: 'P', reviewedAt: new Date(), updatedAt: new Date() }));
await expectAllowed('approver CREATE surveyReport audit entry',
  () => setDoc(doc(appr, 'surveyReports/wo_p/updates/u3'), { action: 'approve', actorUid: 'appr1' }));
await expectAllowed('approver LIST own approval queue',
  () => getDocs(query(collection(appr, 'surveyReports'), where('approverUid', '==', 'appr1'))));

// Admin
await expectAllowed('admin CREATE site',        () => setDoc(doc(admin, 'sites/s2'), { siteName: 'S2', archived: false }));
await expectAllowed('admin CREATE siteTask',    () => setDoc(doc(admin, 'siteTasks/st_new'), { assignedTo: null }));
await expectAllowed('admin CREATE workOrder',   () => setDoc(doc(admin, 'workOrders/wo_new'), { assignedTo: null }));
await expectAllowed('admin CREATE user',        () => setDoc(doc(admin, 'users/newuser'), { role: 'field', active: true }));
// Dedicated target — must NOT be field1/appr1, whose roles the regression
// assertions below still depend on.
await expectAllowed('admin CHANGE user role',   () => updateDoc(doc(admin, 'users/newuser'), { role: 'viewer' }));
await expectAllowed('admin WRITE auditLog',     () => addDoc(collection(admin, 'auditLog'), { action: 'CHANGE_USER_ROLE' }));
await expectAllowed('admin READ auditLog',      () => getDocs(collection(admin, 'auditLog')));
await expectAllowed('admin UPDATE appConfig',   () => updateDoc(doc(admin, 'appConfig/global'), { orgName: 'z' }));
await expectAllowed('admin WRITE bulkUploads',  () => setDoc(doc(admin, 'bulkUploads/b2'), { fileName: 'y' }));
await expectAllowed('admin DELETE siteTask',    () => deleteDoc(doc(admin, 'siteTasks/st_new')));

// Signup: a brand-new account with no user doc yet creates its OWN doc
await expectAllowed('signup CREATE own user doc (no user doc exists yet)',
  () => setDoc(doc(fresh, 'users/brandnew'), { role: 'field', active: true, name: 'New' }));
await expectAllowed('signup UPDATE invite -> accepted',
  () => updateDoc(doc(fresh, 'invites/i1'), { status: 'accepted' }));

// Escalation guards that must hold for non-viewers too
await expectDenied('field CANNOT self-approve own siteTask',
  () => updateDoc(doc(field, 'siteTasks/st_f'), {
    status: 'completed', reviewedBy: 'field1', reviewedByName: 'F',
    reviewNotes: null, reviewedAt: new Date(), updatedAt: new Date() }));
await expectDenied('field CANNOT update someone else\'s siteTask',
  () => updateDoc(doc(field, 'siteTasks/st_v'), { status: 'in_progress' }));

await testEnv.cleanup();

console.log(`\n${pass} assertions passed, ${failures.length} failed`);
if (failures.length) {
  console.log('\nFAILURES:');
  for (const f of failures) console.log('  - ' + f);
  process.exit(1);
}
console.log('ALL RULE ASSERTIONS PASSED');
