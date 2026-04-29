import { useEffect, useState } from 'react';
import {
  collection,
  query,
  where,
  onSnapshot,
} from 'firebase/firestore';
import { db } from '@/firebase/config';
import type { SiteTask, TaskStatus } from '@/types';

/**
 * Real-time listener for all (non-archived) site tasks assigned to a specific
 * engineer. Returns the full SiteTask objects so callers can either compute
 * stats or render the full list.
 *
 * Pass uid = '' to get an empty, immediately-resolved result (used for
 * admin user cards where no tasks should be shown).
 *
 * Uses a single `where('assignedTo', '==', uid)` clause — Firestore's
 * auto-index covers single-field equality queries with no composite index
 * required. Client-side archived filter keeps the query simple.
 */
export function useEngineerTasks(uid: string) {
  const [tasks,   setTasks]   = useState<SiteTask[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!uid) {
      setTasks([]);
      setLoading(false);
      return;
    }

    setLoading(true);

    const q = query(
      collection(db, 'siteTasks'),
      where('assignedTo', '==', uid),
    );

    const unsubscribe = onSnapshot(
      q,
      (snap) => {
        const result: SiteTask[] = snap.docs
          .map((d) => {
            const data = d.data();
            return {
              id:               d.id,
              taskCode:         data['taskCode']         ?? '',
              siteId:           data['siteId']           ?? '',
              siteCode:         data['siteCode']         ?? '',
              siteName:         data['siteName']         ?? '',
              city:             data['city']             ?? '',
              projectId:        data['projectId']        ?? '',
              projectName:      data['projectName']      ?? '',
              projectCode:      data['projectCode']      ?? '',
              taskKey:          data['taskKey']          ?? '',
              taskLabel:        data['taskLabel']        ?? '',
              taskColour:       data['taskColour']       ?? '#9CA3AF',
              subtasks:         data['subtasks']         ?? [],
              assignedTo:       data['assignedTo']       ?? null,
              assignedToName:   data['assignedToName']   ?? null,
              assignedToCode:   data['assignedToCode']   ?? null,
              status:           (data['status'] ?? 'pending') as TaskStatus,
              startDate:        data['startDate']?.toDate?.()  ?? null,
              dueDate:          data['dueDate']?.toDate?.()    ?? null,
              subtaskAnswers:   data['subtaskAnswers']   ?? {},
              subtaskPhotos:    data['subtaskPhotos']    ?? {},
              completionPhotos: data['completionPhotos'] ?? [],
              blockedReason:    data['blockedReason']    ?? null,
              location:         data['location']         ?? null,
              submittedBy:      data['submittedBy']      ?? null,
              submittedAt:      data['submittedAt']?.toDate?.() ?? null,
              createdAt:        data['createdAt']?.toDate?.()   ?? new Date(),
              updatedAt:        data['updatedAt']?.toDate?.()   ?? new Date(),
              archived:         data['archived']         ?? false,
              archivedAt:       data['archivedAt']?.toDate?.()  ?? null,
            } as SiteTask;
          })
          // Client-side archived filter keeps the Firestore query single-field
          .filter((t) => !t.archived);

        setTasks(result);
        setLoading(false);
      },
      (err) => {
        console.error('[useEngineerTasks] listener error:', err);
        setLoading(false);
      },
    );

    return () => unsubscribe();
  }, [uid]);

  return { tasks, loading };
}
