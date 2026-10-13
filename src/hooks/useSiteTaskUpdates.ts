import { useEffect, useState } from 'react';
import { collection, query, orderBy, onSnapshot } from 'firebase/firestore';
import { db } from '@/firebase/config';
import type { TaskStatus } from '@/types';

/** One submission snapshot from siteTasks/{id}/updates. */
export interface SiteTaskUpdateEntry {
  id:              string;
  submittedByName: string;
  submittedAt:     Date;
  status:          TaskStatus;
  blockedReason:   string | null;
  /** Answers as they stood at submission time, when the snapshot carried them. */
  subtaskAnswers:  Record<string, { value: string; type: string }> | null;
  reviewNotes:     string | null;
}

/**
 * Submission history for one site task.
 *
 * Takes no "enabled" flag on purpose. The lifecycle detail page UNMOUNTS a
 * row's body on collapse, so the listener is created on expand and torn down
 * on collapse by React itself — a flag would only duplicate that, and the
 * caller would still be free to get it wrong. Callers that must not subscribe
 * simply do not render the component that calls this.
 *
 * Read-only — nothing here writes, matching the page it serves.
 */
export function useSiteTaskUpdates(taskId: string) {
  const [updates, setUpdates] = useState<SiteTaskUpdateEntry[]>([]);
  // Starts true: the listener is opened immediately below, so there is never
  // a frame where this reports "loaded, empty" before the first snapshot.
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(
      collection(db, 'siteTasks', taskId, 'updates'),
      orderBy('submittedAt', 'desc'),
    );

    const unsubscribe = onSnapshot(
      q,
      (snap) => {
        setUpdates(snap.docs.map((d) => {
          const data = d.data();
          return {
            id:              d.id,
            submittedByName: data['submittedByName'] ?? data['submittedBy'] ?? 'Unknown',
            submittedAt:     data['submittedAt']?.toDate?.() ?? new Date(),
            status:          (data['status'] ?? 'pending') as TaskStatus,
            blockedReason:   data['blockedReason'] ?? null,
            subtaskAnswers:  data['subtaskAnswers'] ?? null,
            reviewNotes:     data['reviewNotes'] ?? null,
          };
        }));
        setLoading(false);
      },
      (err) => {
        console.error('[useSiteTaskUpdates] listener error:', err);
        setLoading(false);
      },
    );

    return () => unsubscribe();
  }, [taskId]);

  return { updates, loading };
}
