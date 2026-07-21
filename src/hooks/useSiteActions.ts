import {
  collection,
  doc,
  getDoc,
  addDoc,
  updateDoc,
  getDocs,
  query,
  where,
  writeBatch,
  serverTimestamp,
  GeoPoint,
} from 'firebase/firestore';
import { db } from '@/firebase/config';
import { useAuthStore }    from '@/store/authStore';
import { useProjectStore } from '@/store/projectStore';
import type { SiteStatus, TaskTemplate } from '@/types';

// ─── Archive helper ────────────────────────────────────────────────────────────

/**
 * Archive or restore a site.
 * Exported as a plain async function so it can be called from any component.
 */
export async function archiveSite(
  siteId:  string,
  archive: boolean
): Promise<void> {
  await updateDoc(doc(db, 'sites', siteId), {
    archived:   archive,
    archivedAt: archive ? serverTimestamp() : null,
  });
}

// ─── Input types ──────────────────────────────────────────────────────────────

export interface CreateSiteInput {
  siteCode:    string;              // user-supplied, e.g. "SUB-PUNE-047"
  siteName:    string;
  city:        string;
  state:       string;
  circle?:     string;
  division?:   string;
  address?:    string;
  projectId:   string;
  projectName: string;
  projectCode: string;
  status?:     SiteStatus;
  location?:   { lat: number; lng: number } | null;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useSiteActions() {
  const { currentUser } = useAuthStore();
  const { projects }    = useProjectStore();

  /**
   * Create a new site.
   * Site codes are entered manually by the admin (not auto-generated from a counter).
   *
   * Note: siteNumCounter in appConfig/global is reserved for future auto-code generation
   * and should be updated manually to reflect the current site count. It is NOT
   * incremented here because addDoc generates Firestore IDs and site codes are
   * admin-supplied. Similarly, siteTaskNumCounter is not incremented here — task
   * codes are derived from taskKey strings, not a sequential counter.
   *
   * Also checks that no active site with the same siteCode already exists (globally).
   */
  async function createSite(
    data: CreateSiteInput
  ): Promise<{ id: string; siteCode: string }> {
    if (!currentUser) throw new Error('Not authenticated');

    const siteCode = data.siteCode.trim().toUpperCase();
    if (!siteCode) throw new Error('Site code is required');

    // ── Uniqueness check — siteCode must be globally unique across all sites ─
    const dupeSnap = await getDocs(
      query(
        collection(db, 'sites'),
        where('siteCode', '==', siteCode),
        where('archived', '==', false),
      )
    );
    if (!dupeSnap.empty) {
      throw new Error(`Site code "${siteCode}" is already in use.`);
    }

    // ── Create the site document ────────────────────────────────────────────
    const siteName = data.siteName.trim();
    const city     = data.city.trim();

    const newSiteRef = await addDoc(collection(db, 'sites'), {
      siteCode,
      siteName,
      city,
      state:              data.state.trim(),
      circle:             (data.circle   ?? '').trim(),
      division:           (data.division ?? '').trim(),
      address:            (data.address  ?? '').trim(),
      projectId:          data.projectId,
      projectName:        data.projectName,
      projectCode:        data.projectCode,
      location:           data.location
        ? new GeoPoint(data.location.lat, data.location.lng)
        : null,
      status:               data.status ?? 'active',
      taskCount:            0,
      completedTaskCount:   0,
      inProgressTaskCount:  0,
      blockedTaskCount:     0,
      pendingApprovalTaskCount: 0,
      createdBy:            currentUser.uid,
      createdAt:            serverTimestamp(),
      archived:             false,
      archivedAt:           null,
    });

    const siteId = newSiteRef.id;

    // ── Audit log for site creation — non-critical ───────────────────────────
    try {
      await addDoc(collection(db, 'auditLog'), {
        timestamp:   serverTimestamp(),
        uid:         currentUser.uid,
        userName:    currentUser.name,
        action:      'CREATE_SITE',
        detail:      `Created site ${siteCode}: ${siteName}`,
        siteId,
        projectId:   data.projectId,
      });
    } catch (auditErr) {
      console.warn('[createSite] auditLog write failed:', auditErr);
    }

    // ── Auto-create site tasks from project templates ─────────────────────
    // Always read fresh from Firestore — avoids the React closure staleness
    // trap where `projects` captured by this function might pre-date the
    // store update, or the project might pre-date Phase B (no taskTemplates
    // written to Firestore yet).  Falls back to the store on read failure.
    let templates: TaskTemplate[] = [];
    let defaultApproverUid: string | null = null;
    let defaultApproverName: string | null = null;
    try {
      const projectSnap = await getDoc(doc(db, 'projects', data.projectId));
      const projectData = projectSnap.data();
      templates = (projectData?.['taskTemplates'] as TaskTemplate[] | undefined) ?? [];
      defaultApproverUid  = (projectData?.['defaultApproverUid']  as string | undefined) ?? null;
      defaultApproverName = (projectData?.['defaultApproverName'] as string | undefined) ?? null;
    } catch (projErr) {
      console.error('[createSite] getDoc project failed, falling back to store:', projErr);
      const storeProject = projects.find((p) => p.id === data.projectId);
      templates = storeProject?.taskTemplates ?? [];
      defaultApproverUid  = storeProject?.defaultApproverUid  ?? null;
      defaultApproverName = storeProject?.defaultApproverName ?? null;
    }

    if (templates.length === 0) {
      console.warn(
        '[createSite] No task templates on project', data.projectId,
        '— site tasks not created. Add templates via Edit Project.'
      );
    } else {
      try {
        const batch = writeBatch(db);

        for (const template of templates) {
          const taskCode = `${siteCode}/${data.projectCode}/${template.taskKey.toUpperCase()}-01`;
          const taskRef  = doc(collection(db, 'siteTasks'));
          batch.set(taskRef, {
            taskCode,
            siteId,
            siteCode,
            siteName,
            city,
            projectId:          data.projectId,
            projectName:        data.projectName,
            projectCode:        data.projectCode,
            taskKey:            template.taskKey,
            taskLabel:          template.label,
            taskColour:         template.colour,
            subtasks:           template.subtasks,  // snapshot — immune to future edits
            assignedTo:         null,
            assignedToName:     null,
            assignedToCode:     null,
            status:             'pending',
            startDate:          null,
            dueDate:            null,
            subtaskAnswers:     {},
            subtaskPhotos:      {},
            completionPhotos:   [],
            blockedReason:      null,
            location:           null,
            submittedBy:        null,
            submittedAt:        null,
            createdAt:          serverTimestamp(),
            updatedAt:          serverTimestamp(),
            archived:           false,
            approverUid:        defaultApproverUid,
            approverName:       defaultApproverName,
            approverCode:       null,
            reviewNotes:        null,
            reviewedBy:         null,
            reviewedByName:     null,
            reviewedAt:         null,
          });
        }

        await batch.commit();

        // Update site's taskCount now that tasks exist
        await updateDoc(doc(db, 'sites', siteId), {
          taskCount:                templates.length,
          completedTaskCount:       0,
          inProgressTaskCount:      0,
          blockedTaskCount:         0,
          pendingApprovalTaskCount: 0,
        });

        // Audit log for auto-create — non-critical
        try {
          await addDoc(collection(db, 'auditLog'), {
            timestamp:   serverTimestamp(),
            uid:         currentUser.uid,
            userName:    currentUser.name,
            action:      'AUTO_CREATE_SITE_TASKS',
            detail:      `${templates.length} tasks auto-created for site ${siteCode}`,
            siteId,
          });
        } catch (auditErr) {
          console.warn('[createSite] auto-tasks auditLog write failed:', auditErr);
        }
      } catch (batchErr) {
        console.error('[createSite] batch write FAILED:', batchErr);
        throw batchErr;
      }
    }

    return { id: siteId, siteCode };
  }

  return { createSite };
}
