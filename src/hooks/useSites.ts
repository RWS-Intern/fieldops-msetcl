import { useEffect, useRef } from 'react';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '@/firebase/config';
import { useSiteStore } from '@/store/siteStore';
import type { Site } from '@/types';

/**
 * Starts a real-time Firestore listener for non-archived sites.
 * Results are stored in siteStore for the whole session.
 * Call this once inside Layout (admin only).
 */
export function useSites() {
  const { setSites, setLastUpdated } = useSiteStore();
  const unsub = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (unsub.current) return; // already mounted

    const q = query(
      collection(db, 'sites'),
      where('archived', '==', false)
    );

    unsub.current = onSnapshot(q, (snap) => {
      const loaded: Site[] = snap.docs
        .map((d) => {
          const data = d.data();
          return {
            id:                 d.id,
            siteCode:           data['siteCode']           ?? '',
            siteName:           data['siteName']           ?? '',
            city:               data['city']               ?? '',
            state:              data['state']              ?? '',
            address:            data['address']            ?? '',
            projectId:          data['projectId']          ?? '',
            projectName:        data['projectName']        ?? '',
            projectCode:        data['projectCode']        ?? '',
            location:           data['location']
              ? { lat: data['location'].latitude, lng: data['location'].longitude }
              : null,
            status:              data['status']              ?? 'active',
            taskCount:           data['taskCount']           ?? 0,
            completedTaskCount:  data['completedTaskCount']  ?? 0,
            inProgressTaskCount: data['inProgressTaskCount'] ?? 0,
            blockedTaskCount:    data['blockedTaskCount']    ?? 0,
            createdBy:           data['createdBy']           ?? '',
            createdAt:          data['createdAt']?.toDate?.() ?? new Date(),
            archived:           data['archived']           ?? false,
            archivedAt:         data['archivedAt']?.toDate?.() ?? null,
            sapCode:             data['sapCode']             ?? null,
            zone:                data['zone']                ?? null,
            voltageClass:        data['voltageClass']        ?? null,
            totalBays:           data['totalBays']            ?? null,
            numPowerTransformers: data['numPowerTransformers'] ?? null,
            workOrderCounters:   data['workOrderCounters']    ?? {},
          } as Site;
        })
        // Client-side sort by createdAt descending (no composite index needed)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

      setSites(loaded);
      setLastUpdated(new Date());
    });

    return () => {
      unsub.current?.();
      unsub.current = null;
    };
  }, [setSites, setLastUpdated]);
}
