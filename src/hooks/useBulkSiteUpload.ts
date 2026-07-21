import Papa from 'papaparse';
import {
  collection,
  doc,
  setDoc,
  getDocs,
  query,
  where,
  writeBatch,
  serverTimestamp,
  GeoPoint,
} from 'firebase/firestore';
import { db }               from '@/firebase/config';
import { useAuthStore }     from '@/store/authStore';
import { useProjectStore }  from '@/store/projectStore';
import type {
  BulkUploadRow,
  BulkRowResult,
  BulkUploadSummary,
} from '@/types';

// ─── Constants ─────────────────────────────────────────────────────────────────

const REQUIRED_HEADERS = ['projectCode', 'siteCode', 'siteName', 'city', 'state'];

/** Maximum rows per upload to stay within Firestore batch limits and page performance. */
const MAX_ROWS = 1000;

/**
 * Sites per batch.
 * Each site = 1 site doc + N siteTask docs.
 * With up to ~10 task templates, that's up to 11 ops per site.
 * 40 sites × 11 ops = 440 — safely under the 500-op batch limit.
 */
const SITES_PER_BATCH = 40;

// ─── Hook ──────────────────────────────────────────────────────────────────────

export function useBulkSiteUpload() {
  const { currentUser } = useAuthStore();
  const { projects }    = useProjectStore();

  // ── Parse ────────────────────────────────────────────────────────────────────

  function parseFile(file: File): Promise<BulkUploadRow[]> {
    return new Promise((resolve, reject) => {
      if (file.size > 5 * 1024 * 1024) {
        reject(new Error('File is too large. Maximum size is 5 MB.'));
        return;
      }

      Papa.parse(file, {
        header:          true,
        skipEmptyLines:  true,
        transformHeader: (h: string) => h.trim(),
        complete: (result) => {
          const headers = Object.keys((result.data as Record<string, unknown>[])[0] ?? {});

          const missingRequired = REQUIRED_HEADERS.filter((h) => !headers.includes(h));
          if (missingRequired.length > 0) {
            reject(
              new Error(
                `Missing required columns: ${missingRequired.join(', ')}. ` +
                `Download the template for the correct format.`
              )
            );
            return;
          }

          const rows: BulkUploadRow[] = (result.data as Record<string, string>[]).map(
            (row, idx) => ({
              rowNumber:   idx + 2,   // +2 = 1-indexed + skip header row
              projectCode: row['projectCode'] ?? '',
              siteCode:    row['siteCode']    ?? '',
              siteName:    row['siteName']    ?? '',
              city:        row['city']        ?? '',
              state:       row['state']       ?? '',
              circle:      row['circle']      ?? '',
              division:    row['division']    ?? '',
              address:     row['address']     ?? '',
              latitude:    row['latitude']    ?? '',
              longitude:   row['longitude']   ?? '',
            })
          );

          resolve(rows);
        },
        error: (err: Error) => {
          reject(new Error(`Failed to parse file: ${err.message}`));
        },
      });
    });
  }

  // ── Validate ─────────────────────────────────────────────────────────────────

  async function validateRows(rows: BulkUploadRow[]): Promise<BulkUploadSummary> {
    if (rows.length > MAX_ROWS) {
      throw new Error(
        `Maximum ${MAX_ROWS.toLocaleString()} rows per upload. Split into smaller files.`
      );
    }

    // Load all existing site codes from Firestore for uniqueness checks.
    const sitesSnap = await getDocs(query(collection(db, 'sites'), where('archived', '==', false)));
    const existingSiteCodes = new Set<string>();
    sitesSnap.forEach((d) => {
      const code = (d.data()['siteCode'] as string | undefined)?.toLowerCase();
      if (code) existingSiteCodes.add(code);
    });

    // Build projectCode → Project map from the already-loaded store.
    const projectMap = new Map<string, typeof projects[0]>();
    projects.forEach((p) => {
      if (p.projectCode) {
        projectMap.set(p.projectCode.toUpperCase(), p);
      }
    });

    // Track site codes seen within this upload to catch intra-file duplicates.
    const seenInUpload = new Set<string>();

    const results: BulkRowResult[] = [];

    for (const row of rows) {
      const errors: string[] = [];

      // ── Required field checks ───────────────────────────────────────────────
      if (!row.projectCode?.trim()) errors.push('projectCode is required');
      if (!row.siteCode?.trim())    errors.push('siteCode is required');
      if (!row.siteName?.trim())    errors.push('siteName is required');
      if (!row.city?.trim())        errors.push('city is required');
      if (!row.state?.trim())       errors.push('state is required');

      // ── Project must exist ─────────────────────────────────────────────────
      const projCode = row.projectCode?.trim().toUpperCase();
      if (projCode && !projectMap.has(projCode)) {
        const validCodes = Array.from(projectMap.keys()).join(', ') || 'none defined';
        errors.push(`Project "${row.projectCode}" not found. Valid codes: ${validCodes}`);
      }

      // ── siteCode must not already exist in Firestore ───────────────────────
      const siteCodeLower = row.siteCode?.trim().toLowerCase();
      if (siteCodeLower && existingSiteCodes.has(siteCodeLower)) {
        errors.push(`Site code "${row.siteCode}" already exists`);
      }

      // ── siteCode must not appear twice in this upload file ─────────────────
      if (siteCodeLower && seenInUpload.has(siteCodeLower)) {
        errors.push(`Duplicate site code "${row.siteCode}" in this file`);
      }
      if (siteCodeLower) seenInUpload.add(siteCodeLower);

      // ── GPS: validate only when provided ──────────────────────────────────
      if (row.latitude?.trim()) {
        const lat = parseFloat(row.latitude);
        if (isNaN(lat) || lat < -90 || lat > 90) {
          errors.push('latitude must be a decimal number between -90 and 90');
        }
      }
      if (row.longitude?.trim()) {
        const lng = parseFloat(row.longitude);
        if (isNaN(lng) || lng < -180 || lng > 180) {
          errors.push('longitude must be a decimal number between -180 and 180');
        }
      }

      results.push({
        rowNumber: row.rowNumber,
        status:    errors.length > 0 ? 'error' : 'valid',
        data:      row,
        errors,
      });
    }

    const validRows = results.filter((r) => r.status === 'valid').length;

    return {
      totalRows: rows.length,
      validRows,
      errorRows: rows.length - validRows,
      results,
    };
  }

  // ── Commit ───────────────────────────────────────────────────────────────────

  async function commitUpload(
    summary:    BulkUploadSummary,
    fileName:   string,
    onProgress?: (current: number, total: number) => void,
  ): Promise<number> {
    const validResults = summary.results.filter((r) => r.status === 'valid');

    if (validResults.length === 0) {
      throw new Error('No valid rows to upload');
    }

    // Rebuild project map (same store reference — no extra fetch needed).
    const projectMap = new Map<string, typeof projects[0]>();
    projects.forEach((p) => {
      if (p.projectCode) projectMap.set(p.projectCode.toUpperCase(), p);
    });

    const writeErrors: { row: number; reason: string }[] = [];
    let   successCount = 0;

    // Process in batches of SITES_PER_BATCH.
    for (let i = 0; i < validResults.length; i += SITES_PER_BATCH) {
      const chunk = validResults.slice(i, i + SITES_PER_BATCH);
      const batch = writeBatch(db);

      for (const result of chunk) {
        const row      = result.data;
        const projCode = row.projectCode.trim().toUpperCase();
        const project  = projectMap.get(projCode);

        if (!project) {
          writeErrors.push({
            row:    row.rowNumber,
            reason: `Project ${projCode} not found at write time`,
          });
          continue;
        }

        // ── Site document ───────────────────────────────────────────────────
        const siteRef  = doc(collection(db, 'sites'));
        const siteId   = siteRef.id;
        const siteCode = row.siteCode.trim().toUpperCase();
        const siteName = row.siteName.trim();
        const city     = row.city.trim();

        const hasGps =
          row.latitude?.trim() !== '' && row.longitude?.trim() !== '';

        const templates = project.taskTemplates ?? [];

        batch.set(siteRef, {
          siteCode,
          siteName,
          city,
          state:              row.state.trim(),
          circle:             row.circle?.trim()   ?? '',
          division:           row.division?.trim() ?? '',
          address:            row.address?.trim()  ?? '',
          projectId:          project.id,
          projectName:        project.title,     // project.title — not projectName
          projectCode:        project.projectCode ?? projCode,
          location:           hasGps
            ? new GeoPoint(parseFloat(row.latitude!), parseFloat(row.longitude!))
            : null,
          status:              'active',
          taskCount:           templates.length,
          completedTaskCount:  0,
          inProgressTaskCount: 0,
          blockedTaskCount:    0,
          pendingApprovalTaskCount: 0,
          createdAt:           serverTimestamp(),
          createdBy:           currentUser?.uid ?? '',
          archived:            false,
          archivedAt:          null,
        });

        // ── SiteTask documents — one per task template ─────────────────────
        for (const template of templates) {
          const taskRef  = doc(collection(db, 'siteTasks'));
          const taskCode = `${siteCode}/${project.projectCode ?? projCode}/${template.taskKey.toUpperCase()}-01`;

          batch.set(taskRef, {
            taskCode,
            siteId,
            siteCode,
            siteName,
            city,
            projectId:          project.id,
            projectName:        project.title,
            projectCode:        project.projectCode ?? projCode,
            taskKey:            template.taskKey,
            taskLabel:          template.label,
            taskColour:         template.colour ?? '#6B7280',
            subtasks:           template.subtasks ?? [],   // snapshot — immune to future edits
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
            approverUid:        project.defaultApproverUid  ?? null,
            approverName:       project.defaultApproverName ?? null,
            approverCode:       null,
            reviewNotes:        null,
            reviewedBy:         null,
            reviewedByName:     null,
            reviewedAt:         null,
          });
        }

        successCount++;
      }

      await batch.commit();

      onProgress?.(
        Math.min(i + SITES_PER_BATCH, validResults.length),
        validResults.length,
      );
    }

    // ── Audit record in bulkUploads ────────────────────────────────────────
    const auditRef = doc(collection(db, 'bulkUploads'));
    await setDoc(auditRef, {
      uploadType:      'sites',
      uploadedBy:      currentUser?.uid  ?? '',
      uploadedByName:  currentUser?.name ?? '',
      uploadedAt:      serverTimestamp(),
      fileName,
      rowCount:        summary.totalRows,
      successCount,
      errorCount:      summary.errorRows + writeErrors.length,
      errors:          writeErrors,
    });

    return successCount;
  }

  return { parseFile, validateRows, commitUpload };
}
