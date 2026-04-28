import { useEffect } from 'react';
import {
  collection,
  query,
  where,
  onSnapshot,
} from 'firebase/firestore';
import { db } from '@/firebase/config';
import { useAuthStore }              from '@/store/authStore';
import { useAssignedSiteTaskStore }  from '@/store/assignedSiteTaskStore';
import type { SiteTask, TaskStatus } from '@/types';

/**
 * Real-time listener for siteTasks assigned to the current user.
 * Intended for field engineer sessions — mount once via AssignedSiteTasksListener
 * in Layout.tsx.
 *
 * Query: where('assignedTo', '==', uid) — uses the auto-indexed assignedTo field.
 * No orderBy to avoid needing a composite index.  Archived filtering and
 * sorting are done client-side (same pattern as useSiteTasks).
 */
export function useAssignedSiteTasks() {
  const { currentUser }           = useAuthStore();
  const { setAssignedSiteTasks }  = useAssignedSiteTaskStore();

  useEffect(() => {
    if (!currentUser) return;

    console.log('[AssignedSiteTasks] hook mounted for uid:', currentUser.uid, 'role:', currentUser.role);

    const q = query(
      collection(db, 'siteTasks'),
      where('assignedTo', '==', currentUser.uid),
    );

    console.log('[AssignedSiteTasks] query fired for uid:', currentUser.uid);

    const unsubscribe = onSnapshot(
      q,
      (snap) => {
        console.log('[AssignedSiteTasks] snapshot received, docs:', snap.docs.length);
        snap.docs.forEach((d) =>
          console.log('[AssignedSiteTasks] doc:', d.id, 'assignedTo:', d.data().assignedTo, 'status:', d.data().status)
        );

        const tasks: SiteTask[] = snap.docs
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
          // Client-side archived filter — avoids needing a multi-field composite index.
          .filter((t) => !t.archived)
          // Most-recently-updated first.
          .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

        setAssignedSiteTasks(tasks);
      },
      (err) => {
        console.error('[AssignedSiteTasks] listener error:', err.code, err.message);
      },
    );

    return () => unsubscribe();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.uid]);
}
