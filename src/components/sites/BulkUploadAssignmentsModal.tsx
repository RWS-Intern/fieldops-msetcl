import { useState, useRef, useCallback } from 'react';
import { Upload, FileText, CheckCircle, AlertCircle, RotateCcw, UserPlus } from 'lucide-react';
import { downloadAssignmentTemplate, downloadTaskKeysReference } from '@/utils/downloadCsvTemplate';
import { useBulkAssignmentUpload }      from '@/hooks/useBulkAssignmentUpload';
import { useProjectStore }              from '@/store/projectStore';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { cn }     from '@/lib/utils';
import type { AssignmentUploadSummary } from '@/types';

// ─── Props ────────────────────────────────────────────────────────────────────

interface BulkUploadAssignmentsModalProps {
  open:      boolean;
  onClose:   () => void;
  onSuccess: (count: number) => void;
}

// ─── Step types ───────────────────────────────────────────────────────────────

type Step = 'upload' | 'results' | 'progress' | 'success';

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: 'valid' | 'error' | 'warning' }) {
  if (status === 'valid') {
    return (
      <span className="inline-flex items-center rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700">
        Valid
      </span>
    );
  }
  if (status === 'warning') {
    return (
      <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
        Warning
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">
      Error
    </span>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function BulkUploadAssignmentsModal({
  open,
  onClose,
  onSuccess,
}: BulkUploadAssignmentsModalProps) {
  const { parseFile, validateRows, commitUpload } = useBulkAssignmentUpload();
  const { projects } = useProjectStore();

  const [step,         setStep]         = useState<Step>('upload');
  const [parseError,   setParseError]   = useState<string | null>(null);
  const [parsing,      setParsing]      = useState(false);
  const [summary,      setSummary]      = useState<AssignmentUploadSummary | null>(null);
  const [fileName,     setFileName]     = useState('');
  const [progress,     setProgress]     = useState({ current: 0, total: 0 });
  const [commitError,  setCommitError]  = useState<string | null>(null);
  const [isDragOver,   setIsDragOver]   = useState(false);
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
      const rows   = await parseFile(file);
      const result = await validateRows(rows);
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
    const assignableCount = summary.validRows + summary.warningRows;
    setStep('progress');
    setProgress({ current: 0, total: assignableCount });
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
        `${msg} ${progress.current} of ${progress.total} engineers were assigned before the error. ` +
        `Please check the Sites page.`
      );
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────

  // Derive success-screen list from summary (valid + warning rows with resolved data)
  const completedResults = summary?.results.filter(
    (r) => r.status !== 'error' && r.resolved
  ) ?? [];
  const visibleResults = completedResults.slice(0, 10);
  const hiddenCount    = completedResults.length - visibleResults.length;

  const assignableCount = (summary?.validRows ?? 0) + (summary?.warningRows ?? 0);

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => { if (!v) handleClose(); }}
    >
      <DialogContent
        className="max-w-2xl"
        aria-describedby={undefined}
        onInteractOutside={(e) => { if (step === 'progress') e.preventDefault(); }}
        onEscapeKeyDown={(e)   => { if (step === 'progress') e.preventDefault(); }}
      >
        <DialogHeader>
          <DialogTitle>
            {step === 'success' ? 'Assignment Complete' : 'Bulk Assign Engineers'}
          </DialogTitle>
        </DialogHeader>

        {/* ── STEP 1: Upload ─────────────────────────────────────────────── */}
        {step === 'upload' && (
          <div className="flex flex-col gap-5 pt-1">
            <p className="text-sm text-gray-500">
              Upload a CSV to assign engineers to site tasks in bulk. Each row assigns
              one engineer to one task at one site.
            </p>

            {/* Download template */}
            <div className="flex items-center gap-3 rounded-lg border border-gray-100 bg-gray-50 p-3">
              <FileText className="h-5 w-5 text-brand-blue shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-800">assignments_template.csv</p>
                <p className="text-xs text-gray-500">
                  Required columns: siteCode, taskKey, engineerCode — optional: dueDate (YYYY-MM-DD)
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="shrink-0 text-xs h-8 gap-1.5"
                onClick={downloadAssignmentTemplate}
              >
                Download Template
              </Button>
            </div>

            {/* Task keys reference download */}
            <button
              type="button"
              onClick={() => downloadTaskKeysReference(projects)}
              className="text-sm text-blue-600 hover:underline flex items-center gap-1 self-start"
            >
              <FileText className="w-3 h-3" />
              Download task keys reference
            </button>

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

            {/* Helper note */}
            <p className="text-xs text-gray-500 -mt-2">
              Not sure about task keys? Download the task keys reference to see all
              valid taskKey values for each project.
            </p>

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
            {/* Summary bar */}
            <div className="flex items-center gap-2 flex-wrap">
              {summary.validRows > 0 && (
                <span className="flex items-center gap-1.5 rounded-full bg-green-50 px-3 py-1 text-sm font-medium text-green-700">
                  <CheckCircle className="h-3.5 w-3.5" />
                  {summary.validRows} valid
                </span>
              )}
              {summary.warningRows > 0 && (
                <span className="flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 text-sm font-medium text-amber-700">
                  <AlertCircle className="h-3.5 w-3.5" />
                  {summary.warningRows} warning{summary.warningRows !== 1 ? 's' : ''}
                </span>
              )}
              {summary.errorRows > 0 && (
                <span className="flex items-center gap-1.5 rounded-full bg-red-50 px-3 py-1 text-sm font-medium text-red-700">
                  <AlertCircle className="h-3.5 w-3.5" />
                  {summary.errorRows} error{summary.errorRows !== 1 ? 's' : ''}
                </span>
              )}
            </div>

            {/* Contextual notes */}
            <div className="flex flex-col gap-1">
              {summary.warningRows > 0 && (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded px-2 py-1">
                  Warning rows will still be assigned (tasks marked as completed will be reassigned).
                </p>
              )}
              {summary.errorRows > 0 && (
                <p className="text-xs text-gray-500">
                  Fix the errors in your file and re-upload, or proceed with valid rows only.
                </p>
              )}
            </div>

            {/* Results table */}
            <div className="overflow-auto rounded-lg border border-gray-100" style={{ maxHeight: '400px' }}>
              <table className="w-full text-xs">
                <thead className="bg-gray-50 sticky top-0 z-10">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold text-gray-600 w-10">Row</th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-600">Site Code</th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-600">Task Key</th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-600">Engineer</th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-600">Due Date</th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-600 w-20">Status</th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-600">Message</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.results.map((r) => (
                    <tr
                      key={r.rowNumber}
                      className={cn(
                        'border-t border-gray-50',
                        r.status === 'error'   && 'bg-red-50/40',
                        r.status === 'warning' && 'bg-amber-50/30',
                        r.status === 'valid'   && 'bg-white',
                      )}
                    >
                      <td className="px-3 py-2 font-mono text-gray-400">{r.rowNumber}</td>
                      <td className="px-3 py-2 font-mono text-gray-700">{r.data.siteCode || '—'}</td>
                      <td className="px-3 py-2 font-mono text-gray-600">{r.data.taskKey || '—'}</td>
                      <td className="px-3 py-2 text-gray-700">{r.data.engineerCode || '—'}</td>
                      <td className="px-3 py-2 text-gray-500">{r.data.dueDate || '—'}</td>
                      <td className="px-3 py-2">
                        <StatusBadge status={r.status} />
                      </td>
                      <td className="px-3 py-2 max-w-xs">
                        {r.errors.length > 0 && (
                          <span className="text-red-600">{r.errors.join('; ')}</span>
                        )}
                        {r.warnings.length > 0 && r.errors.length === 0 && (
                          <span className="text-amber-600">{r.warnings.join('; ')}</span>
                        )}
                      </td>
                    </tr>
                  ))}
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
                Re-upload
              </Button>
              <Button
                size="sm"
                disabled={assignableCount === 0}
                className="bg-brand-blue hover:bg-brand-navy text-white gap-1.5"
                onClick={handleCommit}
                title={assignableCount === 0 ? 'No valid rows to assign' : undefined}
              >
                <UserPlus className="h-3.5 w-3.5" />
                Assign {assignableCount} Engineer{assignableCount !== 1 ? 's' : ''}
              </Button>
            </div>
          </div>
        )}

        {/* ── STEP 3: Progress ──────────────────────────────────────────── */}
        {step === 'progress' && (
          <div className="flex flex-col items-center gap-5 py-8">
            <div className="h-10 w-10 animate-spin rounded-full border-4 border-brand-blue border-t-transparent" />
            <p className="text-sm font-medium text-gray-700">Assigning engineers…</p>

            <div className="w-full max-w-xs">
              <div className="flex justify-between text-xs text-gray-500 mb-1">
                <span>{progress.current} of {progress.total} complete</span>
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
          <div className="flex flex-col items-center gap-5 py-6">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-50">
              <CheckCircle className="h-9 w-9 text-green-500" />
            </div>

            <div className="text-center">
              <p className="text-lg font-semibold text-gray-900">
                {successCount} engineer{successCount !== 1 ? 's' : ''} assigned successfully!
              </p>
            </div>

            {/* Assignment list — max 10 visible */}
            {visibleResults.length > 0 && (
              <div className="w-full rounded-lg border border-gray-100 bg-gray-50 overflow-hidden">
                <div className="divide-y divide-gray-100">
                  {visibleResults.map((r) => (
                    <div key={r.rowNumber} className="px-3 py-2 text-xs font-mono text-gray-600">
                      <span className="font-semibold text-brand-blue">
                        {r.resolved!.engineerCode}
                      </span>
                      <span className="text-gray-400 mx-1.5">→</span>
                      {r.resolved!.siteCode}
                      <span className="text-gray-400 mx-1">/</span>
                      {r.resolved!.taskKey}
                    </div>
                  ))}
                </div>
                {hiddenCount > 0 && (
                  <p className="px-3 py-2 text-xs text-gray-400 border-t border-gray-100">
                    + {hiddenCount} more assignment{hiddenCount !== 1 ? 's' : ''}
                  </p>
                )}
              </div>
            )}

            <div className="flex gap-3">
              <Button
                variant="outline"
                size="sm"
                onClick={reset}
              >
                Assign Another Batch
              </Button>
              <Button
                size="sm"
                className="bg-brand-blue hover:bg-brand-navy text-white"
                onClick={() => {
                  reset();
                  onSuccess(successCount);
                }}
              >
                Done
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
