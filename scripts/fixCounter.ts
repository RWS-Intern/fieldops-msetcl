/**
 * fixCounter.ts
 * Sets appConfig/global.taskNumCounter to 8 so the next task created via the
 * modal gets number RS:009, correctly accounting for the 6 seeded tasks plus
 * the 2 tasks already created through the modal.
 *
 * Requires VITE_ADMIN_EMAIL + VITE_ADMIN_PASSWORD in .env.local.
 * Run once: npm run fix:counter
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, doc, setDoc } from 'firebase/firestore';

const {
  VITE_FIREBASE_API_KEY,
  VITE_FIREBASE_AUTH_DOMAIN,
  VITE_FIREBASE_PROJECT_ID,
  VITE_FIREBASE_MESSAGING_SENDER_ID,
  VITE_FIREBASE_APP_ID,
  VITE_ADMIN_EMAIL,
  VITE_ADMIN_PASSWORD,
} = process.env;

if (!VITE_FIREBASE_PROJECT_ID) {
  console.error('❌  Missing VITE_FIREBASE_PROJECT_ID — check your .env.local file');
  process.exit(1);
}

if (!VITE_ADMIN_EMAIL || !VITE_ADMIN_PASSWORD) {
  console.error(
    '❌  Missing VITE_ADMIN_EMAIL or VITE_ADMIN_PASSWORD in .env.local\n' +
    '   Add them and re-run:  npm run fix:counter'
  );
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

async function fixCounter() {
  // Must authenticate as admin — Firestore rules require isAdmin() for appConfig writes
  console.log('🔑  Signing in as admin…');
  await signInWithEmailAndPassword(auth, VITE_ADMIN_EMAIL!, VITE_ADMIN_PASSWORD!);
  console.log('✅  Signed in');

  const configRef = doc(db, 'appConfig', 'global');
  await setDoc(configRef, { taskNumCounter: 8 }, { merge: true });

  console.log('✅  appConfig/global.taskNumCounter set to 8');
  console.log('   Next task created via the modal will be RS:009');
  process.exit(0);
}

fixCounter().catch((err) => {
  console.error('❌  Failed to update counter:', err.message ?? err);
  process.exit(1);
});
