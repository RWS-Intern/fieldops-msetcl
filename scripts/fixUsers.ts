/**
 * scripts/fixUsers.ts
 *
 * Patches existing Firestore user documents that are missing the `createdBy`
 * field (created by the old seed script before the field was added).
 *
 * For each user doc that lacks `createdBy`, sets it to the admin UID so the
 * Team page can display who created the account.
 *
 * Prerequisites:
 *   VITE_ADMIN_EMAIL + VITE_ADMIN_PASSWORD in .env.local
 *
 * Run: npm run fix:users
 */

import * as dotenv from 'dotenv';
import * as path   from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

import { initializeApp }                     from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import {
  getFirestore,
  collection,
  getDocs,
  doc,
  updateDoc,
  serverTimestamp,
} from 'firebase/firestore';

// ─── Firebase init ─────────────────────────────────────────────────────────────

const firebaseConfig = {
  apiKey:            process.env['VITE_FIREBASE_API_KEY'],
  authDomain:        process.env['VITE_FIREBASE_AUTH_DOMAIN'],
  projectId:         process.env['VITE_FIREBASE_PROJECT_ID'],
  storageBucket:     process.env['VITE_FIREBASE_STORAGE_BUCKET'],
  messagingSenderId: process.env['VITE_FIREBASE_MESSAGING_SENDER_ID'],
  appId:             process.env['VITE_FIREBASE_APP_ID'],
};

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

  console.log('🔐  Signing in as admin…');
  const cred = await signInWithEmailAndPassword(auth, email, password);
  const adminUid = cred.user.uid;
  console.log(`✅  Signed in — UID: ${adminUid}`);

  // Fetch all user docs
  const snap = await getDocs(collection(db, 'users'));
  console.log(`📋  Found ${snap.docs.length} user document(s)`);

  let patched = 0;
  let skipped = 0;

  for (const d of snap.docs) {
    const data = d.data();

    if (data['createdBy'] !== undefined && data['createdBy'] !== null && data['createdBy'] !== '') {
      console.log(`   ⏭   ${d.id} (${data['email']}) — createdBy already set, skipping`);
      skipped++;
      continue;
    }

    await updateDoc(doc(db, 'users', d.id), {
      createdBy: adminUid,
      updatedAt: serverTimestamp(),
    });
    console.log(`   ✏️   ${d.id} (${data['email']}) — patched createdBy → ${adminUid}`);
    patched++;
  }

  console.log(`\n✅  Done — ${patched} patched, ${skipped} skipped`);
  process.exit(0);
}

main().catch((err) => {
  console.error('❌  fixUsers failed:', err);
  process.exit(1);
});
