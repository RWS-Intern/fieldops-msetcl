import { useEffect, useState } from 'react';
import {
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
} from 'firebase/firestore';
import { db } from '@/firebase/config';
import { useAuthStore } from '@/store/authStore';
import { useTaskStore } from '@/store/taskStore';
import type { Task } from '@/types';

export function useTasks() {
  const { currentUser } = useAuthStore();
  const { tasks, setTasks, setLastUpdated, setIsConnected } = useTaskStore();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!currentUser) return;

    const tasksRef = collection(db, 'tasks');

    const q =
      currentUser.role === 'admin'
        ? query(tasksRef, orderBy('createdAt', 'desc'))
        : query(
            tasksRef,
            where('assignedTo', '==', currentUser.uid),
            orderBy('createdAt', 'desc')
          );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const loaded: Task[] = snapshot.docs.map((doc) => {
          const d = doc.data();
          return {
            id:              doc.id,
            taskNum:         d['taskNum'] ?? '',
            title:           d['title'] ?? '',
            type:            d['type'] ?? '',
            description:     d['description'] ?? '',
            assignedTo:      d['assignedTo'] ?? '',
            assignedToName:  d['assignedToName'] ?? '',
            createdBy:       d['createdBy'] ?? '',
            siteCode:        d['siteCode'] ?? '',
            startDate:       d['startDate']?.toDate?.() ?? new Date(),
            dueDate:         d['dueDate']?.toDate?.() ?? new Date(),
            status:          d['status'] ?? 'pending',
            blockedReason:   d['blockedReason'] ?? null,
            location:        d['location'] ?? null,
            subtaskAnswers:  d['subtaskAnswers'] ?? {},
            subtaskPhotos:   d['subtaskPhotos'] ?? {},
            completionPhotos: d['completionPhotos'] ?? [],
            createdAt:       d['createdAt']?.toDate?.() ?? new Date(),
            updatedAt:       d['updatedAt']?.toDate?.() ?? new Date(),
            submittedBy:     d['submittedBy']     ?? undefined,
            submittedByName: d['submittedByName'] ?? undefined,
            submittedAt:     d['submittedAt']?.toDate?.() ?? undefined,
            // Project linkage (optional — null when standalone task)
            projectId:    d['projectId']    ?? null,
            projectTitle: d['projectTitle'] ?? null,
            projectNum:   d['projectNum']   ?? null,
            // Archive
            archived:    d['archived']             ?? false,
            archivedAt:  d['archivedAt']?.toDate?.() ?? null,
          } as Task;
        });

        // Filter archived tasks out of every normal view — archived items are
        // only shown via the explicit "Show archived" toggle in TasksPage.
        const filtered = loaded.filter((t) => t.archived !== true);
        setTasks(filtered);
        setLastUpdated(new Date());
        setIsConnected(true);
        setLoading(false);
      },
      (error) => {
        console.error('[useTasks] Firestore listener error:', error);
        setIsConnected(false);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.uid, currentUser?.role]);

  return { tasks, loading };
}
