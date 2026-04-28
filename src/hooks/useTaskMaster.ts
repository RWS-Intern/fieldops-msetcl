import { useState, useEffect } from 'react';
import {
  collection, query, where,
  orderBy, onSnapshot,
} from 'firebase/firestore';
import { db } from '@/firebase/config';
import type { TaskType, SubtaskDefinition } from '@/types';

// ─── Firestore → TaskType mapper ──────────────────────────────────────────────
// Explicit field mapping ensures defaults are applied even when Firestore docs
// predate a field being added (e.g. `options` was added later).
// Exported so useTaskMasterAdmin can share the same mapping logic.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapTaskType(id: string, data: Record<string, any>): TaskType {
  const rawSubtasks: SubtaskDefinition[] = (
    (data['subtasks'] ?? []) as SubtaskDefinition[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ).map((s: any) => ({
    subtaskId:      s.subtaskId      ?? `sub_${Math.random().toString(36).slice(2)}`,
    label:          s.label          ?? '',
    collectionType: s.collectionType ?? 'yesno',
    isRequired:     s.isRequired     ?? false,
    imageRequired:  s.imageRequired  ?? false,
    options:        s.options        ?? [],
    sortOrder:      s.sortOrder      ?? 0,
  }));

  return {
    id,
    typeLabel:            data['typeLabel']                   ?? '',
    colour:               data['colour']                      ?? '#9CA3AF',
    sortOrder:            data['sortOrder']                   ?? 0,
    active:               data['active']                      ?? true,
    subtasks:             rawSubtasks,
    lastSyncedFromSheets: data['lastSyncedFromSheets']?.toDate?.() ?? null,
  };
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useTaskMaster() {
  const [taskTypes, setTaskTypes] = useState<TaskType[]>([]);
  const [loading,   setLoading]   = useState(true);

  useEffect(() => {
    // Only active types — field engineers never need inactive ones.
    // Firestore composite index: active ASC + sortOrder ASC (or allow client sort).
    const q = query(
      collection(db, 'taskMaster'),
      where('active', '==', true),
      orderBy('sortOrder', 'asc'),
    );

    const unsubscribe = onSnapshot(
      q,
      (snap) => {
        const types: TaskType[] = snap.docs.map((d) => mapTaskType(d.id, d.data()));
        setTaskTypes(types);
        setLoading(false);
      },
      (err) => {
        console.error('[useTaskMaster] snapshot error:', err);
        setLoading(false);
      },
    );

    return unsubscribe;
  }, []);

  const getTaskType = (typeId: string) =>
    taskTypes.find((t) => t.id === typeId);

  return { taskTypes, loading, getTaskType };
}
