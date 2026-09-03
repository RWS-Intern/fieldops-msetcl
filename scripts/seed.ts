import * as dotenv from 'dotenv';
import * as path from 'path';
import { fileURLToPath } from 'url';

// Load .env.local
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

import { initializeApp } from 'firebase/app';
import { getFirestore, doc, setDoc, serverTimestamp } from 'firebase/firestore';

const {
  VITE_FIREBASE_API_KEY,
  VITE_FIREBASE_AUTH_DOMAIN,
  VITE_FIREBASE_PROJECT_ID,
  VITE_FIREBASE_MESSAGING_SENDER_ID,
  VITE_FIREBASE_APP_ID,
  VITE_ADMIN_UID,
  VITE_FIELD_UID,
} = process.env;

if (!VITE_FIREBASE_PROJECT_ID) {
  console.error('ERROR: Firebase config missing. Fill in .env.local first.');
  process.exit(1);
}
if (!VITE_ADMIN_UID || !VITE_FIELD_UID) {
  console.error(
    'ERROR: VITE_ADMIN_UID or VITE_FIELD_UID not set in .env.local.\n' +
    'Copy the UIDs from Firebase Console → Authentication → Users, then re-run.'
  );
  process.exit(1);
}

const app = initializeApp({
  apiKey:            VITE_FIREBASE_API_KEY,
  authDomain:        VITE_FIREBASE_AUTH_DOMAIN,
  projectId:         VITE_FIREBASE_PROJECT_ID,
  messagingSenderId: VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId:             VITE_FIREBASE_APP_ID,
});

const db = getFirestore(app);

async function seed() {
  // 1. appConfig/global
  await setDoc(doc(db, 'appConfig', 'global'), {
    orgName:          'Rite Water Solutions',
    taskNumPrefix:    'RS',
    taskNumCounter:   0,
    mapDefaultLat:    24.8607,
    mapDefaultLng:    67.0011,
    mapDefaultZoom:   11,
  });
  console.log('  ✓ appConfig/global');

  // 2. users
  await setDoc(doc(db, 'users', VITE_ADMIN_UID as string), {
    name:      'Rite Admin',
    email:     'admin@ritewater.in',
    role:      'admin',
    active:    true,
    createdAt: serverTimestamp(),
    deletedAt: null,
  });
  console.log(`  ✓ users/${VITE_ADMIN_UID}`);

  await setDoc(doc(db, 'users', VITE_FIELD_UID as string), {
    name:      'Field Engineer',
    email:     'field@ritewater.in',
    role:      'field',
    active:    true,
    createdAt: serverTimestamp(),
    deletedAt: null,
  });
  console.log(`  ✓ users/${VITE_FIELD_UID}`);

  // 3. taskMaster
  await setDoc(doc(db, 'taskMaster', 'new_config'), {
    typeLabel: 'New Configuration',
    colour:    '#0077B6',
    sortOrder: 1,
    active:    true,
    subtasks: [
      { subtaskId: 'installation', label: 'Installation Complete',   collectionType: 'yesno',      isRequired: true,  imageRequired: true,  sortOrder: 1 },
      { subtaskId: 'rtu',          label: 'RTU Installed',           collectionType: 'yesno',      isRequired: true,  imageRequired: false, sortOrder: 2 },
      { subtaskId: 'modem',        label: 'Modem Installed',         collectionType: 'yesno',      isRequired: true,  imageRequired: false, sortOrder: 3 },
      { subtaskId: 'sld',          label: 'SLD Updated',             collectionType: 'yesno',      isRequired: true,  imageRequired: true,  sortOrder: 4 },
      { subtaskId: 'analog',       label: 'Analog Points Checked',   collectionType: 'yesno',      isRequired: true,  imageRequired: false, sortOrder: 5 },
      { subtaskId: 'sim',          label: 'SIM Card Installed',      collectionType: 'yesno',      isRequired: true,  imageRequired: false, sortOrder: 6 },
      { subtaskId: 'ss_code',      label: 'SS Code Assigned',        collectionType: 'text',       isRequired: true,  imageRequired: false, sortOrder: 7 },
      { subtaskId: 'issues',       label: 'Issues Found',            collectionType: 'yesno',      isRequired: true,  imageRequired: false, sortOrder: 8 },
      { subtaskId: 'issues_detail',label: 'Issues Detail',           collectionType: 'text',       isRequired: false, imageRequired: false, sortOrder: 9 },
      { subtaskId: 'signoff',      label: 'Site Sign-Off Photo',     collectionType: 'image_only', isRequired: true,  imageRequired: true,  sortOrder: 10 },
    ],
  });
  console.log('  ✓ taskMaster/new_config');
  
  await setDoc(doc(db, 'taskMaster', 'solar_feeder'), {
    typeLabel: 'Solar Feeder Addition',
    colour:    '#F59E0B',
    sortOrder: 2,
    active:    true,
    subtasks: [
      { subtaskId: 'panels',     label: 'Panels Installed',    collectionType: 'yesno',  isRequired: true, imageRequired: true,  sortOrder: 1 },
      { subtaskId: 'inverter',   label: 'Inverter Connected',  collectionType: 'yesno',  isRequired: true, imageRequired: false, sortOrder: 2 },
      { subtaskId: 'metering',   label: 'Metering Checked',    collectionType: 'yesno',  isRequired: true, imageRequired: false, sortOrder: 3 },
      { subtaskId: 'load_test',  label: 'Load Test Passed',    collectionType: 'yesno',  isRequired: true, imageRequired: false, sortOrder: 4 },
      { subtaskId: 'panel_cond', label: 'Panel Condition',     collectionType: 'select', isRequired: true, imageRequired: false, options: ['Good', 'Fair', 'Damaged'], sortOrder: 5 },
      { subtaskId: 'issues',     label: 'Issues Found',        collectionType: 'yesno',  isRequired: true, imageRequired: false, sortOrder: 6 },
    ],
  });
  console.log('  ✓ taskMaster/solar_feeder');

  await setDoc(doc(db, 'taskMaster', 'ea_rectification'), {
    typeLabel: 'EA Rectification',
    colour:    '#E63946',
    sortOrder: 3,
    active:    true,
    subtasks: [
      { subtaskId: 'fault_type',    label: 'Fault Type',            collectionType: 'select', isRequired: true,  imageRequired: false, options: ['Electrical', 'Mechanical', 'Communication', 'Other'], sortOrder: 1 },
      { subtaskId: 'diagnosis',     label: 'Diagnosis Notes',       collectionType: 'text',   isRequired: true,  imageRequired: false, sortOrder: 2 },
      { subtaskId: 'parts_replaced',label: 'Parts Replaced',        collectionType: 'yesno',  isRequired: true,  imageRequired: false, sortOrder: 3 },
      { subtaskId: 'parts_detail',  label: 'Parts Detail',          collectionType: 'text',   isRequired: false, imageRequired: false, sortOrder: 4 },
      { subtaskId: 'post_test',     label: 'Post-Repair Test Passed',collectionType: 'yesno',  isRequired: true,  imageRequired: false, sortOrder: 5 },
      { subtaskId: 'meter_reading', label: 'Meter Reading',         collectionType: 'number', isRequired: true,  imageRequired: false, sortOrder: 6 },
      { subtaskId: 'residual',      label: 'Residual Issues',       collectionType: 'yesno',  isRequired: true,  imageRequired: false, sortOrder: 7 },
    ],
  });
  console.log('  ✓ taskMaster/ea_rectification');

  await setDoc(doc(db, 'taskMaster', 'routine_maintenance'), {
    typeLabel: 'Routine Maintenance',
    colour:    '#2A9D8F',
    sortOrder: 4,
    active:    true,
    subtasks: [
      { subtaskId: 'visual',       label: 'Visual Inspection Complete', collectionType: 'yesno',  isRequired: true, imageRequired: true,  sortOrder: 1 },
      { subtaskId: 'cleaning',     label: 'Cleaning Complete',          collectionType: 'yesno',  isRequired: true, imageRequired: false, sortOrder: 2 },
      { subtaskId: 'readings',     label: 'Sensor Readings Taken',      collectionType: 'yesno',  isRequired: true, imageRequired: false, sortOrder: 3 },
      { subtaskId: 'reading_value',label: 'Reading Value',              collectionType: 'number', isRequired: true, imageRequired: false, sortOrder: 4 },
      { subtaskId: 'calibration',  label: 'Calibration Checked',        collectionType: 'yesno',  isRequired: true, imageRequired: false, sortOrder: 5 },
      { subtaskId: 'anomalies',    label: 'Anomalies Found',            collectionType: 'yesno',  isRequired: true, imageRequired: false, sortOrder: 6 },
    ],
  });
  console.log('  ✓ taskMaster/routine_maintenance');

  console.log('\nSeed complete. Collections written: appConfig, users, taskMaster');
  console.log('Total documents: 7 (1 appConfig + 2 users + 4 taskMaster)');
  process.exit(0);
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
