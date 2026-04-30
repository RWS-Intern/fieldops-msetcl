import {
  doc,
  setDoc,
  updateDoc,
  serverTimestamp,
  runTransaction,
} from 'firebase/firestore';
import { initializeApp, getApps } from 'firebase/app';
import {
  getAuth,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut as secondarySignOut,
} from 'firebase/auth';
import { db, firebaseConfig } from '@/firebase/config';
import { useAuthStore } from '@/store/authStore';
import { useToast } from '@/components/ui/toast';
import type { UserRole } from '@/types';

// ── Secondary Firebase app ────────────────────────────────────────────────────
// Used exclusively for creating new Auth accounts without disturbing the
// admin's active session. createUserWithEmailAndPassword auto-signs-in on
// the instance it's called on — using a separate app isolates that side-effect.
// Initialized once at module load; guarded against duplicate initialization.
const secondaryApp =
  getApps().find((a) => a.name === 'secondary') ??
  initializeApp(firebaseConfig, 'secondary');
const secondaryAuth = getAuth(secondaryApp);

// ─────────────────────────────────────────────────────────────────────────────

export function useUserActions() {
  const { currentUser } = useAuthStore();
  const { showToast }   = useToast();

  /**
   * Create a new Firebase Auth account + Firestore user document, then
   * immediately send a password-reset email so the user can set their own
   * password before logging in for the first time.
   *
   * Uses a secondary Firebase app instance so the admin's auth session is
   * never interrupted.
   */
  async function createUser(
    name:  string,
    email: string,
    role:  UserRole,
  ): Promise<void> {
    // Random temp password — user will never know or use it.
    // They set their real password via the reset-email link.
    const tempPassword =
      Math.random().toString(36).slice(-10) +
      Math.random().toString(36).slice(-10) +
      'Aa1!';

    try {
      // Step 1 — Create the Auth account on the secondary instance
      const credential = await createUserWithEmailAndPassword(
        secondaryAuth,
        email.toLowerCase().trim(),
        tempPassword,
      );
      const uid = credential.user.uid;

      // Step 2 — Immediately sign out of secondary so the instance is clean
      await secondarySignOut(secondaryAuth);

      // Step 3 — Atomically claim the next engineerNumCounter and derive the
      // engineer code. Only field engineers receive an ENG-xxx code; admins get null.
      // runTransaction ensures two concurrent createUser calls never produce the
      // same ENG-xxx code.
      const configRef  = doc(db, 'appConfig', 'global');
      let engineerCode: string | null = null;

      if (role === 'field') {
        await runTransaction(db, async (tx) => {
          const configSnap = await tx.get(configRef);
          const next = ((configSnap.data()?.engineerNumCounter as number | undefined) ?? 0) + 1;
          engineerCode = `ENG-${String(next).padStart(3, '0')}`;
          tx.update(configRef, { engineerNumCounter: next });
        });
      }
      // Admin users: engineerCode stays null and the counter is NOT incremented.

      // Step 4 — Write the Firestore user document.
      // The admin is still signed in on the main auth instance, so
      // isAdmin() is satisfied and the write succeeds.
      await setDoc(doc(db, 'users', uid), {
        name:              name.trim(),
        email:             email.toLowerCase().trim(),
        role,
        active:            true,
        engineerCode:      role === 'field' ? engineerCode : null,
        createdAt:         serverTimestamp(),
        createdBy:         currentUser?.uid ?? '',
        fcmToken:          null,
        fcmTokenUpdatedAt: null,
        photoURL:          null,
      });

      // Step 5 — Send password-reset / setup email.
      // sendPasswordResetEmail does not require the user to be signed in,
      // so we can call it on either instance. Main auth keeps the admin session.
      await sendPasswordResetEmail(secondaryAuth, email.toLowerCase().trim());

      showToast(
        `Account created. Password setup email sent to ${email}.`,
        'success',
      );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      console.error('[createUser] error:', err);

      if (err.code === 'auth/email-already-in-use') {
        showToast('An account with this email already exists.', 'error');
      } else if (err.code === 'auth/invalid-email') {
        showToast('Invalid email address.', 'error');
      } else {
        showToast('Failed to create account. Try again.', 'error');
      }
      throw err;
    }
  }

  /**
   * Update a user's display name.
   * Firestore rule: allow write if isAdmin().
   */
  async function updateUserName(userId: string, newName: string): Promise<void> {
    const trimmed = newName.trim();
    if (!trimmed) {
      showToast('Name cannot be empty', 'error');
      return;
    }
    try {
      await updateDoc(doc(db, 'users', userId), {
        name:      trimmed,
        updatedAt: serverTimestamp(),
      });
      showToast('Name updated', 'success');
    } catch (err) {
      console.error('[updateUserName] failed:', err);
      showToast('Failed to update name. Try again.', 'error');
      throw err;
    }
  }

  /**
   * Enable or disable a user account.
   * Setting active=false will block the user from signing in (useAuth checks this).
   * currentUserId is compared to prevent an admin from disabling their own account.
   */
  async function setUserActive(
    userId:        string,
    active:        boolean,
    currentUserId: string,
  ): Promise<void> {
    if (userId === currentUserId) {
      showToast('You cannot disable your own account', 'error');
      return;
    }
    try {
      await updateDoc(doc(db, 'users', userId), {
        active,
        updatedAt: serverTimestamp(),
        // Record when account was disabled; clear when re-enabled
        deletedAt: active ? null : serverTimestamp(),
      });
      showToast(active ? 'Account enabled' : 'Account disabled', 'success');
    } catch (err) {
      console.error('[setUserActive] failed:', err);
      showToast('Failed to update account. Try again.', 'error');
      throw err;
    }
  }

  return { createUser, updateUserName, setUserActive };
}
