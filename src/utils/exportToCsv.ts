/**
 * exportToCsv — serialises an array of flat objects to a CSV file and
 * triggers a browser download.
 *
 * Handles values that contain commas, double-quotes, or newlines by wrapping
 * them in double-quotes and escaping internal quotes as "".
 */
export function exportToCsv(
  filename: string,
  rows: Record<string, unknown>[],
): void {
  if (rows.length === 0) return;

  const headers = Object.keys(rows[0]);

  function escape(val: unknown): string {
    const str = val == null ? '' : String(val);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  }

  const csvRows = [
    headers.join(','),
    ...rows.map((row) => headers.map((h) => escape(row[h])).join(',')),
  ];

  const blob = new Blob([csvRows.join('\n')], {
    type: 'text/csv;charset=utf-8;',
  });
  const url  = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href     = url;
  link.download = `${filename}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}
