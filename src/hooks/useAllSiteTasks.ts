import { useEffect, useState } from 'react';
import {
  collection,
  query,
  orderBy,
  limit,
  onSnapshot,
} from 'firebase/firestore';
import { db } from '@/firebase/config';
import type { SiteTask, TaskStatus } from '@/types';

/**
 * Real-time listener for all (non-archived) site tasks, ordered by most
 * recently updated first. Used by the Reports page so filters can be applied
 * client-side across charts AND the submission history table simultaneously.
 *
 * Pass `enabled = false` to skip the subscription entirely (returns an empty
 * result immediately). Used on DashboardPage to avoid subscribing when the
 * current user is a field engineer (they use useAssignedSiteTasks instead).
 *
 * Capped at 1 000 documents — sufficient for the current scale. Increase the
 * limit if the corpus grows significantly.
 */
export function useAllSiteTasks(enabled = true) {
  const [tasks,   setTasks]   = useState<SiteTask[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!enabled) {
      setTasks([]);
      setLoading(false);
      return;
    }

    const q = query(
      collection(db, 'siteTasks'),
      orderBy('updatedAt', 'desc'),
      limit(1000),
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
              approverUid:      data['approverUid']      ?? null,
              approverName:     data['approverName']     ?? null,
              approverCode:     data['approverCode']     ?? null,
              reviewNotes:      data['reviewNotes']      ?? null,
              reviewedBy:       data['reviewedBy']       ?? null,
              reviewedByName:   data['reviewedByName']   ?? null,
              reviewedAt:       data['reviewedAt']?.toDate?.()  ?? null,
            } as SiteTask;
          })
          .filter((t) => !t.archived);

        setTasks(result);
        setLoading(false);
      },
      (err) => {
        console.error('[useAllSiteTasks] listener error:', err);
        setLoading(false);
      },
    );

    return () => unsubscribe();
  }, [enabled]);

  return { tasks, loading };
}
