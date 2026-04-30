import {
  doc,
  collection,
  updateDoc,
  addDoc,
  runTransaction,
  serverTimestamp,
} from 'firebase/firestore';
import { db }            from '@/firebase/config';
import { useAuthStore }  from '@/store/authStore';
import type { TaskStatus, CollectionType } from '@/types';

// ─── Input type ────────────────────────────────────────────────────────────────

export interface SubmitSiteTaskUpdateInput {
  status:           TaskStatus;
  /** Required when status === 'blocked' */
  blockedReason?:   string | null;
  subtaskAnswers:   Record<string, { value: string; type: CollectionType }>;
  subtaskPhotos:    Record<string, string[]>;
  completionPhotos: string[];
  location:         { lat: number; lng: number } | null;
  /** Needed to update completedTaskCount on the parent site document. */
  siteId:           string;
  siteCode:         string;
  taskCode:         string;
  taskLabel:        string;
  /**
   * The task status BEFORE this update.
   * Used to determine whether to increment or decrement completedTaskCount:
   *   non-completed → completed : +1
   *   completed     → non-completed : -1
   *   no change in completed state : 0
   */
  previousStatus:   TaskStatus;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useSiteTaskActions() {
  const { currentUser } = useAuthStore();

  /**
   * Submit a field-engineer update for a site task.
   * Writes to:
   *   - siteTasks/{taskId}               — updates status, answers, photos, GPS
   *   - siteTasks/{taskId}/updates/{id}  — immutable submission snapshot
   *   - sites/{siteId}                   — completedTaskCount increment/decrement
   *   - auditLog                          — non-critical audit entry
   */
  async function submitSiteTaskUpdate(
    taskId: string,
    data:   SubmitSiteTaskUpdateInput,
  ): Promise<void> {
    if (!currentUser) throw new Error('Not authenticated');

    const taskRef = doc(db, 'siteTasks', taskId);

    // ── Update siteTask document ──────────────────────────────────────────────
    await updateDoc(taskRef, {
      status:           data.status,
      blockedReason:    data.blockedReason    ?? null,
      subtaskAnswers:   data.subtaskAnswers,
      subtaskPhotos:    data.subtaskPhotos,
      completionPhotos: data.completionPhotos,
      location:         data.location,
      submittedBy:      currentUser.uid,
      submittedAt:      serverTimestamp(),
      updatedAt:        serverTimestamp(),
    });

    // ── Immutable update snapshot ─────────────────────────────────────────────
    await addDoc(collection(db, 'siteTasks', taskId, 'updates'), {
      submittedBy:      currentUser.uid,
      submittedByName:  currentUser.name,
      submittedAt:      serverTimestamp(),
      status:           data.status,
      location:         data.location,
      blockedReason:    data.blockedReason    ?? null,
      subtaskAnswers:   data.subtaskAnswers,
      subtaskPhotos:    data.subtaskPhotos    ?? {},
      completionPhotos: data.completionPhotos ?? [],
      // Denormalised task metadata for history display
      taskCode:         data.taskCode,
      taskLabel:        data.taskLabel,
      siteCode:         data.siteCode,
    });

    // ── Update task-status counters + derive site.status ─────────────────────
    // Using a transaction so we can read the current counter values, compute the
    // new counts precisely, and then decide whether site.status flips between
    // 'active' and 'completed' — all in one atomic round-trip.
    const wasCompleted  = data.previousStatus === 'completed';
    const wasInProgress = data.previousStatus === 'in_progress';
    const wasBlocked    = data.previousStatus === 'blocked';

    const isNowCompleted  = data.status === 'completed';
    const isNowInProgress = data.status === 'in_progress';
    const isNowBlocked    = data.status === 'blocked';

    // Only run the transaction when at least one counter will change.
    const countersChanged =
      wasCompleted  !== isNowCompleted  ||
      wasInProgress !== isNowInProgress ||
      wasBlocked    !== isNowBlocked;

    if (countersChanged) {
      try {
        await runTransaction(db, async (tx) => {
          const siteRef  = doc(db, 'sites', data.siteId);
          const siteSnap = await tx.get(siteRef);
          if (!siteSnap.exists()) return;

          const d = siteSnap.data();
          const taskCount = (d['taskCount'] as number) ?? 0;

          // Apply deltas — clamp to 0 to guard against stale previousStatus.
          let completedCount  = (d['completedTaskCount']  as number) ?? 0;
          let inProgressCount = (d['inProgressTaskCount'] as number) ?? 0;
          let blockedCount    = (d['blockedTaskCount']    as number) ?? 0;

          if (isNowCompleted && !wasCompleted)
            completedCount  = Math.max(0, completedCount  + 1);
          else if (wasCompleted && !isNowCompleted)
            completedCount  = Math.max(0, completedCount  - 1);

          if (isNowInProgress && !wasInProgress)
            inProgressCount = Math.max(0, inProgressCount + 1);
          else if (wasInProgress && !isNowInProgress)
            inProgressCount = Math.max(0, inProgressCount - 1);

          if (isNowBlocked && !wasBlocked)
            blockedCount    = Math.max(0, blockedCount    + 1);
          else if (wasBlocked && !isNowBlocked)
            blockedCount    = Math.max(0, blockedCount    - 1);

          // Derive site.status — never override a manual 'on_hold'.
          const currentStatus = (d['status'] as string) ?? 'active';
          let newStatus = currentStatus;
          if (currentStatus !== 'on_hold') {
            newStatus =
              taskCount > 0 && completedCount >= taskCount
                ? 'completed'
                : 'active';
          }

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const txUpdates: Record<string, any> = {
            completedTaskCount:  completedCount,
            inProgressTaskCount: inProgressCount,
            blockedTaskCount:    blockedCount,
          };
          if (newStatus !== currentStatus) {
            txUpdates['status'] = newStatus;
          }

          tx.update(siteRef, txUpdates);
        });
      } catch (siteErr) {
        console.error('[submitSiteTaskUpdate] site counter update failed:', siteErr);
      }
    }

    // ── Audit log (non-critical) ──────────────────────────────────────────────
    try {
      await addDoc(collection(db, 'auditLog'), {
        timestamp:  serverTimestamp(),
        uid:        currentUser.uid,
        userName:   currentUser.name,
        action:     'UPDATE_SITE_TASK',
        detail:     `Updated ${data.taskCode} — status: ${data.status}`,
        siteTaskId: taskId,
        siteId:     data.siteId,
      });
    } catch (auditErr) {
      console.warn('[submitSiteTaskUpdate] auditLog write failed:', auditErr);
    }
  }

  return { submitSiteTaskUpdate };
}
