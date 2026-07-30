import { openDB, type IDBPDatabase } from 'idb';
import type { SurveyReport } from '@/types';

/**
 * Local-only draft autosave for the survey wizard — a SEPARATE IndexedDB
 * database from the two existing offline submission queues
 * (fieldops-offline / fieldops-offline-st). Drafts here never reach
 * Firestore on their own; they exist purely so a 30–45 minute joint survey
 * survives a crash, battery death, or the app being closed mid-session.
 *
 * Keyed by workOrderId (NOT auto-increment) — exactly one draft per work
 * order, so an engineer can have several part-finished surveys on the
 * device at once without them colliding.
 */

const DB_NAME    = 'fieldops-survey-drafts';
const DB_VERSION = 1;
const STORE      = 'drafts';

export interface SurveyDraft {
  workOrderId: string;
  data:        Partial<SurveyReport>;
  stepIndex:   number;
  /** Date.now() at save time. */
  updatedAt:   number;
}

let _dbPromise: Promise<IDBPDatabase> | null = null;

function getDB(): Promise<IDBPDatabase> {
  if (!_dbPromise) {
    _dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'workOrderId' });
        }
      },
    });
  }
  return _dbPromise;
}

/** Save (or overwrite) the draft for a work order. */
export async function saveDraft(
  workOrderId: string,
  draft: { data: Partial<SurveyReport>; stepIndex: number },
): Promise<void> {
  const db = await getDB();
  const record: SurveyDraft = {
    workOrderId,
    data:      draft.data,
    stepIndex: draft.stepIndex,
    updatedAt: Date.now(),
  };
  await db.put(STORE, record);
}

/** Load the draft for a work order, or null if none exists. */
export async function loadDraft(workOrderId: string): Promise<SurveyDraft | null> {
  const db = await getDB();
  const draft = (await db.get(STORE, workOrderId)) as SurveyDraft | undefined;
  return draft ?? null;
}

/** Delete the draft for a work order — called on successful submit or discard. */
export async function deleteDraft(workOrderId: string): Promise<void> {
  const db = await getDB();
  await db.delete(STORE, workOrderId);
}

/** List every locally-stored draft, across all work orders. */
export async function listDrafts(): Promise<SurveyDraft[]> {
  const db = await getDB();
  return (await db.getAll(STORE)) as SurveyDraft[];
}
