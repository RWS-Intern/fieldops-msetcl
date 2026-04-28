import { useState, useEffect, useCallback } from 'react';
import { openDB, type IDBPDatabase } from 'idb';
import type { TaskStatus, CollectionType } from '@/types';

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface QueuedUpdate {
  id?: number;                    // auto-increment primary key
  taskId: string;
  taskNum: string;
  userId: string;
  payload: {
    status: TaskStatus;
    blockedReason: string | null;
    subtaskAnswers: Record<string, { value: string; type: CollectionType }>;
    subtaskPhotos: Record<string, string[]>;
    completionPhotos: string[];
    location: { lat: number; lng: number } | null;
    /** Carried through so submitTaskUpdate can sync project status on replay. */
    projectId?: string;
  };
  enqueuedAt: number;             // Date.now()
}

// ─── IDB helpers ──────────────────────────────────────────────────────────────

const DB_NAME    = 'fieldops-offline';
const DB_VERSION = 1;
const STORE      = 'queue';

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

export async function enqueueUpdate(item: Omit<QueuedUpdate, 'id'>): Promise<void> {
  const db = await getDB();
  await db.add(STORE, item);
}

export async function getAllQueued(): Promise<QueuedUpdate[]> {
  const db = await getDB();
  return db.getAll(STORE) as Promise<QueuedUpdate[]>;
}

export async function dequeueUpdate(id: number): Promise<void> {
  const db = await getDB();
  await db.delete(STORE, id);
}

export async function getQueueCount(): Promise<number> {
  const db = await getDB();
  return db.count(STORE);
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

interface UseOfflineQueueResult {
  queueCount: number;
  enqueue: (item: Omit<QueuedUpdate, 'id'>) => Promise<void>;
  refreshCount: () => Promise<void>;
}

export function useOfflineQueue(): UseOfflineQueueResult {
  const [queueCount, setQueueCount] = useState(0);

  const refreshCount = useCallback(async () => {
    try {
      const count = await getQueueCount();
      setQueueCount(count);
    } catch {
      // IDB not available (SSR / private mode)
    }
  }, []);

  useEffect(() => {
    refreshCount();
  }, [refreshCount]);

  const enqueue = useCallback(async (item: Omit<QueuedUpdate, 'id'>) => {
    await enqueueUpdate(item);
    await refreshCount();
  }, [refreshCount]);

  return { queueCount, enqueue, refreshCount };
}
