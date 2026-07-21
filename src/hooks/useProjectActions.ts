import {
  collection,
  doc,
  getDoc,
  addDoc,
  updateDoc,
  getDocs,
  query,
  where,
  runTransaction,
  serverTimestamp,
  increment,
  Timestamp,
} from 'firebase/firestore';
import { db } from '@/firebase/config';
import { useAuthStore } from '@/store/authStore';
import type { ProjectStatus, TaskTemplate } from '@/types';

// ─── Standalone helpers ────────────────────────────────────────────────────────
// Exported as plain async functions (no React state) so they can be called
// from useTaskActions without violating hook rules.

/**
 * Re-derives the project status from its linked tasks and writes it back.
 * Also syncs completedTaskCount and taskCount.
 * Called after every task status update and after a task is linked to a project.
 */
export async function updateProjectStatus(projectId: string): Promise<void> {
  if (!projectId || projectId === 'null' || projectId === 'undefined') {
    console.warn('[updateProjectStatus] invalid projectId:', projectId);
    return;
  }

  try {
    const projectRef  = doc(db, 'projects', projectId);
    const projectSnap = await getDoc(projectRef);
    if (!projectSnap.exists()) {
      console.warn('[updateProjectStatus] project not found:', projectId);
      return;
    }

    const tasksQuery = query(
      collection(db, 'tasks'),
      where('projectId', '==', projectId)
    );
    const tasksSnap = await getDocs(tasksQuery);

    if (tasksSnap.empty) {
      await updateDoc(projectRef, {
        status:             'pending' as ProjectStatus,
        completedTaskCount: 0,
        taskCount:          0,
        updatedAt:          serverTimestamp(),
      });
      return;
    }

    const statuses = tasksSnap.docs.map((d) => d.data()['status'] as string);

    let newStatus: ProjectStatus;
    if (statuses.every((s) => s === 'completed')) {
      newStatus = 'completed';
    } else if (statuses.some((s) => s === 'blocked')) {
      newStatus = 'blocked';
    } else if (statuses.some((s) => s === 'in_progress' || s === 'completed')) {
      newStatus = 'in_progress';
    } else {
      newStatus = 'pending';
    }

    const completedCount = statuses.filter((s) => s === 'completed').length;

    await updateDoc(projectRef, {
      status:             newStatus,
      completedTaskCount: completedCount,
      taskCount:          tasksSnap.size,
      updatedAt:          serverTimestamp(),
    });

  } catch (err) {
    console.error('[updateProjectStatus] FAILED:', err);
    throw err;
  }
}

// ─── Archive helper ───────────────────────────────────────────────────────────

/**
 * Archive or restore a project.
 * Exported as a plain async function (no React state) so it can be called
 * from any component without hook rules applying.
 */
export async function archiveProject(
  projectId: string,
  archive:   boolean
): Promise<void> {
  await updateDoc(doc(db, 'projects', projectId), {
    archived:   archive,
    archivedAt: archive ? serverTimestamp() : null,
    updatedAt:  serverTimestamp(),
  });
}

// ─── Input types ──────────────────────────────────────────────────────────────

export interface CreateProjectInput {
  title:            string;
  description?:     string;
  // v2.1 fields — optional so v3.0 callers don't have to provide them
  siteCode?:        string;
  startDate?:       Date;
  dueDate?:         Date;
  assignedTo?:      string[];
  assignedToNames?: string[];
  // v3.0 additions
  projectCode?:     string;
  taskTemplates?:   TaskTemplate[];
  defaultApproverUid?:  string | null;
  defaultApproverName?: string | null;
}

export interface UpdateProjectInput {
  title:          string;
  projectCode:    string;
  description?:   string;
  active?:        boolean;
  taskTemplates:  TaskTemplate[];
  defaultApproverUid?:  string | null;
  defaultApproverName?: string | null;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useProjectActions() {
  const { currentUser } = useAuthStore();

  /**
   * Create a new project.
   * The counter increment AND the project document creation happen inside a
   * single runTransaction call — they are fully atomic, eliminating the
   * duplicate-projectNum race condition that existed when addDoc was called
   * outside the transaction.
   */
  async function createProject(
    data: CreateProjectInput
  ): Promise<{ id: string; projectNum: string }> {
    if (!currentUser) throw new Error('Not authenticated');

    const configRef = doc(db, 'appConfig', 'global');

    const result = await runTransaction(db, async (transaction) => {
      const configSnap = await transaction.get(configRef);

      if (!configSnap.exists()) {
        throw new Error('appConfig/global not found — run seed:config first');
      }

      const current    = (configSnap.data()?.['projectNumCounter'] as number) ?? 0;
      const prefix     = (configSnap.data()?.['projectNumPrefix']  as string) ?? 'RP';
      const next       = current + 1;
      const projectNum = `${prefix}:${String(next).padStart(3, '0')}`;

      // Increment the counter
      transaction.update(configRef, { projectNumCounter: next });

      // Create the project document inside the SAME transaction
      const now = new Date();
      const newProjectRef = doc(collection(db, 'projects'));
      transaction.set(newProjectRef, {
        projectNum,
        title:              data.title,
        description:        data.description        ?? '',
        siteCode:           data.siteCode           ?? '',
        // v3.0 fields
        projectCode:        (data.projectCode ?? '').toUpperCase(),
        taskTemplates:      data.taskTemplates      ?? [],
        defaultApproverUid:  data.defaultApproverUid  ?? null,
        defaultApproverName: data.defaultApproverName ?? null,
        active:             true,
        // v2.1 fields kept for backward compat — default to now if not provided
        status:             'pending',
        assignedTo:         data.assignedTo         ?? [],
        assignedToNames:    data.assignedToNames     ?? [],
        createdBy:          currentUser.uid,
        startDate:          data.startDate ? Timestamp.fromDate(data.startDate) : Timestamp.fromDate(now),
        dueDate:            data.dueDate   ? Timestamp.fromDate(data.dueDate)   : Timestamp.fromDate(now),
        taskCount:          0,
        completedTaskCount: 0,
        createdAt:          serverTimestamp(),
        updatedAt:          serverTimestamp(),
      });

      return { id: newProjectRef.id, projectNum };
    });

    // Audit log — non-critical, written outside the transaction so a failure
    // here does not roll back the project creation.
    try {
      await addDoc(collection(db, 'auditLog'), {
        timestamp: serverTimestamp(),
        uid:       currentUser.uid,
        userName:  currentUser.name,
        action:    'CREATE_PROJECT',
        detail:    `Created project ${result.projectNum}: ${data.title}`,
        projectId: result.id,
      });
    } catch (auditErr) {
      console.warn('[createProject] auditLog write failed:', auditErr);
    }

    return result;
  }

  /**
   * Links an EXISTING task to a project (used when retroactively linking tasks).
   * For tasks linked at creation time, pass projectId inside CreateTaskInput instead.
   * Also calls updateProjectStatus so taskCount + status are immediately correct.
   */
  async function addTaskToProject(
    taskId:       string,
    projectId:    string,
    projectTitle: string,
    projectNum:   string
  ): Promise<void> {
    await updateDoc(doc(db, 'tasks', taskId), {
      projectId,
      projectTitle,
      projectNum,
      updatedAt: serverTimestamp(),
    });

    // increment is a quick optimistic write; updateProjectStatus below will
    // overwrite taskCount with the ground-truth value from Firestore.
    await updateDoc(doc(db, 'projects', projectId), {
      taskCount: increment(1),
      updatedAt: serverTimestamp(),
    });

    // Re-derive status and sync counts from the real task data
    await updateProjectStatus(projectId);
  }

  /**
   * Overwrite the mutable project fields (name, code, description, templates,
   * active) in a single atomic write.  Task counts, status, and projectNum are
   * NOT touched so the v2.1 progress/status logic continues to work.
   */
  async function updateProject(
    projectId: string,
    data:      UpdateProjectInput,
  ): Promise<void> {
    if (!currentUser) throw new Error('Not authenticated');

    await updateDoc(doc(db, 'projects', projectId), {
      title:         data.title,
      projectCode:   data.projectCode.toUpperCase(),
      description:   data.description ?? '',
      active:        data.active ?? true,
      taskTemplates: data.taskTemplates,
      defaultApproverUid:  data.defaultApproverUid  ?? null,
      defaultApproverName: data.defaultApproverName ?? null,
      updatedAt:     serverTimestamp(),
    });

    // Audit log — non-critical
    try {
      await addDoc(collection(db, 'auditLog'), {
        timestamp: serverTimestamp(),
        uid:       currentUser.uid,
        userName:  currentUser.name,
        action:    'UPDATE_PROJECT',
        detail:    `Updated project ${projectId}: ${data.title}`,
        projectId,
      });
    } catch (auditErr) {
      console.warn('[updateProject] auditLog write failed:', auditErr);
    }
  }

  return { createProject, addTaskToProject, updateProjectStatus, updateProject };
}
