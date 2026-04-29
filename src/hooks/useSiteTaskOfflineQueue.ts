import { useState, useEffect, useCallback } from 'react';
import { openDB, type IDBPDatabase } from 'idb';
import type { QueuedSiteTaskUpdate } from '@/types';

// ─── IDB config ───────────────────────────────────────────────────────────────
// Separate DB from the v2.1 `fieldops-offline` so there is zero version
// conflict with the existing OfflineQueueProcessor.

const DB_NAME    = 'fieldops-offline-st';
const DB_VERSION = 1;
const STORE      = 'queue';

// ─── Reactive change signal ───────────────────────────────────────────────────
// Every write (enqueue / dequeue / update) dispatches this custom DOM event.
// All mounted hook instances listen for it and re-read the count from IDB,
// which keeps the OfflineBanner and any other consumer in sync without a
// shared Zustand store.

const CHANGE_EVENT = 'st-queue-changed';

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

// ─── Standalone async helpers (used by SiteTaskQueueProcessor) ───────────────

/** Add a new item to the queue. Emits CHANGE_EVENT. */
export async function enqueueSTUpdate(
  item: Omit<QueuedSiteTaskUpdate, 'id'>,
): Promise<void> {
  const db = await getDB();
  await db.add(STORE, item);
  emitQueueChanged();
}

/** Return all queued items in insertion order. */
export async function getAllQueuedST(): Promise<QueuedSiteTaskUpdate[]> {
  const db = await getDB();
  return db.getAll(STORE) as Promise<QueuedSiteTaskUpdate[]>;
}

/** Remove a processed item by its IDB key. Emits CHANGE_EVENT. */
export async function dequeueSTUpdate(id: number): Promise<void> {
  const db = await getDB();
  await db.delete(STORE, id);
  emitQueueChanged();
}

/** Patch an existing item (e.g. increment attempts / record lastError). */
export async function updateSTQueueItem(
  id:      number,
  updates: Partial<QueuedSiteTaskUpdate>,
): Promise<void> {
  const db       = await getDB();
  const existing = await db.get(STORE, id) as QueuedSiteTaskUpdate | undefined;
  if (existing) {
    await db.put(STORE, { ...existing, ...updates });
    emitQueueChanged();
  }
}

/** Return the current count of queued items. */
export async function getSTQueueCount(): Promise<number> {
  const db = await getDB();
  return db.count(STORE);
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

interface UseSiteTaskOfflineQueueResult {
  /** Reactive count of items currently in the queue. */
  queueCount: number;
  /** Add an item. Returns a promise that resolves when IDB write is done. */
  enqueue:    (item: Omit<QueuedSiteTaskUpdate, 'id'>) => Promise<void>;
  /** Force-refresh the count (rarely needed outside the hook itself). */
  refreshCount: () => Promise<void>;
}

export function useSiteTaskOfflineQueue(): UseSiteTaskOfflineQueueResult {
  const [queueCount, setQueueCount] = useState(0);

  const refreshCount = useCallback(async () => {
    try {
      const count = await getSTQueueCount();
      setQueueCount(count);
    } catch {
      // IDB unavailable (private browsing / storage denied) — silently ignore
    }
  }, []);

  // Read count on mount and re-read whenever any write mutates the queue.
  useEffect(() => {
    refreshCount();

    function handleChange() { refreshCount(); }
    window.addEventListener(CHANGE_EVENT, handleChange);
    return () => window.removeEventListener(CHANGE_EVENT, handleChange);
  }, [refreshCount]);

  const enqueue = useCallback(
    async (item: Omit<QueuedSiteTaskUpdate, 'id'>) => {
      await enqueueSTUpdate(item);
      // enqueueSTUpdate already dispatches CHANGE_EVENT → refreshCount fires automatically
    },
    [],
  );

  return { queueCount, enqueue, refreshCount };
}
