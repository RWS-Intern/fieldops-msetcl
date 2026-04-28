import { useState, useEffect } from 'react';
import { collection, query, orderBy, onSnapshot } from 'firebase/firestore';
import { db } from '@/firebase/config';
import { mapTaskType } from '@/hooks/useTaskMaster';
import type { TaskType } from '@/types';

/**
 * useTaskMasterAdmin — real-time listener for the admin Task Master page.
 *
 * Differences from useTaskMaster (field engineer hook):
 *  - Uses onSnapshot (live updates) instead of a one-time getDocs + cache
 *  - Returns ALL task types, including inactive ones
 *  - Should only be mounted inside an admin session
 */
export function useTaskMasterAdmin() {
  const [taskTypes, setTaskTypes] = useState<TaskType[]>([]);
  const [loading,   setLoading]   = useState(true);

  useEffect(() => {
    const q = query(
      collection(db, 'taskMaster'),
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
        console.error('[useTaskMasterAdmin] snapshot error:', err);
        setLoading(false);
      },
    );

    return unsubscribe;
  }, []);

  return { taskTypes, loading };
}
