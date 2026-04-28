import { useState, useEffect } from 'react';
import {
  collectionGroup,
  onSnapshot,
  orderBy,
  query,
  limit,
} from 'firebase/firestore';
import { db } from '@/firebase/config';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TaskUpdateRow {
  id:               string;
  taskId:           string;
  taskNum:          string;
  taskTitle:        string;
  taskType:         string;
  siteCode:         string;
  submittedBy:      string;
  submittedByName:  string;
  submittedAt:      Date;
  status:           string;
  blockedReason:    string;
  completionPhotos: string[];
  location:         { lat: number; lng: number } | null;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useTaskUpdates() {
  const [updates, setUpdates] = useState<TaskUpdateRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(
      collectionGroup(db, 'updates'),
      orderBy('submittedAt', 'desc'),
      limit(200), // cap at 200 most recent; increase as scale requires
    );

    const unsubscribe = onSnapshot(
      q,
      (snap) => {
        const rows: TaskUpdateRow[] = snap.docs.map((d) => {
          const data   = d.data();
          // Path shape: tasks/{taskId}/updates/{updateId}
          const taskId = d.ref.path.split('/')[1];

          // Firestore GeoPoint has .latitude/.longitude;
          // plain objects stored from the web SDK use .lat/.lng
          const rawLoc  = data['location'];
          const location = rawLoc
            ? {
                lat: rawLoc.latitude  ?? rawLoc.lat  ?? 0,
                lng: rawLoc.longitude ?? rawLoc.lng  ?? 0,
              }
            : null;

          return {
            id:               d.id,
            taskId,
            taskNum:          data['taskNum']          ?? '',
            taskTitle:        data['taskTitle']         ?? '',
            taskType:         data['taskType']          ?? '',
            siteCode:         data['siteCode']          ?? '',
            submittedBy:      data['submittedBy']       ?? '',
            submittedByName:  data['submittedByName']   ?? '',
            submittedAt:      data['submittedAt']?.toDate?.() ?? new Date(),
            status:           data['status']            ?? '',
            blockedReason:    data['blockedReason']     ?? '',
            completionPhotos: data['completionPhotos']  ?? [],
            location,
          };
        });

        setUpdates(rows);
        setLoading(false);
      },
      (err) => {
        console.error('[useTaskUpdates] snapshot error:', err);
        setLoading(false);
      },
    );

    return unsubscribe;
  }, []);

  // Return shape is identical to the previous getDocs version so ReportsPage
  // needs no changes. Pagination stubs kept for interface compatibility.
  return {
    updates,
    loading,
    hasMore:  false,
    loadMore: () => {},
    refresh:  () => {},
  };
}
