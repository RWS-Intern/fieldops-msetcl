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
import { useProjectStore } from '@/store/projectStore';
import type { Project } from '@/types';

export function useProjects() {
  const { currentUser }                       = useAuthStore();
  const { projects, setProjects, setLastUpdated } = useProjectStore();
  const [loading, setLoading]                 = useState(true);

  useEffect(() => {
    if (!currentUser) return;

    const ref = collection(db, 'projects');

    // Admin and viewer see all projects, unscoped; field sees only projects
    // they are assigned to. The field query requires a composite index on
    // (assignedTo ARRAY_CONTAINS, createdAt DESC) — see firestore.indexes.json.
    // The unscoped branch needs no composite index, so adding 'viewer' to it
    // adds no index requirement.
    const seesAllProjects =
      currentUser.role === 'admin' || currentUser.role === 'viewer';
    const q =
      seesAllProjects
        ? query(ref, orderBy('createdAt', 'desc'))
        : query(
            ref,
            where('assignedTo', 'array-contains', currentUser.uid),
            orderBy('createdAt', 'desc')
          );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const loaded: Project[] = snapshot.docs.map((doc) => {
          const d = doc.data();
          return {
            id:                 doc.id,
            projectNum:         d['projectNum']         ?? '',
            title:              d['title']              ?? '',
            description:        d['description']        ?? undefined,
            status:             d['status']             ?? 'pending',
            assignedTo:         d['assignedTo']         ?? [],
            assignedToNames:    d['assignedToNames']    ?? [],
            createdBy:          d['createdBy']          ?? '',
            createdAt:          d['createdAt']?.toDate?.()   ?? new Date(),
            siteCode:           d['siteCode']           ?? undefined,
            startDate:          d['startDate']?.toDate?.()   ?? new Date(),
            dueDate:            d['dueDate']?.toDate?.()     ?? new Date(),
            taskCount:          d['taskCount']          ?? 0,
            completedTaskCount: d['completedTaskCount'] ?? 0,
            updatedAt:          d['updatedAt']?.toDate?.()   ?? new Date(),
            // v3.0 additions
            projectCode:    d['projectCode']    ?? '',
            active:         d['active']         !== false,   // default true
            taskTemplates:  d['taskTemplates']  ?? [],
            defaultApproverUid:  d['defaultApproverUid']  ?? null,
            defaultApproverName: d['defaultApproverName'] ?? null,
            // Archive
            archived:    d['archived']              ?? false,
            archivedAt:  d['archivedAt']?.toDate?.() ?? null,
          } as Project;
        });

        // Filter archived projects out of every normal view.
        const filtered = loaded.filter((p) => p.archived !== true);
        setProjects(filtered);
        setLastUpdated(new Date());
        setLoading(false);
      },
      (error) => {
        console.error('[useProjects] Firestore listener error:', error);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.uid, currentUser?.role]);

  return { projects, loading };
}
