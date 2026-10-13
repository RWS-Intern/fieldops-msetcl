import {
  collection,
  doc,
  getDoc,
  addDoc,
  updateDoc,
  getDocs,
  query,
  where,
  increment,
  runTransaction,
  serverTimestamp,
  GeoPoint,
} from 'firebase/firestore';
import { db } from '@/firebase/config';
import { useAuthStore }    from '@/store/authStore';
import { useProjectStore } from '@/store/projectStore';
import type { SiteVoltageClass, SiteStatus, TaskTemplate } from '@/types';

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

/**
 * Set or clear a site's GPS pin. Admin-only utility for re-pinning sites
 * from the office (e.g. legacy sites bulk-uploaded without coordinates).
 * Touches ONLY location + updatedAt — no other site fields.
 */
export async function updateSiteLocation(
  siteId:   string,
  location: { lat: number; lng: number } | null,
): Promise<void> {
  try {
    await updateDoc(doc(db, 'sites', siteId), {
      location:  location ? new GeoPoint(location.lat, location.lng) : null,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    console.error('[updateSiteLocation] FAILED:', err);
    throw err;
  }
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
  // ── Substation master (tender Annexure-II) — MSETCL project only, optional ──
  sapCode?:               string | null;
  zone?:                  string | null;
  voltageClass?:          SiteVoltageClass | null;
  totalBays?:             number | null;
  numPowerTransformers?:  number | null;
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
      sapCode:              data.sapCode              ?? null,
      zone:                 data.zone                 ?? null,
      voltageClass:         data.voltageClass          ?? null,
      totalBays:            data.totalBays             ?? null,
      numPowerTransformers: data.numPowerTransformers  ?? null,
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

    // ── Site tasks are NOT auto-created ───────────────────────────────────
    // Every project template used to be spawned as a SiteTask the moment a
    // site was created, which gave each site the full template list whether
    // or not that work was actually planned for it. Tasks are now added one
    // at a time from the site drawer's "Add Task" picker (addSiteTask below),
    // so a site only carries work someone chose for it.
    //
    // taskCount therefore starts at 0 and is incremented per addSiteTask.

    return { id: siteId, siteCode };
  }

  /**
   * Adds ONE task to a site, from one of its project's templates.
   *
   * Replaces the old spawn-everything-on-site-creation behaviour: a site now
   * carries only the work someone deliberately picked for it.
   *
   * ONE TASK PER TEMPLATE PER SITE, enforced structurally rather than by
   * checking first: the document id is derived from siteId + taskKey, and the
   * transaction refuses outright if that id already exists. A plain
   * "query, then create" would leave a window in which a double-click, or two
   * admins on the same site, could produce two "Material Delivery" rows —
   * and the second would silently reset the first one's progress.
   *
   * `subtasks` is SNAPSHOT from the template, matching what createSite used
   * to do: a task is immune to later edits of the project template it came
   * from, so work already answered cannot have its questions changed
   * underneath it.
   *
   * Returns false when the task already exists; the caller has already
   * disabled that option, so this is the race guard, not the primary UX.
   *
   * Reports nothing itself — like createSite above, it throws or returns and
   * the calling component owns the toast.
   */
  async function addSiteTask(
    site: {
      id: string; siteCode: string; siteName: string; city: string;
      projectId: string; projectName: string; projectCode: string;
    },
    template: TaskTemplate,
  ): Promise<boolean> {
    if (!currentUser) throw new Error('Not signed in');

    // Project-level approver default, same source createSite used. Read fresh
    // rather than from the store, which may pre-date a recent edit.
    let defaultApproverUid:  string | null = null;
    let defaultApproverName: string | null = null;
    try {
      const projectSnap = await getDoc(doc(db, 'projects', site.projectId));
      const projectData = projectSnap.data();
      defaultApproverUid  = (projectData?.['defaultApproverUid']  as string | undefined) ?? null;
      defaultApproverName = (projectData?.['defaultApproverName'] as string | undefined) ?? null;
    } catch (projErr) {
      console.error('[addSiteTask] project read failed, falling back to store:', projErr);
      const storeProject = projects.find((p) => p.id === site.projectId);
      defaultApproverUid  = storeProject?.defaultApproverUid  ?? null;
      defaultApproverName = storeProject?.defaultApproverName ?? null;
    }

    // '/' is the only character Firestore forbids in a document id, and a
    // taskKey is author-supplied, so it is the one thing worth neutralising.
    const safeKey  = template.taskKey.split('/').join('_');
    const taskRef  = doc(db, 'siteTasks', `${site.id}_${safeKey}`);
    const siteRef  = doc(db, 'sites', site.id);
    // -01 stays accurate precisely because a template can only be added once.
    const taskCode = `${site.siteCode}/${site.projectCode}/${template.taskKey.toUpperCase()}-01`;

    try {
      const created = await runTransaction(db, async (tx) => {
        const existing = await tx.get(taskRef);
        if (existing.exists()) return false;

        tx.set(taskRef, {
          taskCode,
          siteId:      site.id,
          siteCode:    site.siteCode,
          siteName:    site.siteName,
          city:        site.city,
          projectId:   site.projectId,
          projectName: site.projectName,
          projectCode: site.projectCode,
          taskKey:     template.taskKey,
          taskLabel:   template.label,
          taskColour:  template.colour,
          subtasks:    template.subtasks,
          assignedTo:       null,
          assignedToName:   null,
          assignedToCode:   null,
          status:           'pending',
          startDate:        null,
          dueDate:          null,
          subtaskAnswers:   {},
          subtaskPhotos:    {},
          completionPhotos: [],
          blockedReason:    null,
          location:         null,
          submittedBy:      null,
          submittedAt:      null,
          createdAt:        serverTimestamp(),
          updatedAt:        serverTimestamp(),
          archived:         false,
          approverUid:      defaultApproverUid,
          approverName:     defaultApproverName,
          approverCode:     null,
          reviewNotes:      null,
          reviewedBy:       null,
          reviewedByName:   null,
          reviewedAt:       null,
        });

        // Atomic bump — two tasks added at once must not lose a count.
        tx.update(siteRef, { taskCount: increment(1), updatedAt: serverTimestamp() });
        return true;
      });

      if (!created) return false;
    } catch (err) {
      console.error('[addSiteTask] failed:', err);
      throw err;
    }

    // Audit log — non-critical, never blocks the success toast.
    try {
      await addDoc(collection(db, 'auditLog'), {
        timestamp: serverTimestamp(),
        uid:       currentUser.uid,
        userName:  currentUser.name,
        action:    'ADD_SITE_TASK',
        detail:    `Added task "${template.label}" to site ${site.siteCode}`,
        siteId:    site.id,
        projectId: site.projectId,
      });
    } catch (auditErr) {
      console.warn('[addSiteTask] auditLog write failed:', auditErr);
    }

    return true;
  }

  return { createSite, addSiteTask };
}
