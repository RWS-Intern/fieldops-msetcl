import type { SiteTask, SurveyReport } from '@/types';

/**
 * Formatted .xlsx export for the Reports page.
 *
 * Writes whatever is CURRENTLY ON SCREEN — the caller passes its already
 * filtered arrays, so the workbook always matches the filter bar rather than
 * quietly dumping the whole collection. The filters themselves are written
 * into the Summary sheet, so a file that has been emailed on still says what
 * it was a view of.
 *
 * exceljs is imported dynamically: it is roughly a megabyte, and nobody
 * should pay for it on a page load where they never press Export. That also
 * keeps it out of the main chunk of an app whose field users are on slow
 * connections.
 */

/** One column of a sheet: header text, the value getter, and a width in characters. */
interface Column<T> {
  header: string;
  width:  number;
  value:  (row: T) => string | number | Date | null;
}

const HEADER_FILL = 'FF0077B6';   // brand-blue, matching the app header

/** dd-mm-yyyy, the format every date field in this app is entered and shown in. */
function fmtDate(d: Date | null | undefined): string {
  if (!d || Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()}`;
}

/** Turns a snake_case status into the wording the UI shows. */
function statusLabel(status: string): string {
  if (!status) return '';
  return status
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export interface ReportsExportInput {
  tasks:   SiteTask[];
  surveys: SurveyReport[];
  /** uid → display name, for resolving assignees the documents only hold ids for. */
  userNameByUid:   Map<string, string>;
  /** uid → vendor name, so vendor lands in the sheet without a lookup per row. */
  vendorNameByUid: Map<string, string>;
  /** siteId → { city, projectName }, since a SurveyReport carries neither. */
  siteMetaById:    Map<string, { city: string; projectName: string }>;
  /** Human-readable "Vendor: Rite Water" lines describing the active filters. */
  activeFilters:   { label: string; value: string }[];
}

const TASK_COLUMNS: Column<SiteTask>[] = [
  { header: 'Task Code',     width: 30, value: (t) => t.taskCode },
  { header: 'Task',          width: 22, value: (t) => t.taskLabel },
  { header: 'Site Code',     width: 16, value: (t) => t.siteCode },
  { header: 'Substation',    width: 26, value: (t) => t.siteName },
  { header: 'City',          width: 16, value: (t) => t.city },
  { header: 'Project',       width: 22, value: (t) => t.projectName },
  { header: 'Status',        width: 18, value: (t) => statusLabel(t.status) },
  { header: 'Assigned To',   width: 22, value: (t) => t.assignedToName ?? '' },
  { header: 'Engineer Code', width: 14, value: (t) => t.assignedToCode ?? '' },
  { header: 'Approver',      width: 22, value: (t) => t.approverName ?? '' },
  { header: 'Start Date',    width: 13, value: (t) => fmtDate(t.startDate) },
  { header: 'Due Date',      width: 13, value: (t) => fmtDate(t.dueDate) },
  { header: 'Submitted At',  width: 14, value: (t) => fmtDate(t.submittedAt) },
  { header: 'Reviewed At',   width: 14, value: (t) => fmtDate(t.reviewedAt) },
  { header: 'Last Updated',  width: 14, value: (t) => fmtDate(t.updatedAt) },
  { header: 'Blocked Reason', width: 30, value: (t) => t.blockedReason ?? '' },
];

const SURVEY_COLUMNS: Column<SurveyReport>[] = [
  { header: 'Work Order',    width: 28, value: (s) => s.workOrderCode },
  { header: 'Site Code',     width: 16, value: (s) => s.siteCode },
  { header: 'Substation',    width: 26, value: (s) => s.siteName },
  { header: 'SAP Code',      width: 14, value: (s) => s.sapCode ?? '' },
  { header: 'Zone',          width: 16, value: (s) => s.zone ?? '' },
  { header: 'Voltage Class', width: 13, value: (s) => s.voltageClass ?? '' },
  { header: 'Status',        width: 18, value: (s) => statusLabel(s.status) },
  { header: 'Assigned To',   width: 22, value: (s) => s.assignedToName ?? '' },
  { header: 'Current Approver', width: 22, value: (s) => s.approverName ?? '' },
  { header: 'Survey Date',   width: 13, value: (s) => fmtDate(s.surveyDate) },
  { header: 'Submitted At',  width: 14, value: (s) => fmtDate(s.submittedAt) },
  { header: 'Reviewed At',   width: 14, value: (s) => fmtDate(s.reviewedAt) },
  { header: 'Last Updated',  width: 14, value: (s) => fmtDate(s.updatedAt) },
];

export async function exportReportsExcel(input: ReportsExportInput): Promise<void> {
  const { tasks, surveys, vendorNameByUid, siteMetaById, activeFilters } = input;

  const ExcelJS  = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'FieldOps — MSETCL Substation';
  workbook.created = new Date();

  /** Applies the shared header styling, widths, freeze and autofilter to a sheet. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function dressSheet(sheet: any, headers: string[], widths: number[]): void {
    sheet.columns = widths.map((w) => ({ width: w }));

    const headerRow = sheet.getRow(1);
    headers.forEach((h, i) => { headerRow.getCell(i + 1).value = h; });
    headerRow.font      = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    headerRow.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
    headerRow.alignment = { vertical: 'middle', horizontal: 'left' };
    headerRow.height    = 22;
    headerRow.commit();

    // Header stays visible while scrolling, and every column gets a filter
    // dropdown — the two things that make a long export usable in Excel.
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to:   { row: 1, column: headers.length },
    };
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  // First sheet on purpose: whoever opens the file should see what it is a
  // view of before they see the rows.
  const summary = workbook.addWorksheet('Summary');
  summary.columns = [{ width: 26 }, { width: 34 }];

  const title = summary.getRow(1);
  title.getCell(1).value = 'FieldOps — Reports Export';
  title.font = { bold: true, size: 14 };
  title.commit();

  summary.getRow(2).getCell(1).value = 'Generated';
  summary.getRow(2).getCell(2).value = new Date().toLocaleString('en-GB');

  let line = 4;
  const sectionHeading = (text: string) => {
    const row = summary.getRow(line++);
    row.getCell(1).value = text;
    row.font = { bold: true, color: { argb: HEADER_FILL } };
    row.commit();
  };
  const kv = (k: string, v: string | number) => {
    const row = summary.getRow(line++);
    row.getCell(1).value = k;
    row.getCell(2).value = v;
    row.commit();
  };

  sectionHeading('Filters applied');
  if (activeFilters.length === 0) {
    kv('None', 'Showing all data');
  } else {
    activeFilters.forEach((f) => kv(f.label, f.value));
  }

  line++;
  sectionHeading('Totals');
  const completedTasks   = tasks.filter((t) => t.status === 'completed').length;
  const completedSurveys = surveys.filter(
    (s) => s.status === 'approved' || s.status === 'closed',
  ).length;
  kv('Site tasks', tasks.length);
  kv('Surveys', surveys.length);
  kv('Total', tasks.length + surveys.length);
  kv('Completed', completedTasks + completedSurveys);

  // ── Site Tasks ────────────────────────────────────────────────────────────
  const taskSheet = workbook.addWorksheet('Site Tasks');
  dressSheet(taskSheet, TASK_COLUMNS.map((c) => c.header), TASK_COLUMNS.map((c) => c.width));
  tasks.forEach((t) => {
    taskSheet.addRow(TASK_COLUMNS.map((c) => c.value(t)));
  });

  // Vendor is on the USER, not the task, so it is appended from the lookup
  // rather than declared as a column above.
  const vendorCol = TASK_COLUMNS.length + 1;
  taskSheet.getRow(1).getCell(vendorCol).value = 'Vendor';
  taskSheet.getColumn(vendorCol).width = 22;
  tasks.forEach((t, i) => {
    taskSheet.getRow(i + 2).getCell(vendorCol).value =
      (t.assignedTo && vendorNameByUid.get(t.assignedTo)) || '';
  });

  // ── Surveys ───────────────────────────────────────────────────────────────
  const surveySheet = workbook.addWorksheet('Surveys');
  const surveyHeaders = [...SURVEY_COLUMNS.map((c) => c.header), 'City', 'Project', 'Vendor'];
  const surveyWidths  = [...SURVEY_COLUMNS.map((c) => c.width), 16, 22, 22];
  dressSheet(surveySheet, surveyHeaders, surveyWidths);

  surveys.forEach((s) => {
    // City and Project come from the site: a SurveyReport carries neither,
    // matching how the page itself resolves them for filtering.
    const site = siteMetaById.get(s.siteId);
    surveySheet.addRow([
      ...SURVEY_COLUMNS.map((c) => c.value(s)),
      site?.city ?? '',
      site?.projectName ?? '',
      (s.assignedTo && vendorNameByUid.get(s.assignedTo)) || '',
    ]);
  });

  // Re-apply the header style: addRow after dressSheet leaves row 1 intact,
  // but the two appended columns on the task sheet were written cell-by-cell.
  const taskHeaderRow = taskSheet.getRow(1);
  taskHeaderRow.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
  taskHeaderRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
  taskHeaderRow.commit();
  taskSheet.autoFilter = {
    from: { row: 1, column: 1 },
    to:   { row: 1, column: vendorCol },
  };

  // ── Download ──────────────────────────────────────────────────────────────
  const buffer = await workbook.xlsx.writeBuffer();
  const blob   = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url  = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const stamp = fmtDate(new Date()).replace(/-/g, '');
  link.href     = url;
  link.download = `fieldops-report-${stamp}.xlsx`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
