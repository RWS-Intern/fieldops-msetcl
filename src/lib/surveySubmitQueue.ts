import { useState, useEffect, useCallback } from 'react';
import { openDB, type IDBPDatabase } from 'idb';
import type { SurveyReport } from '@/types';

// ─── IDB config ───────────────────────────────────────────────────────────────
// Separate DB from fieldops-offline / fieldops-offline-st (v2.1 + SiteTask
// queues) and from fieldops-survey-drafts (local-only draft autosave) — this
// store holds surveys that HAVE been submitted but couldn't reach Firestore
// yet, so it must survive independently of both.

const DB_NAME    = 'fieldops-survey-queue';
const DB_VERSION = 1;
const STORE      = 'queue';

// ─── Reactive change signal ───────────────────────────────────────────────────

const CHANGE_EVENT = 'survey-queue-changed';

function emitQueueChanged() {
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
}

// ─── Singleton DB promise ─────────────────────────────────────────────────────

let _dbPromise: Promise<IDBPDatabase> | null = null;

function getDB(): Promise<IDBPDatabase> {
  if (!_dbPromise) {
    _dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
        }
      },
    });
  }
  return _dbPromise;
}

// ─── Payload envelope ──────────────────────────────────────────────────────────

/**
 * Where an offline-captured photo belongs in the survey document, so the
 * processor can splice its uploaded Cloudinary URL into the right spot once
 * uploaded. No photo capture exists yet (that's task 3) — this shape exists
 * now so the queue schema never needs a migration when it lands.
 */
export type PendingSurveyPhotoTarget =
  | { kind: 'bay'; bayUid: string }
  | { kind: 'device'; deviceUid: string }
  | { kind: 'sitePhoto'; caption: string }
  | { kind: 'signOffSignedPage' };

export interface PendingSurveyPhoto {
  /** Stable id assigned at capture time — lets the processor log/dedupe. */
  photoId:  string;
  target:   PendingSurveyPhotoTarget;
  /** `data:` base64 URI — same convention as QueuedSiteTaskUpdate. */
  localUrl: string;
}

/**
 * The survey field payload as it stood at submit time. Ownership fields
 * (assignedTo/assignedToName/approverUid/approverName) and immutable
 * identifiers are excluded — an engineer write must never touch ownership
 * (the deployed rules reject it), and the identifiers are already carried on
 * the queue item's own top-level fields below.
 */
export type SurveyPayload = Omit<
  SurveyReport,
  | 'id' | 'workOrderId' | 'siteId'
  | 'assignedTo' | 'assignedToName' | 'approverUid' | 'approverName'
  | 'createdAt' | 'updatedAt'
>;

/** Strips a full SurveyReport down to the writable SurveyPayload shape. */
export function toSurveyPayload(survey: SurveyReport): SurveyPayload {
  const {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    id, workOrderId, siteId, assignedTo, assignedToName, approverUid, approverName,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    createdAt, updatedAt,
    ...rest
  } = survey;
  return rest;
}

export interface QueuedSurveySubmission {
  /** IDB auto-increment primary key — undefined before first insert. */
  id?: number;
  workOrderId:     string;
  surveyReportId:  string;
  /** Denormalised for display/logging in the processor and any queue-count UI. */
  siteCode:        string;
  submittedBy:     string;
  submittedByName: string;
  data:            SurveyPayload;
  /** Offline-captured photos awaiting upload — always [] until task 3. */
  pendingPhotos:   PendingSurveyPhoto[];
  /** Date.now() when this entry was queued. */
  queuedAt:  number;
  attempts:  number;
  lastError?: string;
}

// ─── Standalone async helpers (used by SurveyQueueProcessor) ─────────────────

/** Add a new item to the queue. Emits CHANGE_EVENT. */
export async function enqueueSurveySubmission(
  item: Omit<QueuedSurveySubmission, 'id'>,
): Promise<void> {
  const db = await getDB();
  await db.add(STORE, item);
  emitQueueChanged();
}

/** Return all queued items in insertion order. */
export async function getAllQueuedSurveys(): Promise<QueuedSurveySubmission[]> {
  const db = await getDB();
  return db.getAll(STORE) as Promise<QueuedSurveySubmission[]>;
}

/** Remove a processed item by its IDB key. Emits CHANGE_EVENT. */
export async function dequeueSurveySubmission(id: number): Promise<void> {
  const db = await getDB();
  await db.delete(STORE, id);
  emitQueueChanged();
}

/** Patch an existing item (e.g. increment attempts / record lastError). */
export async function updateSurveyQueueItem(
  id:      number,
  updates: Partial<QueuedSurveySubmission>,
): Promise<void> {
  const db       = await getDB();
  const existing = await db.get(STORE, id) as QueuedSurveySubmission | undefined;
  if (existing) {
    await db.put(STORE, { ...existing, ...updates });
    emitQueueChanged();
  }
}

/** Return the current count of queued items. */
export async function getSurveyQueueCount(): Promise<number> {
  const db = await getDB();
  return db.count(STORE);
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

interface UseSurveySubmitQueueResult {
  /** Reactive count of items currently in the queue. */
  queueCount: number;
  /** Add an item. Returns a promise that resolves when the IDB write is done. */
  enqueue:    (item: Omit<QueuedSurveySubmission, 'id'>) => Promise<void>;
  /** Force-refresh the count (rarely needed outside the hook itself). */
  refreshCount: () => Promise<void>;
}

export function useSurveySubmitQueue(): UseSurveySubmitQueueResult {
  const [queueCount, setQueueCount] = useState(0);

  const refreshCount = useCallback(async () => {
    try {
      const count = await getSurveyQueueCount();
      setQueueCount(count);
    } catch {
      // IDB unavailable (private browsing / storage denied) — silently ignore
    }
  }, []);

  useEffect(() => {
    function handleChange() { refreshCount(); }
    handleChange();
    window.addEventListener(CHANGE_EVENT, handleChange);
    return () => window.removeEventListener(CHANGE_EVENT, handleChange);
  }, [refreshCount]);

  const enqueue = useCallback(
    async (item: Omit<QueuedSurveySubmission, 'id'>) => {
      await enqueueSurveySubmission(item);
    },
    [],
  );

  return { queueCount, enqueue, refreshCount };
}
