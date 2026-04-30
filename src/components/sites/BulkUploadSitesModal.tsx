import { useState, useRef, useCallback } from 'react';
import { Upload, FileText, CheckCircle, AlertCircle, RotateCcw } from 'lucide-react';
import { downloadSitesTemplate } from '@/utils/downloadCsvTemplate';
import { useBulkSiteUpload }     from '@/hooks/useBulkSiteUpload';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button }   from '@/components/ui/button';
import { cn }       from '@/lib/utils';
import type { BulkUploadSummary } from '@/types';

// ─── Props ────────────────────────────────────────────────────────────────────

interface BulkUploadSitesModalProps {
  open:      boolean;
  onClose:   () => void;
  onSuccess: (count: number) => void;
}

// ─── Step types ───────────────────────────────────────────────────────────────

type Step = 'upload' | 'results' | 'progress' | 'success';

// ─── Sub-components ───────────────────────────────────────────────────────────

/** Compact coloured dot with tooltip — saves column width vs a full text badge. */
function StatusDot({ status }: { status: 'valid' | 'error' | 'duplicate' }) {
  const colour =
    status === 'valid'     ? 'bg-green-500' :
    status === 'error'     ? 'bg-red-500'   :
    /* duplicate */          'bg-amber-500';
  const label =
    status === 'valid'     ? 'Valid'     :
    status === 'error'     ? 'Error'     :
    /* duplicate */          'Duplicate';
  return (
    <span
      title={label}
      aria-label={label}
      className={`inline-block w-2.5 h-2.5 rounded-full shrink-0 ${colour}`}
    />
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function BulkUploadSitesModal({
  open,
  onClose,
  onSuccess,
}: BulkUploadSitesModalProps) {
  const { parseFile, validateRows, commitUpload } = useBulkSiteUpload();

  const [step,        setStep]        = useState<Step>('upload');
  const [parseError,  setParseError]  = useState<string | null>(null);
  const [parsing,     setParsing]     = useState(false);
  const [summary,     setSummary]     = useState<BulkUploadSummary | null>(null);
  const [fileName,    setFileName]    = useState('');
  const [progress,    setProgress]    = useState({ current: 0, total: 0 });
  const [commitError, setCommitError] = useState<string | null>(null);
  const [isDragOver,  setIsDragOver]  = useState(false);
  const [successCount, setSuccessCount] = useState(0);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Reset to upload step ─────────────────────────────────────────────────────
  function reset() {
    setStep('upload');
    setParseError(null);
    setParsing(false);
    setSummary(null);
    setFileName('');
    setProgress({ current: 0, total: 0 });
    setCommitError(null);
    setIsDragOver(false);
    setSuccessCount(0);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function handleClose() {
    if (step === 'progress') return;   // block close during write
    reset();
    onClose();
  }

  // ── File processing ──────────────────────────────────────────────────────────
  const processFile = useCallback(async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.csv')) {
      setParseError('Only CSV files are supported. Download the template to get started.');
      return;
    }

    setParseError(null);
    setParsing(true);
    setFileName(file.name);

    try {
      const rows    = await parseFile(file);
      const result  = await validateRows(rows);
      setSummary(result);
      setStep('results');
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'Failed to parse file.');
    } finally {
      setParsing(false);
    }
  }, [parseFile, validateRows]);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) processFile(file);
  }

  // ── Commit ───────────────────────────────────────────────────────────────────
  async function handleCommit() {
    if (!summary) return;
    setStep('progress');
    setProgress({ current: 0, total: summary.validRows });
    setCommitError(null);

    try {
      const count = await commitUpload(
        summary,
        fileName,
        (current, total) => setProgress({ current, total }),
      );
      setSuccessCount(count);
      setStep('success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Upload failed.';
      setCommitError(
        `${msg} ${progress.current} of ${progress.total} sites were created before the error. ` +
        `Please check the Sites page.`
      );
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => { if (!v) handleClose(); }}
    >
      <DialogContent
        className="max-w-4xl w-[95vw] max-h-[90vh] overflow-y-auto"
        aria-describedby={undefined}
        // Block the default close-on-overlay-click during progress
        onInteractOutside={(e) => { if (step === 'progress') e.preventDefault(); }}
        onEscapeKeyDown={(e)   => { if (step === 'progress') e.preventDefault(); }}
      >
        <DialogHeader>
          <DialogTitle>
            {step === 'success' ? 'Upload Complete' : 'Bulk Upload Sites'}
          </DialogTitle>
        </DialogHeader>

        {/* ── STEP 1: Upload ─────────────────────────────────────────────── */}
        {step === 'upload' && (
          <div className="flex flex-col gap-5 pt-1">
            <p className="text-sm text-gray-500">
              Upload a CSV file to create multiple sites at once. Each site's tasks
              will be auto-created from the project's task templates.
            </p>

            {/* Download template */}
            <div className="flex items-center gap-3 rounded-lg border border-gray-100 bg-gray-50 p-3">
              <FileText className="h-5 w-5 text-brand-blue shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-800">sites_template.csv</p>
                <p className="text-xs text-gray-500">
                  Required: projectCode, siteCode, siteName, city, state.
                  Optional: circle, division, address, latitude, longitude.
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="shrink-0 text-xs h-8 gap-1.5"
                onClick={downloadSitesTemplate}
              >
                Download Template
              </Button>
            </div>

            {/* Parse error */}
            {parseError && (
              <div className="flex items-start gap-2 rounded-lg border border-red-100 bg-red-50 p-3">
                <AlertCircle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
                <p className="text-sm text-red-700">{parseError}</p>
              </div>
            )}

            {/* Drop zone */}
            <div
              role="button"
              tabIndex={0}
              className={cn(
                'relative flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed py-10 px-6 transition-colors cursor-pointer',
                isDragOver
                  ? 'border-brand-blue bg-blue-50'
                  : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50',
                parsing && 'pointer-events-none opacity-60',
              )}
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click(); }}
              onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
              onDragLeave={() => setIsDragOver(false)}
              onDrop={handleDrop}
            >
              {parsing ? (
                <>
                  <div className="h-8 w-8 animate-spin rounded-full border-3 border-brand-blue border-t-transparent" />
                  <p className="text-sm text-gray-500">Parsing and validating…</p>
                </>
              ) : (
                <>
                  <Upload className="h-8 w-8 text-gray-300" />
                  <div className="text-center">
                    <p className="text-sm font-medium text-gray-700">
                      Drop CSV here or click to browse
                    </p>
                    <p className="text-xs text-gray-400 mt-1">
                      CSV files only · max 5 MB · max 1,000 rows
                    </p>
                  </div>
                </>
              )}
            </div>

            {/* Hidden file input */}
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={handleFileChange}
            />
          </div>
        )}

        {/* ── STEP 2: Validation results ────────────────────────────────── */}
        {step === 'results' && summary && (
          <div className="flex flex-col gap-4 pt-1">

            {/* Summary bar — wraps on small screens */}
            <div className="flex flex-wrap items-center gap-3 p-3 bg-gray-50 rounded-lg text-sm">
              <span className="flex items-center gap-1.5 rounded-full bg-green-50 px-3 py-1 text-sm font-medium text-green-700">
                <CheckCircle className="h-3.5 w-3.5" />
                {summary.validRows} row{summary.validRows !== 1 ? 's' : ''} valid
              </span>
              {summary.errorRows > 0 && (
                <span className="flex items-center gap-1.5 rounded-full bg-red-50 px-3 py-1 text-sm font-medium text-red-700">
                  <AlertCircle className="h-3.5 w-3.5" />
                  {summary.errorRows} row{summary.errorRows !== 1 ? 's' : ''} with errors
                </span>
              )}
              {summary.errorRows > 0 && (
                <p className="w-full text-xs text-gray-500 mt-0.5">
                  Fix errors and re-upload, or proceed with valid rows only.
                </p>
              )}
            </div>

            {/* Results table — scrolls both axes; table never wraps */}
            <div className="overflow-x-auto max-h-96 overflow-y-auto border border-gray-200 rounded-lg">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead>
                  <tr>
                    {/* Column order: # | ● | Site Code | Site Name | Project | City | Circle | Division | Errors */}
                    <th className="px-2 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap bg-gray-50 sticky top-0 w-8">#</th>
                    <th className="px-2 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap bg-gray-50 sticky top-0 w-8">
                      <span className="sr-only">Status</span>●
                    </th>
                    <th className="px-2 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap bg-gray-50 sticky top-0">Site Code</th>
                    <th className="px-2 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap bg-gray-50 sticky top-0">Site Name</th>
                    <th className="px-2 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap bg-gray-50 sticky top-0">Project</th>
                    <th className="px-2 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap bg-gray-50 sticky top-0">City</th>
                    <th className="px-2 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap bg-gray-50 sticky top-0">Circle</th>
                    <th className="px-2 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap bg-gray-50 sticky top-0">Division</th>
                    <th className="px-2 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap bg-gray-50 sticky top-0 min-w-[180px]">Errors</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-100">
                  {summary.results.map((r) => {
                    const errorText = r.errors.join('; ');
                    return (
                      <tr
                        key={r.rowNumber}
                        className={r.status === 'error' ? 'bg-red-50/30' : undefined}
                      >
                        <td className="px-2 py-2 text-xs font-mono text-gray-400 whitespace-nowrap">{r.rowNumber}</td>
                        <td className="px-2 py-2 whitespace-nowrap">
                          <StatusDot status={r.status} />
                        </td>
                        <td className="px-2 py-2 text-xs font-mono text-gray-800 whitespace-nowrap max-w-[120px] truncate" title={r.data.siteCode || undefined}>
                          {r.data.siteCode  || '—'}
                        </td>
                        <td className="px-2 py-2 text-xs text-gray-700 whitespace-nowrap max-w-[140px] truncate" title={r.data.siteName || undefined}>
                          {r.data.siteName  || '—'}
                        </td>
                        <td className="px-2 py-2 text-xs text-gray-700 whitespace-nowrap max-w-[100px] truncate" title={r.data.projectCode || undefined}>
                          {r.data.projectCode || '—'}
                        </td>
                        <td className="px-2 py-2 text-xs text-gray-600 whitespace-nowrap max-w-[100px] truncate" title={r.data.city || undefined}>
                          {r.data.city        || '—'}
                        </td>
                        <td className="px-2 py-2 text-xs text-gray-500 whitespace-nowrap max-w-[100px] truncate" title={r.data.circle || undefined}>
                          {r.data.circle      || '—'}
                        </td>
                        <td className="px-2 py-2 text-xs text-gray-500 whitespace-nowrap max-w-[100px] truncate" title={r.data.division || undefined}>
                          {r.data.division    || '—'}
                        </td>
                        <td className="px-2 py-2 text-xs text-red-600 max-w-[200px]">
                          {errorText ? (
                            <span className="block truncate" title={errorText}>
                              {errorText}
                            </span>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Footer buttons */}
            <div className="flex justify-between gap-3 pt-1">
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={reset}
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Re-upload File
              </Button>
              <Button
                size="sm"
                disabled={summary.validRows === 0}
                className="bg-brand-blue hover:bg-brand-navy text-white gap-1.5"
                onClick={handleCommit}
                title={summary.validRows === 0 ? 'No valid rows to create' : undefined}
              >
                Create {summary.validRows} Valid Site{summary.validRows !== 1 ? 's' : ''}
              </Button>
            </div>
          </div>
        )}

        {/* ── STEP 3: Progress ──────────────────────────────────────────── */}
        {step === 'progress' && (
          <div className="flex flex-col items-center gap-5 py-8">
            <div className="h-10 w-10 animate-spin rounded-full border-4 border-brand-blue border-t-transparent" />
            <p className="text-sm font-medium text-gray-700">Creating sites…</p>

            <div className="w-full max-w-xs">
              <div className="flex justify-between text-xs text-gray-500 mb-1">
                <span>{progress.current} of {progress.total} sites created</span>
                <span>
                  {progress.total > 0
                    ? Math.round((progress.current / progress.total) * 100)
                    : 0}%
                </span>
              </div>
              <div className="h-2 w-full rounded-full bg-gray-100 overflow-hidden">
                <div
                  className="h-full rounded-full bg-brand-blue transition-all duration-300"
                  style={{
                    width: progress.total > 0
                      ? `${(progress.current / progress.total) * 100}%`
                      : '0%',
                  }}
                />
              </div>
            </div>

            {commitError && (
              <div className="w-full rounded-lg border border-red-100 bg-red-50 p-3">
                <p className="text-sm text-red-700">{commitError}</p>
              </div>
            )}

            <p className="text-xs text-gray-400">Please do not close this window.</p>
          </div>
        )}

        {/* ── STEP 4: Success ───────────────────────────────────────────── */}
        {step === 'success' && (
          <div className="flex flex-col items-center gap-5 py-8">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-50">
              <CheckCircle className="h-9 w-9 text-green-500" />
            </div>

            <div className="text-center">
              <p className="text-lg font-semibold text-gray-900">
                {successCount} site{successCount !== 1 ? 's' : ''} created successfully!
              </p>
              <p className="text-sm text-gray-500 mt-1 max-w-xs">
                Each site's tasks have been auto-created and are ready for assignment.
              </p>
            </div>

            <div className="flex gap-3">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  reset();
                  onSuccess(successCount);
                }}
              >
                Upload Another File
              </Button>
              <Button
                size="sm"
                className="bg-brand-blue hover:bg-brand-navy text-white"
                onClick={() => {
                  reset();
                  onSuccess(successCount);
                }}
              >
                View Sites
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
