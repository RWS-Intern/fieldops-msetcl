import {
  doc,
  addDoc,
  collection,
  getDocs,
  query,
  where,
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

// ── Orphaned-work detection ───────────────────────────────────────────────────
//
// Changing someone's role can strand work that is still pointing at them.
// This app has already had a survey work order stuck because it had no
// approver, so a role change away from `field` or `approver` warns with a
// count first.
//
// Deliberately SINGLE-FIELD EQUALITY queries only (assignedTo / approverUid),
// with the status test applied client-side afterwards. A `where status not-in
// [...]` alongside the equality clause would demand a new composite index;
// these queries need none beyond Firestore's automatic single-field indexes.

/** A piece of work in one of these states needs nothing further from its assignee. */
const TERMINAL_STATUSES = ['completed', 'approved', 'closed'];

export interface OrphanedWorkCounts {
  /** Open siteTasks + workOrders still assigned to them as field engineer. */
  assigned:       number;
  /** siteTasks + surveyReports sitting in pending_approval waiting on them. */
  awaitingReview: number;
}

/**
 * Counts work that would be stranded by moving `uid` off `fromRole`.
 * Returns zeros for roles that own no work queue (admin, viewer).
 */
export async function countOrphanedWork(
  uid:      string,
  fromRole: UserRole,
): Promise<OrphanedWorkCounts> {
  if (fromRole === 'field') {
    const [siteTasks, workOrders] = await Promise.all([
      getDocs(query(collection(db, 'siteTasks'),  where('assignedTo', '==', uid))),
      getDocs(query(collection(db, 'workOrders'), where('assignedTo', '==', uid))),
    ]);
    const assigned = [...siteTasks.docs, ...workOrders.docs].filter((d) => {
      const data = d.data();
      if (data['archived'] === true) return false;
      return !TERMINAL_STATUSES.includes(data['status'] ?? '');
    }).length;
    return { assigned, awaitingReview: 0 };
  }

  if (fromRole === 'approver') {
    const [siteTasks, surveys] = await Promise.all([
      getDocs(query(collection(db, 'siteTasks'),     where('approverUid', '==', uid))),
      getDocs(query(collection(db, 'surveyReports'), where('approverUid', '==', uid))),
    ]);
    const awaitingReview = [...siteTasks.docs, ...surveys.docs].filter(
      (d) => d.data()['status'] === 'pending_approval',
    ).length;
    return { assigned: 0, awaitingReview };
  }

  return { assigned: 0, awaitingReview: 0 };
}

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
    /**
     * Employing organisation — only meaningful for `approver` accounts (the
     * pickers show it to tell same-named reviewers from different
     * organisations apart). Stored as null for every other role.
     */
    organization?: string | null,
    /**
     * Vendor the engineer works for. Only meaningful for `field` accounts —
     * vendor-wise reporting covers the people doing the field work. Stored as
     * null for every other role, mirroring `organization` above.
     */
    vendor?: { id: string; name: string } | null,
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
        // Only approvers carry an organisation — it is what distinguishes two
        // same-named reviewers in the stage pickers. Null for every other role.
        organization:      role === 'approver' ? (organization?.trim() || null) : null,
        // Only field engineers carry a vendor. vendorName is denormalised so a
        // field session — which runs no vendors listener — can still show it.
        vendorId:          role === 'field' ? (vendor?.id   ?? null) : null,
        vendorName:        role === 'field' ? (vendor?.name ?? null) : null,
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
   * Assigns, changes or clears a field engineer's vendor.
   *
   * Writes vendorName alongside vendorId for the same reason createUser does —
   * a field session runs no vendors listener and could not resolve the id on
   * its own (see the field on User).
   *
   * Passing null clears both. That is what a move OFF the `field` role does:
   * vendor is a field-engineer concept, so leaving a stale one on an account
   * that is now an admin would put that person in vendor-wise reports they no
   * longer belong in.
   *
   * `silent` suppresses the success toast for exactly that case — clearing a
   * vendor as a side effect of a role change is not an action the admin took,
   * and announcing it alongside "Role updated" reads like a second edit.
   */
  async function setUserVendor(
    userId:  string,
    vendor:  { id: string; name: string } | null,
    silent = false,
  ): Promise<void> {
    try {
      await updateDoc(doc(db, 'users', userId), {
        vendorId:   vendor?.id   ?? null,
        vendorName: vendor?.name ?? null,
        updatedAt:  serverTimestamp(),
      });
      if (!silent) showToast(vendor ? 'Vendor updated' : 'Vendor cleared', 'success');
    } catch (err) {
      console.error('[setUserVendor] failed:', err);
      showToast('Failed to update vendor. Try again.', 'error');
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

  /**
   * Change a user's role. Admin-only, and never the acting admin's own role —
   * a sole admin demoting themselves would lock every account out of
   * administration, recoverable only from the Firebase console.
   *
   * Callers own the "last admin" and "orphaned work" checks (they need to be
   * able to show a count and ask for confirmation first) — see EditUserModal.
   * The two guards repeated here are the ones that must never be bypassed.
   *
   * Writes a CHANGE_USER_ROLE auditLog entry recording actor, target and both
   * roles — the kind of change a government client asks about.
   */
  async function changeUserRole(
    target:  { id: string; name: string; role: UserRole },
    newRole: UserRole,
  ): Promise<void> {
    if (!currentUser) throw new Error('Not signed in');
    if (currentUser.role !== 'admin') {
      showToast('Only an admin can change roles', 'error');
      throw new Error('Only an admin can change roles');
    }
    if (target.id === currentUser.uid) {
      showToast('You cannot change your own role', 'error');
      throw new Error('You cannot change your own role');
    }
    if (target.role === newRole) return;

    try {
      await updateDoc(doc(db, 'users', target.id), {
        role:      newRole,
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      console.error('[changeUserRole] failed:', err);
      showToast('Failed to change role. Try again.', 'error');
      throw err;
    }

    // Audit log — non-critical, never blocks the success toast.
    try {
      await addDoc(collection(db, 'auditLog'), {
        timestamp:  serverTimestamp(),
        uid:        currentUser.uid,
        userName:   currentUser.name,
        action:     'CHANGE_USER_ROLE',
        detail:     `Changed ${target.name}'s role from ${target.role} to ${newRole}`,
        targetUid:  target.id,
        targetName: target.name,
        oldRole:    target.role,
        newRole,
      });
    } catch (auditErr) {
      console.warn('[changeUserRole] auditLog write failed:', auditErr);
    }

    showToast('Role updated', 'success');
  }

  return { createUser, updateUserName, setUserActive, changeUserRole, setUserVendor };
}
