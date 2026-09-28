/**
 * READ-ONLY audit: how many surveyReports actually hold relay entries?
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THIS SCRIPT MAKES NO WRITES OF ANY KIND.
 *
 * It imports only `collection`, `getDocs` and `query` from firebase/firestore —
 * `setDoc`, `updateDoc`, `deleteDoc`, `writeBatch` and `addDoc` are deliberately
 * NOT imported, so no write call can be added by accident or uncommented later
 * without a visible new import. There are no commented-out mutations anywhere
 * in this file, by design.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Run:  npx tsx scripts/checkRelayData.ts
 *
 * Authenticates as the admin from .env.local, matching every other script in
 * this directory (updateAppConfig.ts, seedProjects.ts, …). Admin auth is
 * REQUIRED, not convenience: firestore.rules grants `list` on surveyReports
 * only to isAdmin() / isViewer() / the assignee / the approver / a past-or-
 * present stage owner, so an unauthenticated read returns permission-denied.
 *
 * Asked before the CRP Relay Details step is removed from the wizard, to
 * replace an assumption ("some surveys probably have relay data") with a count.
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// .env.local specifically — NOT .env.development.local, which points at the
// dev project. The guard below re-checks the resolved project id anyway.
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, collection, getDocs, query } from 'firebase/firestore';

const {
  VITE_FIREBASE_API_KEY,
  VITE_FIREBASE_AUTH_DOMAIN,
  VITE_FIREBASE_PROJECT_ID,
  VITE_FIREBASE_MESSAGING_SENDER_ID,
  VITE_FIREBASE_APP_ID,
  VITE_ADMIN_EMAIL,
  VITE_ADMIN_PASSWORD,
} = process.env;

/** The `default` alias in .firebaserc. Anything else is refused below. */
const EXPECTED_PROJECT = 'fieldops-ritesolar';

if (!VITE_FIREBASE_PROJECT_ID) {
  console.error('ERROR: Firebase config missing from .env.local.');
  process.exit(1);
}
if (!VITE_ADMIN_EMAIL || !VITE_ADMIN_PASSWORD) {
  console.error('ERROR: VITE_ADMIN_EMAIL / VITE_ADMIN_PASSWORD missing from .env.local.');
  process.exit(1);
}
// Explicit guard rather than a comment: running this against dev would answer
// a different question and quietly look like a real result.
if (VITE_FIREBASE_PROJECT_ID !== EXPECTED_PROJECT) {
  console.error(
    `REFUSING TO RUN.\n` +
    `  .env.local points at : ${VITE_FIREBASE_PROJECT_ID}\n` +
    `  this audit expects   : ${EXPECTED_PROJECT} (the "default" alias)\n`
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

interface Row {
  id:            string;
  siteCode:      string;
  workOrderCode: string;
  status:        string;
  relayCount:    number;
  withPhotos:    number;
  submittedAt:   string;
}

async function run(): Promise<void> {
  console.log(`\nProject : ${VITE_FIREBASE_PROJECT_ID}  (production, "default" alias)`);
  console.log('Mode    : READ-ONLY — no writes are possible from this script\n');

  console.log('Signing in as admin…');
  await signInWithEmailAndPassword(auth, VITE_ADMIN_EMAIL!, VITE_ADMIN_PASSWORD!);
  console.log('Signed in.\n');

  // No where() filter: Firestore cannot query "array is non-empty", and a
  // filter would also hide documents missing the field entirely. Read all,
  // classify here. The collection is small enough for one pass.
  const snap = await getDocs(query(collection(db, 'surveyReports')));

  const withRelays: Row[] = [];
  let missingField = 0;
  let emptyArray   = 0;

  snap.forEach((d) => {
    const data   = d.data();
    const relays = data['relays'];

    if (relays === undefined || relays === null) { missingField++; return; }
    if (!Array.isArray(relays))                  { missingField++; return; }
    if (relays.length === 0)                     { emptyArray++;   return; }

    withRelays.push({
      id:            d.id,
      siteCode:      data['siteCode']      ?? '(none)',
      workOrderCode: data['workOrderCode'] ?? '(none)',
      status:        data['status']        ?? '(none)',
      relayCount:    relays.length,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      withPhotos:    relays.filter((r: any) => (r?.photos?.length ?? 0) > 0).length,
      submittedAt:   data['submittedAt']?.toDate?.()?.toISOString?.().slice(0, 10) ?? '—',
    });
  });

  console.log('─'.repeat(72));
  console.log(`Total surveyReports documents : ${snap.size}`);
  console.log(`  with >= 1 relay entry       : ${withRelays.length}`);
  console.log(`  with an empty relays[]      : ${emptyArray}`);
  console.log(`  with no relays field at all : ${missingField}`);
  console.log('─'.repeat(72));

  if (withRelays.length === 0) {
    console.log('\nNo survey holds relay data. Removing the step preserves nothing.\n');
    return;
  }

  const byStatus = new Map<string, number>();
  withRelays.forEach((r) => byStatus.set(r.status, (byStatus.get(r.status) ?? 0) + 1));

  console.log('\nBy status:');
  [...byStatus.entries()].sort().forEach(([s, n]) => console.log(`  ${s.padEnd(20)} ${n}`));

  console.log('\nSurveys holding relay data:\n');
  console.log(
    '  ' + 'SITE CODE'.padEnd(16) + 'WORK ORDER'.padEnd(18) +
    'STATUS'.padEnd(20) + 'RELAYS'.padEnd(8) + 'W/PHOTOS'.padEnd(10) + 'SUBMITTED'
  );
  withRelays
    .sort((a, b) => a.siteCode.localeCompare(b.siteCode))
    .forEach((r) => {
      console.log(
        '  ' + r.siteCode.padEnd(16) + r.workOrderCode.padEnd(18) +
        r.status.padEnd(20) + String(r.relayCount).padEnd(8) +
        String(r.withPhotos).padEnd(10) + r.submittedAt
      );
    });

  const totalEntries = withRelays.reduce((n, r) => n + r.relayCount, 0);
  const totalPhotos  = withRelays.reduce((n, r) => n + r.withPhotos, 0);
  console.log(`\n  ${totalEntries} relay entries in total, ${totalPhotos} of them carrying photos.\n`);
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\nFAILED:', err?.code ?? '', err?.message ?? err);
    if (err?.code === 'permission-denied') {
      console.error('The signed-in account is not an admin/viewer — firestore.rules refused the list.');
    }
    process.exit(1);
  });
