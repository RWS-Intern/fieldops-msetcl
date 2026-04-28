import { useEffect, useState } from 'react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '@/firebase/config';
import { useAuthStore } from '@/store/authStore';
import type { AppUser, UserRole } from '@/types';

export function useAuth() {
  const { setCurrentUser, setLoading, setAuthError } = useAuthStore();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setError(null);

      if (!firebaseUser) {
        setCurrentUser(null);
        setLoading(false);
        return;
      }

      try {
        // Get token with custom claims
        const tokenResult = await firebaseUser.getIdTokenResult(true);
        const role = (tokenResult.claims['role'] as UserRole) ?? null;

        // Fetch Firestore user doc
        const userDocRef = doc(db, 'users', firebaseUser.uid);
        let userSnap = await getDoc(userDocRef);

        if (!userSnap.exists()) {
          // Give the signup flow 1 s to finish writing the user doc before
          // concluding that the account is genuinely incomplete.
          await new Promise((r) => setTimeout(r, 1000));
          const retrySnap = await getDoc(userDocRef);

          if (!retrySnap.exists()) {
            await signOut(auth);
            setCurrentUser(null);
            setLoading(false);
            setError('Account setup incomplete. Contact your administrator.');
            return;
          }

          userSnap = retrySnap;
        }

        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const data = userSnap.data()!;

        if (data['active'] === false) {
          await signOut(auth);
          setCurrentUser(null);
          setLoading(false);
          // Store in global authStore so the message survives the signOut and
          // remains visible on the LoginPage after the component re-renders.
          setAuthError('Account disabled. Contact your administrator.');
          return;
        }

        const appUser: AppUser = {
          uid:       firebaseUser.uid,
          email:     firebaseUser.email ?? data['email'] ?? '',
          name:      data['name'] ?? '',
          role:      (role ?? data['role']) as UserRole,
          active:    data['active'] ?? true,
          createdAt: data['createdAt']?.toDate?.() ?? new Date(),
          deletedAt: data['deletedAt'] ?? null,
          photoURL:  data['photoURL'] ?? firebaseUser.photoURL ?? undefined,
          createdBy: data['createdBy'] ?? undefined,
        };

        setCurrentUser(appUser);
      } catch (err) {
        console.error('Auth state error:', err);
        setCurrentUser(null);
        setError('Authentication error. Please try again.');
      } finally {
        setLoading(false);
      }
    });

    return () => unsubscribe();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { error };
}
