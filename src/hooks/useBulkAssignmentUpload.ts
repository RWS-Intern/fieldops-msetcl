import Papa from 'papaparse';
import {
  collection,
  doc,
  setDoc,
  getDocs,
  query,
  where,
  runTransaction,
  serverTimestamp,
  Timestamp,
  addDoc,
} from 'firebase/firestore';
import { db }           from '@/firebase/config';
import { useAuthStore } from '@/store/authStore';
import type {
  AssignmentUploadRow,
  AssignmentRowResult,
  AssignmentRowStatus,
  AssignmentUploadSummary,
} from '@/types';

// ─── Constants ─────────────────────────────────────────────────────────────────

const REQUIRED_HEADERS = ['siteCode', 'taskKey', 'engineerCode'];

/** Maximum rows per upload. */
const MAX_ROWS = 1000;

// ─── Hook ──────────────────────────────────────────────────────────────────────

export function useBulkAssignmentUpload() {
  const { currentUser } = useAuthStore();

  // ── Parse ────────────────────────────────────────────────────────────────────

  function parseFile(file: File): Promise<AssignmentUploadRow[]> {
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
          const headers = Object.keys(
            (result.data as Record<string, unknown>[])[0] ?? {}
          );

          const missing = REQUIRED_HEADERS.filter((h) => !headers.includes(h));
          if (missing.length > 0) {
            reject(
              new Error(
                `Missing required columns: ${missing.join(', ')}. ` +
                `Download the template for the correct format.`
              )
            );
            return;
          }

          const rows: AssignmentUploadRow[] = (
            result.data as Record<string, string>[]
          ).map((row, idx) => ({
            rowNumber:    idx + 2,        // +2 = 1-indexed + skip header row
            siteCode:     row['siteCode']?.trim()     ?? '',
            taskKey:      row['taskKey']?.trim()      ?? '',
            engineerCode: row['engineerCode']?.trim() ?? '',
            dueDate:      row['dueDate']?.trim()      ?? '',
          }));

          resolve(rows);
        },
        error: (err: Error) => {
          reject(new Error(`Failed to parse file: ${err.message}`));
        },
      });
    });
  }

  // ── Validate ─────────────────────────────────────────────────────────────────

  async function validateRows(
    rows: AssignmentUploadRow[]
  ): Promise<AssignmentUploadSummary> {
    if (rows.length > MAX_ROWS) {
      throw new Error(
        `Maximum ${MAX_ROWS.toLocaleString()} rows per upload. Split into smaller files.`
      );
    }

    // ── Step 1: Load all field engineers keyed by engineerCode (uppercase) ────
    const engineersSnap = await getDocs(
      query(collection(db, 'users'), where('role', '==', 'field'))
    );
    const engineerMap = new Map<
      string,
      { uid: string; name: string; engineerCode: string; active: boolean }
    >();
    engineersSnap.forEach((d) => {
      const data = d.data();
      if (data['engineerCode']) {
        engineerMap.set(data['engineerCode'].toUpperCase(), {
          uid:          d.id,
          name:         (data['name'] as string) ?? '',
          engineerCode: data['engineerCode'] as string,
          active:       data['active'] !== false,
        });
      }
    });

    // ── Step 2: Load all sites keyed by siteCode (lowercase) ─────────────────
    // Fetch all sites (including archived) so we can warn when a code maps to
    // an archived site rather than silently dropping it.
    const sitesSnap = await getDocs(collection(db, 'sites'));
    const siteMap = new Map<
      string,
      { id: string; siteCode: string; projectId: string; archived: boolean }
    >();
    sitesSnap.forEach((d) => {
      const data = d.data();
      if (data['siteCode']) {
        siteMap.set(data['siteCode'].toLowerCase(), {
          id:        d.id,
          siteCode:  data['siteCode'] as string,
          projectId: (data['projectId'] as string) ?? '',
          archived:  data['archived'] === true,
        });
      }
    });

    // ── Step 3: For each unique siteCode, load its siteTasks keyed by taskKey ─
    const uniqueSiteCodes = [
      ...new Set(rows.map((r) => r.siteCode.toLowerCase())),
    ];

    // key: "siteCodeLower|taskKey"
    const siteTaskMap = new Map<
      string,
      { id: string; taskLabel: string; status: string }
    >();

    for (const siteCodeLower of uniqueSiteCodes) {
      const site = siteMap.get(siteCodeLower);
      if (!site) continue;

      const tasksSnap = await getDocs(
        query(collection(db, 'siteTasks'), where('siteId', '==', site.id))
      );
      tasksSnap.forEach((d) => {
        const data = d.data();
        const key  = `${siteCodeLower}|${data['taskKey']}`;
        siteTaskMap.set(key, {
          id:        d.id,
          taskLabel: (data['taskLabel'] as string) ?? (data['taskKey'] as string) ?? '',
          status:    (data['status']    as string) ?? 'pending',
        });
      });
    }

    // ── Step 4: Validate each row ─────────────────────────────────────────────
    const seenCombos = new Set<string>();
    const results: AssignmentRowResult[] = [];

    for (const row of rows) {
      const errors:   string[] = [];
      const warnings: string[] = [];

      // Required fields
      if (!row.siteCode)     errors.push('siteCode is required');
      if (!row.taskKey)      errors.push('taskKey is required');
      if (!row.engineerCode) errors.push('engineerCode is required');

      // Site exists and not archived
      const siteCodeLower = row.siteCode.toLowerCase();
      const site          = siteMap.get(siteCodeLower);
      if (row.siteCode && !site) {
        errors.push(`Site "${row.siteCode}" not found`);
      } else if (site?.archived) {
        errors.push(`Site "${row.siteCode}" is archived`);
      }

      // Task exists at this site
      const comboKey = `${siteCodeLower}|${row.taskKey}`;
      const siteTask = siteTaskMap.get(comboKey);
      if (row.siteCode && row.taskKey && site && !site.archived && !siteTask) {
        errors.push(`Task "${row.taskKey}" not found at site "${row.siteCode}"`);
      }

      // Already completed — warning (will still be reassigned)
      if (siteTask?.status === 'completed') {
        warnings.push('Task is already completed — will be reassigned');
      }

      // Engineer exists and is active
      const engineer = engineerMap.get(row.engineerCode.toUpperCase());
      if (row.engineerCode && !engineer) {
        errors.push(`Engineer "${row.engineerCode}" not found`);
      } else if (engineer && !engineer.active) {
        errors.push(`Engineer "${row.engineerCode}" is disabled`);
      }

      // dueDate — optional, but if provided must be a valid YYYY-MM-DD date
      let parsedDueDate: Date | null = null;
      if (row.dueDate) {
        const d = new Date(row.dueDate);
        if (isNaN(d.getTime())) {
          errors.push(
            `dueDate "${row.dueDate}" is not a valid date. Use YYYY-MM-DD format.`
          );
        } else {
          parsedDueDate = d;
        }
      }

      // Duplicate siteCode+taskKey combination within this file
      if (row.siteCode && row.taskKey) {
        if (seenCombos.has(comboKey)) {
          errors.push(
            `Duplicate: ${row.siteCode}/${row.taskKey} already appears in this file`
          );
        } else {
          seenCombos.add(comboKey);
        }
      }

      // Determine final row status
      const status: AssignmentRowStatus =
        errors.length > 0 ? 'error' : warnings.length > 0 ? 'warning' : 'valid';

      // Build resolved payload for valid/warning rows only
      const resolved =
        errors.length === 0 && site && siteTask && engineer
          ? {
              siteTaskId:   siteTask.id,
              siteId:       site.id,
              siteCode:     site.siteCode,
              taskKey:      row.taskKey,
              taskLabel:    siteTask.taskLabel,
              engineerUid:  engineer.uid,
              engineerName: engineer.name,
              engineerCode: engineer.engineerCode,
              dueDate:      parsedDueDate,
            }
          : undefined;

      results.push({ rowNumber: row.rowNumber, status, data: row, errors, warnings, resolved });
    }

    const validRows   = results.filter((r) => r.status === 'valid').length;
    const warningRows = results.filter((r) => r.status === 'warning').length;
    const errorRows   = results.filter((r) => r.status === 'error').length;

    return { totalRows: rows.length, validRows, warningRows, errorRows, results };
  }

  // ── Commit ───────────────────────────────────────────────────────────────────

  async function commitUpload(
    summary:    AssignmentUploadSummary,
    fileName:   string,
    onProgress?: (current: number, total: number) => void,
  ): Promise<number> {
    // Include both valid AND warning rows (warnings are reassignments of completed tasks)
    const toAssign = summary.results.filter(
      (r) => r.status !== 'error' && r.resolved
    );

    if (toAssign.length === 0) {
      throw new Error('No valid rows to assign');
    }

    let successCount = 0;
    const writeErrors: { row: number; reason: string }[] = [];

    // Process sequentially — not in parallel — to avoid transaction conflicts
    // on the same siteTask being assigned by two rows.
    for (let i = 0; i < toAssign.length; i++) {
      const result   = toAssign[i];
      const resolved = result.resolved!;

      try {
        await runTransaction(db, async (transaction) => {
          const taskRef  = doc(db, 'siteTasks', resolved.siteTaskId);
          const taskSnap = await transaction.get(taskRef);

          if (!taskSnap.exists()) {
            throw new Error('Task no longer exists');
          }

          transaction.update(taskRef, {
            assignedTo:     resolved.engineerUid,
            assignedToName: resolved.engineerName,
            assignedToCode: resolved.engineerCode,
            dueDate:        resolved.dueDate
              ? Timestamp.fromDate(resolved.dueDate)
              : null,
            updatedAt:      serverTimestamp(),
          });
        });

        // Per-assignment audit log entry
        await addDoc(collection(db, 'auditLog'), {
          action:      'BULK_ASSIGN_SITE_TASK',
          detail:
            `${resolved.engineerName} (${resolved.engineerCode}) assigned to ` +
            `${resolved.siteCode}/${resolved.taskKey}`,
          siteTaskId:  resolved.siteTaskId,
          siteCode:    resolved.siteCode,
          taskKey:     resolved.taskKey,
          engineerUid: resolved.engineerUid,
          engineerCode: resolved.engineerCode,
          performedBy: currentUser?.uid ?? '',
          performedAt: serverTimestamp(),
        });

        successCount++;
      } catch (err: unknown) {
        writeErrors.push({
          row:    result.rowNumber,
          reason: err instanceof Error ? err.message : 'Transaction failed',
        });
      }

      onProgress?.(i + 1, toAssign.length);
    }

    // ── Bulk upload audit record ───────────────────────────────────────────
    const auditRef = doc(collection(db, 'bulkUploads'));
    await setDoc(auditRef, {
      uploadType:     'assignments',
      uploadedBy:     currentUser?.uid  ?? '',
      uploadedByName: currentUser?.name ?? '',
      uploadedAt:     serverTimestamp(),
      fileName,
      rowCount:       summary.totalRows,
      successCount,
      errorCount:     summary.errorRows + writeErrors.length,
      errors:         writeErrors,
    });

    return successCount;
  }

  return { parseFile, validateRows, commitUpload };
}
