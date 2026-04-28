import * as dotenv from 'dotenv';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

import { initializeApp } from 'firebase/app';
import { getFirestore, collection, addDoc, serverTimestamp, Timestamp } from 'firebase/firestore';

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
  console.error('ERROR: VITE_ADMIN_UID or VITE_FIELD_UID not set in .env.local.');
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

function daysFromToday(offset: number): Timestamp {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  d.setHours(0, 0, 0, 0);
  return Timestamp.fromDate(d);
}

async function seedTasks() {
  const tasksRef = collection(db, 'tasks');

  const tasks = [
    {
      taskNum: 'RS:001',
      title: 'Solar Panel Installation — Site A',
      type: 'solar_feeder',
      description: 'Install 12 solar panels on the rooftop of Site A',
      assignedTo: VITE_FIELD_UID,
      assignedToName: 'Field Engineer',
      createdBy: VITE_ADMIN_UID,
      siteCode: 'RS-SITE-001',
      startDate: daysFromToday(0),
      dueDate: daysFromToday(2),
      status: 'pending',
      blockedReason: null,
      location: null,
      subtaskAnswers: {},
      subtaskPhotos: {},
      completionPhotos: [],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    {
      taskNum: 'RS:002',
      title: 'RTU Configuration — Substation 4',
      type: 'new_config',
      description: 'Configure RTU and modem at substation 4',
      assignedTo: VITE_FIELD_UID,
      assignedToName: 'Field Engineer',
      createdBy: VITE_ADMIN_UID,
      siteCode: 'RS-SUB-004',
      startDate: daysFromToday(-1),
      dueDate: daysFromToday(1),
      status: 'in_progress',
      blockedReason: null,
      location: null,
      subtaskAnswers: {},
      subtaskPhotos: {},
      completionPhotos: [],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    {
      taskNum: 'RS:003',
      title: 'EA Fault Repair — Feeder 7',
      type: 'ea_rectification',
      description: 'Diagnose and repair electrical fault on Feeder 7',
      assignedTo: VITE_FIELD_UID,
      assignedToName: 'Field Engineer',
      createdBy: VITE_ADMIN_UID,
      siteCode: 'RS-FEED-007',
      startDate: daysFromToday(-3),
      dueDate: daysFromToday(-1),
      status: 'blocked',
      blockedReason: 'Waiting for replacement parts to arrive',
      location: null,
      subtaskAnswers: {},
      subtaskPhotos: {},
      completionPhotos: [],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    {
      taskNum: 'RS:004',
      title: 'Routine Maintenance — Site B',
      type: 'routine_maintenance',
      description: 'Monthly maintenance check at Site B',
      assignedTo: VITE_FIELD_UID,
      assignedToName: 'Field Engineer',
      createdBy: VITE_ADMIN_UID,
      siteCode: 'RS-SITE-002',
      startDate: daysFromToday(-5),
      dueDate: daysFromToday(-2),
      status: 'completed',
      blockedReason: null,
      location: null,
      subtaskAnswers: {},
      subtaskPhotos: {},
      completionPhotos: [],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    {
      taskNum: 'RS:005',
      title: 'Solar Feeder Addition — Site C',
      type: 'solar_feeder',
      description: 'Add new solar feeder connection at Site C',
      assignedTo: VITE_FIELD_UID,
      assignedToName: 'Field Engineer',
      createdBy: VITE_ADMIN_UID,
      siteCode: 'RS-SITE-003',
      startDate: daysFromToday(0),
      dueDate: daysFromToday(5),
      status: 'pending',
      blockedReason: null,
      location: null,
      subtaskAnswers: {},
      subtaskPhotos: {},
      completionPhotos: [],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    {
      taskNum: 'RS:006',
      title: 'New Configuration — Substation 7',
      type: 'new_config',
      description: 'Full new configuration setup at Substation 7',
      assignedTo: VITE_FIELD_UID,
      assignedToName: 'Field Engineer',
      createdBy: VITE_ADMIN_UID,
      siteCode: 'RS-SUB-007',
      startDate: daysFromToday(-2),
      dueDate: daysFromToday(3),
      status: 'in_progress',
      blockedReason: null,
      location: null,
      subtaskAnswers: {},
      subtaskPhotos: {},
      completionPhotos: [],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
  ];

  for (const task of tasks) {
    const ref = await addDoc(tasksRef, task);
    console.log(`  ✓ ${task.taskNum} — ${task.title} [${ref.id}]`);
  }

  console.log('\nTasks seeded: 6 documents written to tasks collection');
  console.log('Status breakdown: 2 pending, 2 in_progress, 1 completed, 1 blocked');
  console.log('Note: RS:003 is overdue (dueDate in the past)');
  process.exit(0);
}

seedTasks().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
