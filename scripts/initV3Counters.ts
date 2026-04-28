/**
 * scripts/initV3Counters.ts
 *
 * Adds the three v3.0 counter fields to appConfig/global (merge-safe —
 * will NOT overwrite any existing field).
 *
 *   siteNumCounter       — incremented each time a new Site is created
 *   engineerNumCounter   — incremented each time a new user is created
 *   siteTaskNumCounter   — incremented each time a new SiteTask is created
 *
 * All start at 0.  If they already exist the script reports their current
 * value and skips the write.
 *
 * Prerequisites: VITE_ADMIN_EMAIL + VITE_ADMIN_PASSWORD in .env.local
 * Run once:      npm run init:v3-counters
 */

import * as dotenv from 'dotenv';
import * as path   from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

import { initializeApp }                        from 'firebase/app';
import { getAuth, signInWithEmailAndPassword }   from 'firebase/auth';
import { getFirestore, doc, getDoc, setDoc }    from 'firebase/firestore';

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
  console.log('✅  Signed in');

  const configRef  = doc(db, 'appConfig', 'global');
  const configSnap = await getDoc(configRef);
  const data       = configSnap.exists() ? configSnap.data() : {};

  const COUNTER_KEYS = ['siteNumCounter', 'engineerNumCounter', 'siteTaskNumCounter'] as const;

  let anyMissing = false;
  const patch: Record<string, number> = {};

  for (const key of COUNTER_KEYS) {
    if (data[key] !== undefined) {
      console.log(`   ⏭   ${key} already set to ${data[key]} — skipping`);
    } else {
      console.log(`   ✏️   ${key} missing — will set to 0`);
      patch[key] = 0;
      anyMissing = true;
    }
  }

  if (!anyMissing) {
    console.log('\n✅  All v3.0 counters already present — nothing to do.');
    process.exit(0);
  }

  await setDoc(configRef, patch, { merge: true });

  console.log('\n✅  appConfig/global updated:');
  for (const [k, v] of Object.entries(patch)) {
    console.log(`     ${k} → ${v}`);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error('❌  initV3Counters failed:', err);
  process.exit(1);
});
