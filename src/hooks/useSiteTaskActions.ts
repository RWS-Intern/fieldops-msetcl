import {
  doc,
  collection,
  getDoc,
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

export interface ReviewSiteTaskInput {
  decision:       'approve' | 'request_changes';
  /** Required when decision === 'request_changes'. */
  reviewNotes?:   string;
  /** Needed to update the counters on the parent site document. */
  siteId:         string;
  siteCode:       string;
  taskCode:       string;
  taskLabel:      string;
  /** Task status BEFORE this review — expected to be 'pending_approval'. */
  previousStatus: TaskStatus;
  /**
   * The task's current approverUid — passed in so the guard can be checked
   * without an extra read. `null` means the task has no approver assigned
   * yet, in which case any admin may act as a fallback reviewer.
   */
  approverUid:    string | null;
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
    const wasCompleted        = data.previousStatus === 'completed';
    const wasInProgress       = data.previousStatus === 'in_progress';
    const wasBlocked          = data.previousStatus === 'blocked';
    const wasPendingApproval  = data.previousStatus === 'pending_approval';

    const isNowCompleted       = data.status === 'completed';
    const isNowInProgress      = data.status === 'in_progress';
    const isNowBlocked         = data.status === 'blocked';
    const isNowPendingApproval = data.status === 'pending_approval';

    // Only run the transaction when at least one counter will change.
    const countersChanged =
      wasCompleted       !== isNowCompleted       ||
      wasInProgress      !== isNowInProgress      ||
      wasBlocked         !== isNowBlocked         ||
      wasPendingApproval !== isNowPendingApproval;

    if (countersChanged) {
      try {
        await runTransaction(db, async (tx) => {
          const siteRef  = doc(db, 'sites', data.siteId);
          const siteSnap = await tx.get(siteRef);
          if (!siteSnap.exists()) return;

          const d = siteSnap.data();
          const taskCount = (d['taskCount'] as number) ?? 0;

          // Apply deltas — clamp to 0 to guard against stale previousStatus.
          let completedCount       = (d['completedTaskCount']       as number) ?? 0;
          let inProgressCount      = (d['inProgressTaskCount']      as number) ?? 0;
          let blockedCount         = (d['blockedTaskCount']         as number) ?? 0;
          let pendingApprovalCount = (d['pendingApprovalTaskCount'] as number) ?? 0;

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

          if (isNowPendingApproval && !wasPendingApproval)
            pendingApprovalCount = Math.max(0, pendingApprovalCount + 1);
          else if (wasPendingApproval && !isNowPendingApproval)
            pendingApprovalCount = Math.max(0, pendingApprovalCount - 1);

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
            completedTaskCount:       completedCount,
            inProgressTaskCount:      inProgressCount,
            blockedTaskCount:         blockedCount,
            pendingApprovalTaskCount: pendingApprovalCount,
          };
          if (newStatus !== currentStatus) {
            txUpdates['status'] = newStatus;
          }

          // Pin the site on the map if this submission has GPS and the site
          // has no location yet (common for bulk-uploaded sites).
          if (data.location) {
            const existingLoc = d['location'] as { lat?: number; lng?: number } | null;
            const siteHasLocation = existingLoc?.lat != null && existingLoc?.lng != null;
            if (!siteHasLocation) {
              txUpdates['location'] = {
                lat: data.location.lat,
                lng: data.location.lng,
              };
            }
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

  /**
   * Approver review of a pending_approval SiteTask — approve or send back
   * with review notes. Guarded to the assigned approver, with an admin
   * fallback when the task has no approverUid (legacy / unassigned tasks).
   * Does NOT touch subtaskAnswers, subtaskPhotos, or completionPhotos.
   */
  async function reviewSiteTask(
    taskId: string,
    data:   ReviewSiteTaskInput,
  ): Promise<void> {
    if (!currentUser) throw new Error('Not authenticated');

    const isAssignedApprover = currentUser.uid === data.approverUid;
    const isAdminFallback    = currentUser.role === 'admin' && data.approverUid == null;
    if (!isAssignedApprover && !isAdminFallback) {
      throw new Error('You are not authorized to review this task.');
    }

    const trimmedNotes = data.reviewNotes?.trim() ?? '';
    if (data.decision === 'request_changes' && !trimmedNotes) {
      throw new Error('Review notes are required when requesting changes.');
    }

    const newStatus: TaskStatus = data.decision === 'approve' ? 'completed' : 'changes_requested';
    const reviewNotes = data.decision === 'request_changes' ? trimmedNotes : null;

    const taskRef = doc(db, 'siteTasks', taskId);

    // ── Update siteTask document — status + review metadata only ─────────────
    await updateDoc(taskRef, {
      status:         newStatus,
      reviewNotes,
      reviewedBy:     currentUser.uid,
      reviewedByName: currentUser.name,
      reviewedAt:     serverTimestamp(),
      updatedAt:      serverTimestamp(),
    });

    // ── Immutable update snapshot ─────────────────────────────────────────────
    await addDoc(collection(db, 'siteTasks', taskId, 'updates'), {
      submittedBy:     currentUser.uid,
      submittedByName: currentUser.name,
      submittedAt:     serverTimestamp(),
      status:          newStatus,
      blockedReason:   null,
      action:          data.decision,
      reviewNotes,
      reviewedBy:      currentUser.uid,
      reviewedByName:  currentUser.name,
      // Denormalised task metadata for history display
      taskCode:        data.taskCode,
      taskLabel:       data.taskLabel,
      siteCode:        data.siteCode,
    });

    // ── Update task-status counters + derive site.status (approve only) ──────
    const wasPendingApproval = data.previousStatus === 'pending_approval';
    if (wasPendingApproval) {
      try {
        await runTransaction(db, async (tx) => {
          const siteRef  = doc(db, 'sites', data.siteId);
          const siteSnap = await tx.get(siteRef);
          if (!siteSnap.exists()) return;

          const d = siteSnap.data();
          const taskCount = (d['taskCount'] as number) ?? 0;

          let completedCount       = (d['completedTaskCount']       as number) ?? 0;
          let pendingApprovalCount = (d['pendingApprovalTaskCount'] as number) ?? 0;

          pendingApprovalCount = Math.max(0, pendingApprovalCount - 1);

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const txUpdates: Record<string, any> = {
            pendingApprovalTaskCount: pendingApprovalCount,
          };

          if (data.decision === 'approve') {
            completedCount = Math.max(0, completedCount + 1);
            txUpdates['completedTaskCount'] = completedCount;

            // Derive site.status — never override a manual 'on_hold'.
            const currentStatus = (d['status'] as string) ?? 'active';
            if (currentStatus !== 'on_hold') {
              const newSiteStatus =
                taskCount > 0 && completedCount >= taskCount ? 'completed' : 'active';
              if (newSiteStatus !== currentStatus) {
                txUpdates['status'] = newSiteStatus;
              }
            }
          }

          tx.update(siteRef, txUpdates);
        });
      } catch (siteErr) {
        console.error('[reviewSiteTask] site counter update failed:', siteErr);
      }
    }

    // ── Audit log (non-critical) ──────────────────────────────────────────────
    try {
      await addDoc(collection(db, 'auditLog'), {
        timestamp:  serverTimestamp(),
        uid:        currentUser.uid,
        userName:   currentUser.name,
        action:     'REVIEW_SITE_TASK',
        detail:     `${data.decision === 'approve' ? 'Approved' : 'Requested changes on'} ${data.taskCode}`,
        siteTaskId: taskId,
        siteId:     data.siteId,
      });
    } catch (auditErr) {
      console.warn('[reviewSiteTask] auditLog write failed:', auditErr);
    }
  }

  return { submitSiteTaskUpdate, reviewSiteTask };
}

// ─── Standalone exports ───────────────────────────────────────────────────────

/**
 * Pull the latest subtask snapshot from the project task template and write it
 * back to an existing siteTask document.
 *
 * Allows an admin to propagate showWhen conditions (or any other template
 * changes) into a site task that was created before the conditions existed.
 * Safe to call at any time — only the `subtasks` array is overwritten.
 */
export async function refreshSiteTaskSubtasks(
  siteTaskId: string,
  projectId:  string,
  taskKey:    string,
): Promise<void> {
  const projectSnap = await getDoc(doc(db, 'projects', projectId));
  if (!projectSnap.exists()) {
    throw new Error('Project not found');
  }

  const project  = projectSnap.data();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const template = (project['taskTemplates'] as any[] | undefined)?.find(
    (t) => t.taskKey === taskKey,
  );

  if (!template) {
    throw new Error(`Task template "${taskKey}" not found in project`);
  }

  await updateDoc(doc(db, 'siteTasks', siteTaskId), {
    subtasks:  template.subtasks ?? [],
    updatedAt: serverTimestamp(),
  });
}
