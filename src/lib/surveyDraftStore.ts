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
  /**
   * Date.now() when this device last confirmed a push of this draft to the
   * server, or undefined if it never has.
   *
   * Undefined on every draft written before remote sync existed, and while the
   * feature is switched off. chooseDraftSource reads that as "nothing from
   * this draft has ever reached the server" — see surveyDraftSync.ts for why
   * that must not be treated as a conflict.
   */
  lastSyncedAt?: number;
  /** Token written with this device's last confirmed push — see chooseDraftSource. */
  lastSyncedToken?: string;
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
  // Carried across rather than dropped: this is the 500ms local autosave, and
  // clearing lastSyncedAt on every keystroke would make a synced draft look
  // as though it had never been pushed.
  const existing = (await db.get(STORE, workOrderId)) as SurveyDraft | undefined;
  const record: SurveyDraft = {
    workOrderId,
    data:      draft.data,
    stepIndex: draft.stepIndex,
    updatedAt: Date.now(),
    ...(existing?.lastSyncedAt !== undefined ? { lastSyncedAt: existing.lastSyncedAt } : {}),
    ...(existing?.lastSyncedToken !== undefined ? { lastSyncedToken: existing.lastSyncedToken } : {}),
  };
  await db.put(STORE, record);
}

/**
 * Records that this device just pushed the draft to the server.
 *
 * Separate from saveDraft so the marker is written ONLY on a confirmed push —
 * setting it alongside an ordinary local save would claim data reached the
 * server when it had not, and chooseDraftSource would then discard newer
 * remote work believing this device was up to date.
 */
export async function markDraftSynced(workOrderId: string, token: string): Promise<void> {
  const db = await getDB();
  const existing = (await db.get(STORE, workOrderId)) as SurveyDraft | undefined;
  if (!existing) return;
  await db.put(STORE, { ...existing, lastSyncedAt: Date.now(), lastSyncedToken: token });
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
