import { useEffect, useState } from 'react';
import {
  collection,
  query,
  where,
  onSnapshot,
} from 'firebase/firestore';
import { db } from '@/firebase/config';
import { useAuthStore } from '@/store/authStore';
import type { SiteTask, TaskStatus } from '@/types';

/**
 * Real-time listener for site tasks the current user has personally reviewed
 * (approved or sent back) — used for the approver dashboard's "this week"
 * stats and "Recently Reviewed" list.
 *
 * Query: where('reviewedBy', '==', uid) — single-field equality, no
 * composite index required (same pattern as useApprovalQueue/useEngineerTasks).
 * Date-range (last 7 days) and archived filtering, plus sorting, are done
 * client-side.
 */
export function useReviewedSiteTasks() {
  const { currentUser } = useAuthStore();
  const [tasks,   setTasks]   = useState<SiteTask[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!currentUser) {
      setTasks([]);
      setLoading(false);
      return;
    }

    setLoading(true);

    const q = query(
      collection(db, 'siteTasks'),
      where('reviewedBy', '==', currentUser.uid),
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
          // Client-side archived filter keeps the Firestore query single-field.
          .filter((t) => !t.archived);

        setTasks(result);
        setLoading(false);
      },
      (err) => {
        console.error('[useReviewedSiteTasks] listener error:', err);
        setLoading(false);
      },
    );

    return () => unsubscribe();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.uid]);

  return { tasks, loading };
}
