/**
 * scripts/migrateEngineerCodes.ts
 *
 * Back-fills `engineerCode` on existing Firestore user documents that were
 * created before Phase A (i.e. they have no engineerCode field).
 *
 * Algorithm
 * ---------
 * 1. Sign in as admin.
 * 2. Read appConfig/global to find the current engineerNumCounter.
 * 3. Collect all user docs that lack engineerCode, sorted by createdAt ASC
 *    so codes are assigned in the order users were created.
 * 4. For each such user, run a Firestore transaction:
 *      a. Increment engineerNumCounter atomically.
 *      b. Write engineerCode = "ENG-xxx" to the user doc.
 *    This guarantees uniqueness even if the script is interrupted and re-run
 *    (already-patched users are skipped in step 3).
 *
 * Prerequisites: VITE_ADMIN_EMAIL + VITE_ADMIN_PASSWORD in .env.local
 * Run once:      npm run migrate:engineer-codes
 *
 * Safe to re-run — users that already have engineerCode are skipped.
 */

import * as dotenv from 'dotenv';
import * as path   from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

import { initializeApp }                       from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import {
  getFirestore,
  collection,
  getDocs,
  doc,
  runTransaction,
} from 'firebase/firestore';

// ─── Firebase init ─────────────────────────────────────────────────────────────

const firebaseConfig = {
  apiKey:            process.env['VITE_FIREBASE_API_KEY'],
  authDomain:        process.env['VITE_FIREBASE_AUTH_DOMAIN'],
  projectId:         process.env['VITE_FIREBASE_PROJECT_ID'],
  messagingSenderId: process.env['VITE_FIREBASE_MESSAGING_SENDER_ID'],
  appId:             process.env['VITE_FIREBASE_APP_ID'],
};

if (!firebaseConfig.projectId) {
  console.error('❌  Missing VITE_FIREBASE_PROJECT_ID — check your .env.local file');
  process.exit(1);
}

const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const email    = process.env['VITE_ADMIN_EMAIL'];
  const password = process.env['VITE_ADMIN_PASSWORD'];

  if (!email || !password) {
    console.error('❌  VITE_ADMIN_EMAIL and VITE_ADMIN_PASSWORD must be set in .env.local');
    process.exit(1);
  }

  console.log('🔑  Signing in as admin…');
  await signInWithEmailAndPassword(auth, email, password);
  console.log('✅  Signed in\n');

  // ── Fetch all users ──────────────────────────────────────────────────────────
  const usersSnap = await getDocs(collection(db, 'users'));
  console.log(`📋  Found ${usersSnap.docs.length} user document(s)`);

  // Filter to those missing engineerCode, sort by createdAt ascending so codes
  // are assigned chronologically (oldest user → ENG-001, etc.)
  type RawUser = { id: string; email: string; createdAt: { toMillis?: () => number } | null };

  const needsCode: RawUser[] = usersSnap.docs
    .filter((d) => !d.data()['engineerCode'])
    .map((d) => ({
      id:        d.id,
      email:     d.data()['email'] as string ?? '(no email)',
      createdAt: d.data()['createdAt'] ?? null,
    }))
    .sort((a, b) => {
      const aMs = a.createdAt?.toMillis?.() ?? 0;
      const bMs = b.createdAt?.toMillis?.() ?? 0;
      return aMs - bMs;
    });

  if (needsCode.length === 0) {
    console.log('\n✅  All users already have an engineerCode — nothing to do.');
    process.exit(0);
  }

  console.log(`\n🔧  ${needsCode.length} user(s) need an engineerCode:\n`);

  const configRef = doc(db, 'appConfig', 'global');
  let patched = 0;

  for (const user of needsCode) {
    let assignedCode = '';

    await runTransaction(db, async (tx) => {
      const configSnap = await tx.get(configRef);
      const next = ((configSnap.data()?.['engineerNumCounter'] as number | undefined) ?? 0) + 1;
      assignedCode = `ENG-${String(next).padStart(3, '0')}`;

      tx.update(configRef, { engineerNumCounter: next });
      tx.update(doc(db, 'users', user.id), { engineerCode: assignedCode });
    });

    console.log(`   ✏️   ${user.id} (${user.email}) → ${assignedCode}`);
    patched++;
  }

  const skipped = usersSnap.docs.length - patched;
  console.log(`\n✅  Done — ${patched} patched, ${skipped} already had a code`);
  process.exit(0);
}

main().catch((err) => {
  console.error('❌  migrateEngineerCodes failed:', err);
  process.exit(1);
});
