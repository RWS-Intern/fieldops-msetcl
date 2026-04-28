import { v4 as uuidv4 } from 'uuid';
import {
  doc,
  setDoc,
  updateDoc,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore';
import { db } from '@/firebase/config';
import { useAuthStore } from '@/store/authStore';
import { useToast } from '@/components/ui/toast';
import type { UserRole } from '@/types';

export function useInviteActions() {
  const { currentUser } = useAuthStore();
  const { showToast }   = useToast();

  /**
   * Write a new invite document whose ID is an unguessable UUID.
   * Returns the inviteId so the caller can build the signup URL.
   */
  async function createInvite(
    name:  string,
    email: string,
    role:  UserRole,
  ): Promise<string> {
    const inviteId = uuidv4();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await setDoc(doc(db, 'invites', inviteId), {
      name,
      email,
      role,
      status:    'pending',
      createdBy: currentUser!.uid,
      createdAt: serverTimestamp(),
      expiresAt: Timestamp.fromDate(expiresAt),
    });

    return inviteId;
  }

  /**
   * Mark an invite as revoked so the link can no longer be used.
   */
  async function revokeInvite(inviteId: string): Promise<void> {
    try {
      await updateDoc(doc(db, 'invites', inviteId), {
        status:    'revoked',
        revokedAt: serverTimestamp(),
      });
      showToast('Invite revoked', 'success');
    } catch {
      showToast('Failed to revoke invite. Try again.', 'error');
      throw new Error('revokeInvite failed');
    }
  }

  return { createInvite, revokeInvite };
}
