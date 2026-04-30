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

    // ── Update task-status counters on the parent site ────────────────────────
    // Build a single updateDoc call for all three counters so the site document
    // is updated atomically in one round-trip.
    const wasCompleted  = data.previousStatus === 'completed';
    const wasInProgress = data.previousStatus === 'in_progress';
    const wasBlocked    = data.previousStatus === 'blocked';

    const isNowCompleted  = data.status === 'completed';
    const isNowInProgress = data.status === 'in_progress';
    const isNowBlocked    = data.status === 'blocked';

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const siteUpdates: Record<string, any> = {};

    // completedTaskCount
    if (isNowCompleted && !wasCompleted) {
      siteUpdates['completedTaskCount'] = increment(1);
    } else if (wasCompleted && !isNowCompleted) {
      siteUpdates['completedTaskCount'] = increment(-1);
    }

    // inProgressTaskCount
    if (isNowInProgress && !wasInProgress) {
      siteUpdates['inProgressTaskCount'] = increment(1);
    } else if (wasInProgress && !isNowInProgress) {
      siteUpdates['inProgressTaskCount'] = increment(-1);
    }

    // blockedTaskCount
    if (isNowBlocked && !wasBlocked) {
      siteUpdates['blockedTaskCount'] = increment(1);
    } else if (wasBlocked && !isNowBlocked) {
      siteUpdates['blockedTaskCount'] = increment(-1);
    }

    if (Object.keys(siteUpdates).length > 0) {
      try {
        await updateDoc(doc(db, 'sites', data.siteId), siteUpdates);
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
