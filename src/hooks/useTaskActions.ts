import {
  collection,
  doc,
  addDoc,
  updateDoc,
  runTransaction,
  serverTimestamp,
  increment,
  Timestamp,
} from 'firebase/firestore';
import { db } from '@/firebase/config';
import { useAuthStore } from '@/store/authStore';
import { updateProjectStatus } from '@/hooks/useProjectActions';
import type { TaskStatus, CollectionType } from '@/types';

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface CreateTaskInput {
  title:           string;
  description?:    string;
  type:            string;
  assignedTo:      string;
  assignedToName:  string;
  siteCode?:       string;
  startDate:       Date;
  dueDate:         Date;
  /** Set when the task is being created already linked to a project. */
  projectId?:      string;
  projectTitle?:   string;
  projectNum?:     string;
}

export interface SubmitUpdateInput {
  status:            TaskStatus;
  blockedReason?:    string | null;
  subtaskAnswers:    Record<string, { value: string; type: CollectionType }>;
  subtaskPhotos:     Record<string, string[]>;
  completionPhotos:  string[];
  location:          { lat: number; lng: number } | null;
  /** Passed in by the caller so updateProjectStatus needs no extra getDoc. */
  projectId?:        string;
  /** Denormalised onto the update document so the Reports table can display
   *  task metadata without joining back to the parent task document. */
  title?:            string;
  type?:             string;
  siteCode?:         string;
}

// ─── Standalone helpers ────────────────────────────────────────────────────────

/**
 * Archive or restore a task.
 * Exported as a plain async function (no React state) so it can be called
 * from any component without hook rules applying.
 */
export async function archiveTask(
  taskId:  string,
  archive: boolean
): Promise<void> {
  await updateDoc(doc(db, 'tasks', taskId), {
    archived:   archive,
    archivedAt: archive ? serverTimestamp() : null,
    updatedAt:  serverTimestamp(),
  });
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useTaskActions() {
  const { currentUser } = useAuthStore();

  /**
   * Create a new task.
   * The counter increment AND the task document creation happen inside a
   * single runTransaction call — they are fully atomic.
   * If projectId is supplied in data, the task document includes the project
   * link fields, and updateProjectStatus is called afterwards so the project's
   * taskCount and status reflect the new task immediately.
   */
  async function createTask(
    data: CreateTaskInput
  ): Promise<{ id: string; taskNum: string }> {
    if (!currentUser) throw new Error('Not authenticated');

    const configRef = doc(db, 'appConfig', 'global');

    const result = await runTransaction(db, async (transaction) => {
      const configSnap = await transaction.get(configRef);

      if (!configSnap.exists()) {
        throw new Error('appConfig/global not found — run seed:config first');
      }

      const current  = (configSnap.data()?.['taskNumCounter'] as number) ?? 0;
      const prefix   = (configSnap.data()?.['taskNumPrefix']  as string) ?? 'RS';
      const next     = current + 1;
      const taskNum  = `${prefix}:${String(next).padStart(3, '0')}`;

      // Increment the counter
      transaction.update(configRef, { taskNumCounter: next });

      // Build the task document — include project fields ONLY when a project
      // is explicitly selected so standalone tasks stay clean.
      const taskDoc: Record<string, unknown> = {
        taskNum,
        title:            data.title,
        description:      data.description   ?? '',
        type:             data.type,
        siteCode:         data.siteCode      ?? '',
        assignedTo:       data.assignedTo,
        assignedToName:   data.assignedToName,
        createdBy:        currentUser.uid,
        status:           'pending' as TaskStatus,
        startDate:        Timestamp.fromDate(data.startDate),
        dueDate:          Timestamp.fromDate(data.dueDate),
        blockedReason:    null,
        location:         null,
        subtaskAnswers:   {},
        subtaskPhotos:    {},
        completionPhotos: [],
        createdAt:        serverTimestamp(),
        updatedAt:        serverTimestamp(),
      };

      if (data.projectId) {
        taskDoc['projectId']    = data.projectId;
        taskDoc['projectTitle'] = data.projectTitle ?? '';
        taskDoc['projectNum']   = data.projectNum   ?? '';
      }

      // Create the task document inside the SAME transaction
      const newTaskRef = doc(collection(db, 'tasks'));
      transaction.set(newTaskRef, taskDoc);

      return { id: newTaskRef.id, taskNum };
    });

    // Audit log — non-critical, outside the transaction
    try {
      await addDoc(collection(db, 'auditLog'), {
        timestamp: serverTimestamp(),
        uid:       currentUser.uid,
        userName:  currentUser.name,
        action:    'CREATE_TASK',
        detail:    `Created task ${result.taskNum}: ${data.title}`,
        taskId:    result.id,
      });
    } catch (auditErr) {
      console.warn('[createTask] auditLog write failed:', auditErr);
    }

    // If the new task belongs to a project, sync the project's taskCount + status.
    if (data.projectId) {
      try {
        // Optimistically increment taskCount, then reconcile with ground truth.
        await updateDoc(doc(db, 'projects', data.projectId), {
          taskCount: increment(1),
          updatedAt: serverTimestamp(),
        });
        await updateProjectStatus(data.projectId);
      } catch (syncErr) {
        console.error('[createTask] project sync failed:', syncErr);
      }
    }

    return result;
  }

  // ── submitTaskUpdate ─────────────────────────────────────────────────────────

  async function submitTaskUpdate(
    taskId:  string,
    taskNum: string,
    data:    SubmitUpdateInput
  ): Promise<void> {
    if (!currentUser) throw new Error('Not authenticated');

    const taskRef = doc(db, 'tasks', taskId);

    // Update task document — updateDoc (not runTransaction) so Firestore
    // persistence applies it optimistically to the local cache, causing the
    // onSnapshot listener to fire immediately in the UI.
    await updateDoc(taskRef, {
      status:           data.status,
      blockedReason:    data.blockedReason    ?? null,
      subtaskAnswers:   data.subtaskAnswers,
      subtaskPhotos:    data.subtaskPhotos,
      completionPhotos: data.completionPhotos,
      location:         data.location,
      submittedBy:      currentUser.uid,
      submittedByName:  currentUser.name,
      submittedAt:      serverTimestamp(),
      updatedAt:        serverTimestamp(),
    });

    // Immutable update snapshot — task metadata is denormalised here so the
    // Reports page collectionGroup query never needs a join back to the task.
    await addDoc(collection(db, 'tasks', taskId, 'updates'), {
      submittedBy:      currentUser.uid,
      submittedByName:  currentUser.name,
      submittedAt:      serverTimestamp(),
      status:           data.status,
      location:         data.location,
      blockedReason:    data.blockedReason    ?? null,
      subtaskAnswers:   data.subtaskAnswers,
      subtaskPhotos:    data.subtaskPhotos    ?? {},
      completionPhotos: data.completionPhotos ?? [],
      // Denormalised task metadata
      taskNum:          taskNum,
      taskTitle:        data.title            ?? '',
      taskType:         data.type             ?? '',
      siteCode:         data.siteCode         ?? '',
    });

    await addDoc(collection(db, 'auditLog'), {
      timestamp: serverTimestamp(),
      uid:       currentUser.uid,
      userName:  currentUser.name,
      action:    'UPDATE_TASK',
      detail:    `Updated task ${taskNum} — status: ${data.status}`,
      taskId,
    });

    // Re-derive project status if this task belongs to a project.
    // projectId is passed directly from the caller (via SubmitUpdateInput) —
    // no extra getDoc needed.
    if (data.projectId) {
      try {
        await updateProjectStatus(data.projectId);
      } catch (syncErr) {
        // Non-critical: task update already succeeded; log but do not rethrow
        // so the field engineer's submission is not rolled back by a sync error.
        console.error('[submitTaskUpdate] updateProjectStatus failed:', syncErr);
      }
    }
  }

  return { createTask, submitTaskUpdate };
}
