import { useEffect } from 'react';
import { collection, query, orderBy, onSnapshot } from 'firebase/firestore';
import { db } from '@/firebase/config';
import { useUserStore } from '@/store/userStore';
import type { User } from '@/types';

/**
 * useUsers — attaches a real-time Firestore listener on the users collection.
 * Mount this once (via UsersListener in Layout) for the whole admin session.
 * Non-admin sessions should never call this hook.
 */
export function useUsers() {
  const { setUsers, setLoading } = useUserStore();

  useEffect(() => {
    setLoading(true);

    const q = query(
      collection(db, 'users'),
      orderBy('createdAt', 'asc'),
    );

    const unsubscribe = onSnapshot(
      q,
      (snap) => {
        const users: User[] = snap.docs.map((d) => {
          const data = d.data();
          return {
            id:                 d.id,
            name:               data['name']               ?? '',
            email:              data['email']              ?? '',
            role:               data['role']               ?? 'field',
            active:             data['active']             ?? true,
            createdAt:          data['createdAt']?.toDate?.()         ?? new Date(),
            createdBy:          data['createdBy']          ?? undefined,
            deletedAt:          data['deletedAt']?.toDate?.()         ?? null,
            photoURL:           data['photoURL']           ?? undefined,
            fcmToken:           data['fcmToken']           ?? undefined,
            fcmTokenUpdatedAt:  data['fcmTokenUpdatedAt']?.toDate?.() ?? undefined,
            engineerCode:       data['engineerCode']       ?? undefined,
          };
        });
        setUsers(users);
        setLoading(false);
      },
      (err) => {
        console.error('[useUsers] snapshot error:', err);
        setLoading(false);
      },
    );

    return unsubscribe;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
