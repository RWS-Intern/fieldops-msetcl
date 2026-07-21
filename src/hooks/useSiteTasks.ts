import { useEffect, useState } from 'react';
import {
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
} from 'firebase/firestore';
import { db } from '@/firebase/config';
import type { SiteTask, TaskStatus } from '@/types';

/**
 * Real-time listener for site tasks belonging to a single site.
 * Uses the existing `siteId + taskKey` composite index (Phase A).
 * `archived` filtering is done client-side to avoid needing a 3-field index.
 */
export function useSiteTasks(siteId: string) {
  const [siteTasks, setSiteTasks] = useState<SiteTask[]>([]);
  const [loading,   setLoading]   = useState(true);

  useEffect(() => {
    if (!siteId) {
      setSiteTasks([]);
      setLoading(false);
      return;
    }

    setLoading(true);

    const q = query(
      collection(db, 'siteTasks'),
      where('siteId', '==', siteId),
      orderBy('taskKey', 'asc')
    );

    const unsubscribe = onSnapshot(
      q,
      (snap) => {
        const tasks: SiteTask[] = snap.docs
          .map((d) => {
            const data = d.data();
            return {
              id:                 d.id,
              taskCode:           data['taskCode']           ?? '',
              siteId:             data['siteId']             ?? '',
              siteCode:           data['siteCode']           ?? '',
              siteName:           data['siteName']           ?? '',
              city:               data['city']               ?? '',
              projectId:          data['projectId']          ?? '',
              projectName:        data['projectName']        ?? '',
              projectCode:        data['projectCode']        ?? '',
              taskKey:            data['taskKey']            ?? '',
              taskLabel:          data['taskLabel']          ?? '',
              taskColour:         data['taskColour']         ?? '#9CA3AF',
              subtasks:           data['subtasks']           ?? [],
              assignedTo:         data['assignedTo']         ?? null,
              assignedToName:     data['assignedToName']     ?? null,
              assignedToCode:     data['assignedToCode']     ?? null,
              status:             (data['status'] ?? 'pending') as TaskStatus,
              startDate:          data['startDate']?.toDate?.()  ?? null,
              dueDate:            data['dueDate']?.toDate?.()    ?? null,
              subtaskAnswers:     data['subtaskAnswers']     ?? {},
              subtaskPhotos:      data['subtaskPhotos']      ?? {},
              completionPhotos:   data['completionPhotos']   ?? [],
              blockedReason:      data['blockedReason']      ?? null,
              location:           data['location']           ?? null,
              submittedBy:        data['submittedBy']        ?? null,
              submittedAt:        data['submittedAt']?.toDate?.() ?? null,
              createdAt:          data['createdAt']?.toDate?.()   ?? new Date(),
              updatedAt:          data['updatedAt']?.toDate?.()   ?? new Date(),
              archived:           data['archived']           ?? false,
              archivedAt:         data['archivedAt']?.toDate?.()  ?? null,
              approverUid:        data['approverUid']        ?? null,
              approverName:       data['approverName']       ?? null,
              approverCode:       data['approverCode']       ?? null,
              reviewNotes:        data['reviewNotes']        ?? null,
              reviewedBy:         data['reviewedBy']         ?? null,
              reviewedByName:     data['reviewedByName']     ?? null,
              reviewedAt:         data['reviewedAt']?.toDate?.()  ?? null,
            } as SiteTask;
          })
          // Client-side archived filter — avoids needing a 3-field composite index
          .filter((t) => !t.archived);

        setSiteTasks(tasks);
        setLoading(false);
      },
      (err) => {
        console.error('[useSiteTasks] listener error:', err);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [siteId]);

  return { siteTasks, loading };
}
