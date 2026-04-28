import {
  doc,
  collection,
  updateDoc,
  addDoc,
  serverTimestamp,
  increment,
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

    // ── Update completedTaskCount on the parent site ───────────────────────────
    // Only fire when transitioning into or out of 'completed' to avoid drift.
    const wasCompleted = data.previousStatus === 'completed';
    const isCompleted  = data.status          === 'completed';

    if (!wasCompleted && isCompleted) {
      // Transitioning to completed: increment
      try {
        await updateDoc(doc(db, 'sites', data.siteId), {
          completedTaskCount: increment(1),
        });
      } catch (siteErr) {
        console.error('[submitSiteTaskUpdate] completedTaskCount increment failed:', siteErr);
      }
    } else if (wasCompleted && !isCompleted) {
      // Un-completing a task (e.g. marking blocked after previously completed): decrement
      try {
        await updateDoc(doc(db, 'sites', data.siteId), {
          completedTaskCount: increment(-1),
        });
      } catch (siteErr) {
        console.error('[submitSiteTaskUpdate] completedTaskCount decrement failed:', siteErr);
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
