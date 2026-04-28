/**
 * scripts/seedProjects.ts
 *
 * Seeds the projects collection with 2 sample projects, updates appConfig/global
 * with projectNumCounter + projectNumPrefix, and links existing tasks to projects.
 *
 * Task linkage:
 *   RS:001, RS:005  →  RP:001  (Site A — Solar Installation)
 *   RS:003          →  RP:002  (Substation 4 — Full Setup)
 *
 * Requires VITE_ADMIN_EMAIL + VITE_ADMIN_PASSWORD in .env.local.
 * Run: npm run seed:projects
 *
 * NOTE: Temporarily open Firestore rules for /projects write before running,
 *       then restore and redeploy: firebase deploy --only firestore:rules
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import {
  getFirestore,
  collection,
  doc,
  setDoc,
  addDoc,
  updateDoc,
  getDocs,
  query,
  where,
  Timestamp,
} from 'firebase/firestore';

const {
  VITE_FIREBASE_API_KEY,
  VITE_FIREBASE_AUTH_DOMAIN,
  VITE_FIREBASE_PROJECT_ID,
  VITE_FIREBASE_MESSAGING_SENDER_ID,
  VITE_FIREBASE_APP_ID,
  VITE_ADMIN_UID,
  VITE_FIELD_UID,
  VITE_ADMIN_EMAIL,
  VITE_ADMIN_PASSWORD,
} = process.env;

if (!VITE_FIREBASE_PROJECT_ID) {
  console.error('❌  Missing VITE_FIREBASE_PROJECT_ID — check .env.local');
  process.exit(1);
}
if (!VITE_ADMIN_EMAIL || !VITE_ADMIN_PASSWORD) {
  console.error('❌  Missing VITE_ADMIN_EMAIL or VITE_ADMIN_PASSWORD in .env.local');
  process.exit(1);
}

const app  = initializeApp({
  apiKey:            VITE_FIREBASE_API_KEY,
  authDomain:        VITE_FIREBASE_AUTH_DOMAIN,
  projectId:         VITE_FIREBASE_PROJECT_ID,
  messagingSenderId: VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId:             VITE_FIREBASE_APP_ID,
});

const auth = getAuth(app);
const db   = getFirestore(app);

// ─── Date helpers ──────────────────────────────────────────────────────────────

function daysFromNow(n: number): Timestamp {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return Timestamp.fromDate(d);
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function seed() {
  console.log('🔑  Signing in as admin…');
  await signInWithEmailAndPassword(auth, VITE_ADMIN_EMAIL!, VITE_ADMIN_PASSWORD!);
  console.log('✅  Signed in\n');

  const adminUid = VITE_ADMIN_UID ?? '';
  const fieldUid = VITE_FIELD_UID ?? '';

  // ── 1. Update appConfig ────────────────────────────────────────────────────
  console.log('📝  Updating appConfig/global…');
  await setDoc(
    doc(db, 'appConfig', 'global'),
    { projectNumCounter: 2, projectNumPrefix: 'RP' },
    { merge: true }
  );
  console.log('   projectNumCounter → 2');
  console.log('   projectNumPrefix  → RP\n');

  // ── 2. Create Project RP:001 ───────────────────────────────────────────────
  console.log('📁  Creating RP:001 — Site A Solar Installation…');
  const p1Ref = doc(collection(db, 'projects'));
  await setDoc(p1Ref, {
    projectNum:         'RP:001',
    title:              'Site A — Solar Installation',
    description:        'Complete solar feeder installation and configuration at Site A',
    status:             'in_progress',
    assignedTo:         [fieldUid],
    assignedToNames:    ['Field Engineer'],
    createdBy:          adminUid,
    siteCode:           'RS-SITE-001',
    startDate:          daysFromNow(0),
    dueDate:            daysFromNow(7),
    taskCount:          2,
    completedTaskCount: 0,
    createdAt:          Timestamp.now(),
    updatedAt:          Timestamp.now(),
  });
  console.log(`   Created: ${p1Ref.id}\n`);

  // ── 3. Create Project RP:002 ───────────────────────────────────────────────
  console.log('📁  Creating RP:002 — Substation 4 Full Setup…');
  const p2Ref = doc(collection(db, 'projects'));
  await setDoc(p2Ref, {
    projectNum:         'RP:002',
    title:              'Substation 4 — Full Setup',
    description:        'RTU configuration and EA checks at Substation 4',
    status:             'pending',
    assignedTo:         [fieldUid],
    assignedToNames:    ['Field Engineer'],
    createdBy:          adminUid,
    siteCode:           'RS-SUB-004',
    startDate:          daysFromNow(2),
    dueDate:            daysFromNow(14),
    taskCount:          1,
    completedTaskCount: 0,
    createdAt:          Timestamp.now(),
    updatedAt:          Timestamp.now(),
  });
  console.log(`   Created: ${p2Ref.id}\n`);

  // ── 4. Link tasks ──────────────────────────────────────────────────────────
  console.log('🔗  Linking tasks to projects…');

  // Find tasks by taskNum
  async function findTask(taskNum: string): Promise<string | null> {
    const snap = await getDocs(
      query(collection(db, 'tasks'), where('taskNum', '==', taskNum))
    );
    return snap.empty ? null : snap.docs[0].id;
  }

  // RS:001 → RP:001
  const t1Id = await findTask('RS:001');
  if (t1Id) {
    await updateDoc(doc(db, 'tasks', t1Id), {
      projectId:    p1Ref.id,
      projectTitle: 'Site A — Solar Installation',
      projectNum:   'RP:001',
    });
    console.log('   RS:001 → RP:001 ✓');
  } else {
    console.log('   RS:001 not found — skipping');
  }

  // RS:005 → RP:001
  const t2Id = await findTask('RS:005');
  if (t2Id) {
    await updateDoc(doc(db, 'tasks', t2Id), {
      projectId:    p1Ref.id,
      projectTitle: 'Site A — Solar Installation',
      projectNum:   'RP:001',
    });
    console.log('   RS:005 → RP:001 ✓');
  } else {
    console.log('   RS:005 not found — skipping');
  }

  // RS:003 → RP:002
  const t3Id = await findTask('RS:003');
  if (t3Id) {
    await updateDoc(doc(db, 'tasks', t3Id), {
      projectId:    p2Ref.id,
      projectTitle: 'Substation 4 — Full Setup',
      projectNum:   'RP:002',
    });
    console.log('   RS:003 → RP:002 ✓');
  } else {
    console.log('   RS:003 not found — skipping');
  }

  console.log('\n✅  Project seed complete.');
  console.log('   Remember to redeploy Firestore rules:');
  console.log('   firebase deploy --only firestore:rules');
  process.exit(0);
}

seed().catch((err) => {
  console.error('❌  Seed failed:', err.message ?? err);
  process.exit(1);
});
