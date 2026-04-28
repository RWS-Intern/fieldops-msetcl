/**
 * scripts/reseedAll.ts
 *
 * Full reseed: wipes nothing, creates 2 projects + 6 linked tasks using the
 * EXACT same atomic transaction patterns as the production hooks:
 *
 *   createProject  →  src/hooks/useProjectActions.ts  (runTransaction)
 *   createTask     →  src/hooks/useTaskActions.ts      (runTransaction)
 *   updateProjectStatus → src/hooks/useProjectActions.ts (standalone)
 *
 * NOTE: Because production hooks live inside React components and reference
 * Zustand (useAuthStore) and Vite path aliases (@/), they cannot be imported
 * directly into a Node.js script. This script is the faithful non-React
 * equivalent — same Firestore calls, same field names, same logic.
 *
 * Prerequisites:
 *   VITE_ADMIN_EMAIL + VITE_ADMIN_PASSWORD + VITE_FIELD_UID in .env.local
 *   appConfig/global must exist (run: npm run update:config first)
 *
 * Run: npm run reseed
 */

import * as dotenv from 'dotenv';
import * as path   from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

import { initializeApp }                    from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  updateDoc,
  runTransaction,
  query,
  where,
  serverTimestamp,
  increment,
  Timestamp,
} from 'firebase/firestore';

// ─── Env validation ────────────────────────────────────────────────────────────

const {
  VITE_FIREBASE_API_KEY,
  VITE_FIREBASE_AUTH_DOMAIN,
  VITE_FIREBASE_PROJECT_ID,
  VITE_FIREBASE_MESSAGING_SENDER_ID,
  VITE_FIREBASE_APP_ID,
  VITE_ADMIN_EMAIL,
  VITE_ADMIN_PASSWORD,
  VITE_ADMIN_UID,
  VITE_FIELD_UID,
} = process.env;

if (!VITE_FIREBASE_PROJECT_ID) {
  console.error('❌  Missing VITE_FIREBASE_PROJECT_ID — check .env.local');
  process.exit(1);
}
if (!VITE_ADMIN_EMAIL || !VITE_ADMIN_PASSWORD) {
  console.error('❌  Missing VITE_ADMIN_EMAIL or VITE_ADMIN_PASSWORD in .env.local');
  process.exit(1);
}
if (!VITE_FIELD_UID) {
  console.error('❌  Missing VITE_FIELD_UID in .env.local');
  process.exit(1);
}

// ─── Firebase init ─────────────────────────────────────────────────────────────

const app  = initializeApp({
  apiKey:            VITE_FIREBASE_API_KEY,
  authDomain:        VITE_FIREBASE_AUTH_DOMAIN,
  projectId:         VITE_FIREBASE_PROJECT_ID,
  messagingSenderId: VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId:             VITE_FIREBASE_APP_ID,
});

const auth = getAuth(app);
const db   = getFirestore(app);

// ─── Helpers ───────────────────────────────────────────────────────────────────

function daysFromNow(n: number): Timestamp {
  const d = new Date();
  d.setDate(d.getDate() + n);
  d.setHours(0, 0, 0, 0);
  return Timestamp.fromDate(d);
}

// ─── verifyCounters ────────────────────────────────────────────────────────────
// Reads appConfig/global and warns if either counter is non-zero.
// Does NOT abort — a fresh DB starts at 0; a DB with prior data starts higher.

async function verifyCounters(): Promise<void> {
  const snap = await getDoc(doc(db, 'appConfig', 'global'));
  if (!snap.exists()) {
    console.error('❌  appConfig/global not found — run npm run update:config first');
    process.exit(1);
  }
  const data = snap.data();
  const pc = (data['projectNumCounter'] as number) ?? 0;
  const tc = (data['taskNumCounter']    as number) ?? 0;

  console.log(`   projectNumCounter: ${pc}  taskNumCounter: ${tc}`);
  if (pc !== 0 || tc !== 0) {
    console.warn('⚠️   Counters are non-zero. Projects will be numbered from the current counter value.');
    console.warn('    If you want to start from RP:001 / RS:001, reset counters first via update:config.');
  } else {
    console.log('✅  Counters are at 0 — will produce RP:001–RP:002 and RS:001–RS:006');
  }
}

// ─── createProjectAtomic ───────────────────────────────────────────────────────
// Mirrors useProjectActions.ts → createProject()
// Counter increment + project doc creation in ONE runTransaction call.

interface CreateProjectArgs {
  title:           string;
  description:     string;
  siteCode:        string;
  startDate:       Timestamp;
  dueDate:         Timestamp;
  assignedTo:      string[];
  assignedToNames: string[];
  createdBy:       string;
}

async function createProjectAtomic(
  args: CreateProjectArgs
): Promise<{ id: string; projectNum: string }> {
  const configRef = doc(db, 'appConfig', 'global');

  const result = await runTransaction(db, async (transaction) => {
    const configSnap = await transaction.get(configRef);
    if (!configSnap.exists()) throw new Error('appConfig/global not found');

    const current    = (configSnap.data()?.['projectNumCounter'] as number) ?? 0;
    const prefix     = (configSnap.data()?.['projectNumPrefix']  as string) ?? 'RP';
    const next       = current + 1;
    const projectNum = `${prefix}:${String(next).padStart(3, '0')}`;

    // Increment counter — same as useProjectActions createProject
    transaction.update(configRef, { projectNumCounter: next });

    // Create project doc atomically in the SAME transaction
    const newProjectRef = doc(collection(db, 'projects'));
    transaction.set(newProjectRef, {
      projectNum,
      title:              args.title,
      description:        args.description,
      siteCode:           args.siteCode,
      status:             'pending',
      assignedTo:         args.assignedTo,
      assignedToNames:    args.assignedToNames,
      createdBy:          args.createdBy,
      startDate:          args.startDate,
      dueDate:            args.dueDate,
      taskCount:          0,
      completedTaskCount: 0,
      createdAt:          serverTimestamp(),
      updatedAt:          serverTimestamp(),
    });

    return { id: newProjectRef.id, projectNum };
  });

  // Audit log — non-critical, outside transaction (mirrors hook behaviour)
  try {
    await addDoc(collection(db, 'auditLog'), {
      timestamp: serverTimestamp(),
      uid:       args.createdBy,
      userName:  'reseed script',
      action:    'CREATE_PROJECT',
      detail:    `[reseed] Created project ${result.projectNum}: ${args.title}`,
      projectId: result.id,
    });
  } catch {
    // non-critical
  }

  return result;
}

// ─── createTaskAtomic ──────────────────────────────────────────────────────────
// Mirrors useTaskActions.ts → createTask()
// Counter increment + task doc creation in ONE runTransaction call.

interface CreateTaskArgs {
  title:          string;
  type:           string;
  assignedTo:     string;
  assignedToName: string;
  siteCode:       string;
  startDate:      Timestamp;
  dueDate:        Timestamp;
  createdBy:      string;
  projectId:      string;
  projectTitle:   string;
  projectNum:     string;
}

async function createTaskAtomic(
  args: CreateTaskArgs
): Promise<{ id: string; taskNum: string }> {
  const configRef = doc(db, 'appConfig', 'global');

  const result = await runTransaction(db, async (transaction) => {
    const configSnap = await transaction.get(configRef);
    if (!configSnap.exists()) throw new Error('appConfig/global not found');

    const current = (configSnap.data()?.['taskNumCounter'] as number) ?? 0;
    const prefix  = (configSnap.data()?.['taskNumPrefix']  as string) ?? 'RS';
    const next    = current + 1;
    const taskNum = `${prefix}:${String(next).padStart(3, '0')}`;

    // Increment counter — same as useTaskActions createTask
    transaction.update(configRef, { taskNumCounter: next });

    // Create task doc atomically in the SAME transaction
    const newTaskRef = doc(collection(db, 'tasks'));
    transaction.set(newTaskRef, {
      taskNum,
      title:            args.title,
      description:      '',
      type:             args.type,
      siteCode:         args.siteCode,
      assignedTo:       args.assignedTo,
      assignedToName:   args.assignedToName,
      createdBy:        args.createdBy,
      status:           'pending',
      startDate:        args.startDate,
      dueDate:          args.dueDate,
      blockedReason:    null,
      location:         null,
      subtaskAnswers:   {},
      subtaskPhotos:    {},
      completionPhotos: [],
      // Project link fields — present because a projectId was supplied
      projectId:    args.projectId,
      projectTitle: args.projectTitle,
      projectNum:   args.projectNum,
      createdAt:    serverTimestamp(),
      updatedAt:    serverTimestamp(),
    });

    return { id: newTaskRef.id, taskNum };
  });

  // Audit log — non-critical, outside transaction (mirrors hook behaviour)
  try {
    await addDoc(collection(db, 'auditLog'), {
      timestamp: serverTimestamp(),
      uid:       args.createdBy,
      userName:  'reseed script',
      action:    'CREATE_TASK',
      detail:    `[reseed] Created task ${result.taskNum}: ${args.title}`,
      taskId:    result.id,
    });
  } catch {
    // non-critical
  }

  // Optimistic taskCount increment + project status sync
  // Mirrors the post-transaction block in useTaskActions createTask
  await updateDoc(doc(db, 'projects', args.projectId), {
    taskCount: increment(1),
    updatedAt: serverTimestamp(),
  });
  await updateProjectStatus(args.projectId);

  return result;
}

// ─── updateProjectStatus ───────────────────────────────────────────────────────
// Direct copy of the standalone export in src/hooks/useProjectActions.ts.
// Cannot be imported from that file because it uses '@/firebase/config' (Vite alias).

async function updateProjectStatus(projectId: string): Promise<void> {
  if (!projectId || projectId === 'null' || projectId === 'undefined') {
    console.warn('  [updateProjectStatus] invalid projectId:', projectId);
    return;
  }

  const projectRef  = doc(db, 'projects', projectId);
  const projectSnap = await getDoc(projectRef);
  if (!projectSnap.exists()) {
    console.warn('  [updateProjectStatus] project not found:', projectId);
    return;
  }

  const tasksSnap = await getDocs(
    query(collection(db, 'tasks'), where('projectId', '==', projectId))
  );

  if (tasksSnap.empty) {
    await updateDoc(projectRef, {
      status:             'pending',
      completedTaskCount: 0,
      taskCount:          0,
      updatedAt:          serverTimestamp(),
    });
    return;
  }

  const statuses = tasksSnap.docs.map((d) => d.data()['status'] as string);

  let newStatus: string;
  if (statuses.every((s) => s === 'completed')) {
    newStatus = 'completed';
  } else if (statuses.some((s) => s === 'blocked')) {
    newStatus = 'blocked';
  } else if (statuses.some((s) => s === 'in_progress' || s === 'completed')) {
    newStatus = 'in_progress';
  } else {
    newStatus = 'pending';
  }

  const completedCount = statuses.filter((s) => s === 'completed').length;

  await updateDoc(projectRef, {
    status:             newStatus,
    completedTaskCount: completedCount,
    taskCount:          tasksSnap.size,
    updatedAt:          serverTimestamp(),
  });
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  FieldOps Rite Solar — Full Reseed');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // ── Auth ────────────────────────────────────────────────────────────────────
  console.log('🔑  Signing in as admin…');
  const cred = await signInWithEmailAndPassword(auth, VITE_ADMIN_EMAIL!, VITE_ADMIN_PASSWORD!);
  const adminUid   = cred.user.uid;
  const fieldUid   = VITE_FIELD_UID!;
  const fieldName  = 'Field Engineer';
  console.log(`✅  Signed in  (uid: ${adminUid})\n`);

  // ── Verify counters ─────────────────────────────────────────────────────────
  console.log('🔍  Checking appConfig counters…');
  await verifyCounters();
  console.log();

  // ── Project 1: Site A — Solar Installation ──────────────────────────────────
  console.log('📁  Creating Project 1 — Site A Solar Installation…');
  const p1 = await createProjectAtomic({
    title:           'Site A — Solar Installation',
    description:     'Complete solar feeder installation and configuration at Site A',
    siteCode:        'RS-SITE-001',
    startDate:       daysFromNow(0),
    dueDate:         daysFromNow(14),
    assignedTo:      [fieldUid],
    assignedToNames: [fieldName],
    createdBy:       adminUid,
  });
  console.log(`   ✓ ${p1.projectNum}  id: ${p1.id}\n`);

  // ── Project 2: Substation 4 — Full Setup ────────────────────────────────────
  console.log('📁  Creating Project 2 — Substation 4 Full Setup…');
  const p2 = await createProjectAtomic({
    title:           'Substation 4 — Full Setup',
    description:     'RTU configuration and EA checks at Substation 4',
    siteCode:        'RS-SUB-004',
    startDate:       daysFromNow(3),
    dueDate:         daysFromNow(21),
    assignedTo:      [fieldUid],
    assignedToNames: [fieldName],
    createdBy:       adminUid,
  });
  console.log(`   ✓ ${p2.projectNum}  id: ${p2.id}\n`);

  // ── Tasks for Project 1 (3 tasks) ───────────────────────────────────────────
  console.log(`📋  Creating 3 tasks for ${p1.projectNum}…`);

  const t1 = await createTaskAtomic({
    title:          'Solar Panel Installation',
    type:           'solar_feeder',
    assignedTo:     fieldUid,
    assignedToName: fieldName,
    siteCode:       'RS-SITE-001',
    startDate:      daysFromNow(0),
    dueDate:        daysFromNow(5),
    createdBy:      adminUid,
    projectId:      p1.id,
    projectTitle:   p1.projectNum,
    projectNum:     p1.projectNum,
  });
  console.log(`   ✓ ${t1.taskNum} — Solar Panel Installation`);

  const t2 = await createTaskAtomic({
    title:          'Feeder Cable Routing',
    type:           'solar_feeder',
    assignedTo:     fieldUid,
    assignedToName: fieldName,
    siteCode:       'RS-SITE-001',
    startDate:      daysFromNow(2),
    dueDate:        daysFromNow(7),
    createdBy:      adminUid,
    projectId:      p1.id,
    projectTitle:   p1.projectNum,
    projectNum:     p1.projectNum,
  });
  console.log(`   ✓ ${t2.taskNum} — Feeder Cable Routing`);

  const t3 = await createTaskAtomic({
    title:          'Meter Configuration',
    type:           'new_config',
    assignedTo:     fieldUid,
    assignedToName: fieldName,
    siteCode:       'RS-SITE-001',
    startDate:      daysFromNow(5),
    dueDate:        daysFromNow(10),
    createdBy:      adminUid,
    projectId:      p1.id,
    projectTitle:   p1.projectNum,
    projectNum:     p1.projectNum,
  });
  console.log(`   ✓ ${t3.taskNum} — Meter Configuration\n`);

  // ── Tasks for Project 2 (3 tasks) ───────────────────────────────────────────
  console.log(`📋  Creating 3 tasks for ${p2.projectNum}…`);

  const t4 = await createTaskAtomic({
    title:          'RTU Configuration',
    type:           'new_config',
    assignedTo:     fieldUid,
    assignedToName: fieldName,
    siteCode:       'RS-SUB-004',
    startDate:      daysFromNow(3),
    dueDate:        daysFromNow(8),
    createdBy:      adminUid,
    projectId:      p2.id,
    projectTitle:   p2.projectNum,
    projectNum:     p2.projectNum,
  });
  console.log(`   ✓ ${t4.taskNum} — RTU Configuration`);

  const t5 = await createTaskAtomic({
    title:          'EA Fault Check',
    type:           'ea_rectification',
    assignedTo:     fieldUid,
    assignedToName: fieldName,
    siteCode:       'RS-SUB-004',
    startDate:      daysFromNow(5),
    dueDate:        daysFromNow(12),
    createdBy:      adminUid,
    projectId:      p2.id,
    projectTitle:   p2.projectNum,
    projectNum:     p2.projectNum,
  });
  console.log(`   ✓ ${t5.taskNum} — EA Fault Check`);

  const t6 = await createTaskAtomic({
    title:          'Initial Maintenance Survey',
    type:           'routine_maintenance',
    assignedTo:     fieldUid,
    assignedToName: fieldName,
    siteCode:       'RS-SUB-004',
    startDate:      daysFromNow(7),
    dueDate:        daysFromNow(14),
    createdBy:      adminUid,
    projectId:      p2.id,
    projectTitle:   p2.projectNum,
    projectNum:     p2.projectNum,
  });
  console.log(`   ✓ ${t6.taskNum} — Initial Maintenance Survey\n`);

  // ── Final counter verification ───────────────────────────────────────────────
  console.log('🔍  Final counter verification…');
  const configSnap = await getDoc(doc(db, 'appConfig', 'global'));
  const finalPc = configSnap.data()?.['projectNumCounter'] ?? '?';
  const finalTc = configSnap.data()?.['taskNumCounter']    ?? '?';
  console.log(`   projectNumCounter: ${finalPc}  (expected: 2 higher than start)`);
  console.log(`   taskNumCounter:    ${finalTc}  (expected: 6 higher than start)\n`);

  // ── Summary ─────────────────────────────────────────────────────────────────
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('✅  Reseed complete!\n');
  console.log('  Projects created:');
  console.log(`    ${p1.projectNum}  ${p1.id}  Site A — Solar Installation`);
  console.log(`    ${p2.projectNum}  ${p2.id}  Substation 4 — Full Setup\n`);
  console.log('  Tasks created:');
  console.log(`    ${t1.taskNum}  →  ${p1.projectNum}  Solar Panel Installation`);
  console.log(`    ${t2.taskNum}  →  ${p1.projectNum}  Feeder Cable Routing`);
  console.log(`    ${t3.taskNum}  →  ${p1.projectNum}  Meter Configuration`);
  console.log(`    ${t4.taskNum}  →  ${p2.projectNum}  RTU Configuration`);
  console.log(`    ${t5.taskNum}  →  ${p2.projectNum}  EA Fault Check`);
  console.log(`    ${t6.taskNum}  →  ${p2.projectNum}  Initial Maintenance Survey`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  process.exit(0);
}

main().catch((err) => {
  console.error('\n❌  Reseed failed:', err.message ?? err);
  process.exit(1);
});
