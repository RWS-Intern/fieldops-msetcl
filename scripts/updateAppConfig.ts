/**
 * scripts/updateAppConfig.ts
 *
 * Updates appConfig/global with correct map default coordinates.
 * The previous defaults (Karachi) were wrong — field work is across India.
 * New defaults centre on India with a wide zoom so the admin can see all tasks.
 *
 * Requires VITE_ADMIN_EMAIL + VITE_ADMIN_PASSWORD in .env.local.
 * Run once: npm run update:config
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
    '   Add them and re-run:  npm run update:config'
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

async function updateConfig() {
  console.log('🔑  Signing in as admin…');
  await signInWithEmailAndPassword(auth, VITE_ADMIN_EMAIL!, VITE_ADMIN_PASSWORD!);
  console.log('✅  Signed in');

  const configRef = doc(db, 'appConfig', 'global');
  await setDoc(
    configRef,
    {
      // Centre of India — shows the whole country at zoom 5 so all field
      // tasks are visible regardless of which state the engineer is in.
      mapDefaultLat:  20.5937,
      mapDefaultLng:  78.9629,
      mapDefaultZoom: 5,
    },
    { merge: true }   // keep taskNumCounter and other fields intact
  );

  console.log('✅  appConfig/global updated:');
  console.log('     mapDefaultLat  → 20.5937');
  console.log('     mapDefaultLng  → 78.9629');
  console.log('     mapDefaultZoom → 5');
  console.log('\n   Map will now default to India overview.');
  console.log('   When GPS-tagged tasks exist the map auto-fits to their bounds.');
  process.exit(0);
}

updateConfig().catch((err) => {
  console.error('❌  Failed to update appConfig:', err.message ?? err);
  process.exit(1);
});
