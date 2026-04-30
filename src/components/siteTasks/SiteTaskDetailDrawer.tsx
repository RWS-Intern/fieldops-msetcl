import { useState, useEffect, useRef } from 'react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button }   from '@/components/ui/button';
import { Label }    from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  doc,
  collection,
  updateDoc,
  runTransaction,
  addDoc,
  serverTimestamp,
  onSnapshot,
  query,
  orderBy,
  Timestamp,
} from 'firebase/firestore';
import { db }                  from '@/firebase/config';
import { useFieldEngineers }   from '@/hooks/useFieldEngineers';
import { useAuthStore }        from '@/store/authStore';
import { useToast }            from '@/components/ui/toast';
import { formatDateTime }      from '@/lib/taskUtils';
import type { SiteTask, TaskStatus } from '@/types';
import { MapPin, X, ChevronDown, ChevronUp, Archive } from 'lucide-react';

// ─── Constants ────────────────────────────────────────────────────────────────

const TASK_STATUS_BADGE: Record<TaskStatus, string> = {
  pending:     'bg-gray-100 text-gray-600',
  in_progress: 'bg-amber-50 text-amber-700',
  completed:   'bg-green-50 text-green-700',
  blocked:     'bg-red-50 text-red-700',
};

const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  pending:     'Pending',
  in_progress: 'In Progress',
  completed:   'Completed',
  blocked:     'Blocked',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Convert a Date to the 'YYYY-MM-DD' string required by <input type="date">.
 * Uses local time components to avoid the UTC-midnight offset bug that
 * toISOString() introduces.
 */
function toDateInputValue(date: Date | null | undefined): string {
  if (!date) return '';
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// ─── History type ─────────────────────────────────────────────────────────────

interface HistoryEntry {
  id:              string;
  submittedByName: string;
  submittedAt:     Date;
  status:          TaskStatus;
  blockedReason:   string | null;
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface SiteTaskDetailDrawerProps {
  task:      SiteTask | null;
  open:      boolean;
  onClose:   () => void;
  /** When true: hides the assignment form and archive button.
   *  Used when opening from Recent Activity (read-only context). */
  readOnly?: boolean;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function SiteTaskDetailDrawer({
  task,
  open,
  onClose,
  readOnly = false,
}: SiteTaskDetailDrawerProps) {
  const { engineers, loading: engLoading } = useFieldEngineers();
  const { currentUser } = useAuthStore();
  const { showToast }   = useToast();

  // ── Assignment state ──────────────────────────────────────────────────────
  const [selectedEngineerId, setSelectedEngineerId] = useState('');
  const [dueDateStr,         setDueDateStr]         = useState('');
  const [saving,             setSaving]             = useState(false);

  // ── Archive state ─────────────────────────────────────────────────────────
  const [archiveConfirm, setArchiveConfirm] = useState(false);
  const [archiving,      setArchiving]      = useState(false);

  // ── Lightbox ──────────────────────────────────────────────────────────────
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  // ── Submission history ────────────────────────────────────────────────────
  const [showHistory,    setShowHistory]    = useState(false);
  const [history,        setHistory]        = useState<HistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Tracks the assignedTo value captured when the drawer opened — used to
  // detect concurrent assignments before committing the transaction.
  const initialAssignedToRef = useRef<string | null>(null);

  // ── Reset when task changes ───────────────────────────────────────────────
  useEffect(() => {
    if (!task) return;
    setSelectedEngineerId(task.assignedTo ?? '');
    setDueDateStr(toDateInputValue(task.dueDate));
    setSaving(false);
    setArchiveConfirm(false);
    setArchiving(false);
    setLightboxUrl(null);
    setShowHistory(false);
    setHistory([]);
    initialAssignedToRef.current = task.assignedTo;
  }, [task?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── History listener (lazy — only when section is expanded) ──────────────
  useEffect(() => {
    if (!task?.id || !showHistory) return;

    setHistoryLoading(true);

    const q = query(
      collection(db, 'siteTasks', task.id, 'updates'),
      orderBy('submittedAt', 'desc'),
    );

    const unsubscribe = onSnapshot(
      q,
      (snap) => {
        const entries: HistoryEntry[] = snap.docs.map((d) => {
          const data = d.data();
          return {
            id:              d.id,
            submittedByName: data['submittedByName'] ?? data['submittedBy'] ?? 'Unknown',
            submittedAt:     data['submittedAt']?.toDate?.() ?? new Date(),
            status:          (data['status'] ?? 'pending') as TaskStatus,
            blockedReason:   data['blockedReason'] ?? null,
          };
        });
        setHistory(entries);
        setHistoryLoading(false);
      },
      (err) => {
        console.error('[SiteTaskDetailDrawer] history listener error:', err);
        setHistoryLoading(false);
      },
    );

    return () => unsubscribe();
  }, [task?.id, showHistory]);

  // ── isDirty ───────────────────────────────────────────────────────────────
  // True when an engineer is selected AND something has actually changed from
  // the values captured when the drawer opened.
  const originalEngineerId  = task?.assignedTo         ?? '';
  const originalDueDateStr  = toDateInputValue(task?.dueDate);
  const isDirty =
    selectedEngineerId !== '' &&
    (selectedEngineerId !== originalEngineerId || dueDateStr !== originalDueDateStr);

  // ── Save assignment ───────────────────────────────────────────────────────
  async function handleSaveAssignment() {
    if (!task || !selectedEngineerId || !currentUser) return;
    const engineer = engineers.find((e) => e.uid === selectedEngineerId);
    if (!engineer) return;

    setSaving(true);
    try {
      const taskRef = doc(db, 'siteTasks', task.id);

      await runTransaction(db, async (tx) => {
        const snap = await tx.get(taskRef);
        if (!snap.exists()) throw new Error('Task no longer exists');

        const current = snap.data();

        // Concurrent assignment guard: if someone else assigned this task
        // after we opened the drawer, and it's not to the same engineer we're
        // about to assign — abort to avoid silently overwriting their work.
        if (
          current['assignedTo'] &&
          current['assignedTo'] !== initialAssignedToRef.current &&
          current['assignedTo'] !== selectedEngineerId
        ) {
          throw new Error(
            `This task was just assigned to ${
              current['assignedToName'] ?? 'another engineer'
            }. Please close and reopen to refresh.`,
          );
        }

        const dueDate = dueDateStr ? new Date(dueDateStr + 'T00:00:00') : null;

        tx.update(taskRef, {
          assignedTo:     engineer.uid,
          assignedToName: engineer.displayName,
          assignedToCode: engineer.engineerCode ?? null,
          dueDate:        dueDate ? Timestamp.fromDate(dueDate) : null,
          updatedAt:      serverTimestamp(),
        });
      });

      // Keep ref in sync so a second save in the same session is safe.
      initialAssignedToRef.current = engineer.uid;

      // Audit log — non-critical, never blocks the success toast.
      try {
        await addDoc(collection(db, 'auditLog'), {
          timestamp:  serverTimestamp(),
          uid:        currentUser.uid,
          userName:   currentUser.name,
          action:     'ASSIGN_SITE_TASK',
          detail:     `Assigned ${task.taskCode} to ${engineer.displayName}`,
          siteTaskId: task.id,
          siteId:     task.siteId,
          projectId:  task.projectId,
        });
      } catch (auditErr) {
        console.warn('[SiteTaskDetailDrawer] auditLog failed:', auditErr);
      }

      showToast('Assignment saved', 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to save assignment';
      showToast(msg, 'error');
    } finally {
      setSaving(false);
    }
  }

  // ── Archive ───────────────────────────────────────────────────────────────
  async function handleArchive() {
    if (!task) return;
    setArchiving(true);
    try {
      await updateDoc(doc(db, 'siteTasks', task.id), {
        archived:   true,
        archivedAt: serverTimestamp(),
      });
      showToast('Task archived', 'success');
      onClose();
    } catch {
      showToast('Failed to archive task', 'error');
      setArchiving(false);
    }
  }

  // ── Guard ─────────────────────────────────────────────────────────────────
  // This drawer is admin-only. Field engineers use UpdateSiteTaskDrawer instead.
  // The guard is placed after all hook calls to comply with React's rules of hooks.
  if (!task) return null;
  if (currentUser?.role === 'field') return null;

  // Flatten all photos: completion photos first, then subtask photos
  const allPhotos: string[] = [
    ...task.completionPhotos,
    ...Object.values(task.subtaskPhotos).flat(),
  ];

  return (
    <>
      <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
        <SheetContent side="bottom" aria-describedby={undefined}>
          {/* ── Header ───────────────────────────────────────────────── */}
          <SheetHeader>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              {/* Colour stripe badge */}
              <div
                className="w-2.5 h-5 rounded-sm shrink-0"
                style={{ backgroundColor: task.taskColour }}
              />
              <span className="text-xs font-mono text-gray-400">{task.taskCode}</span>
              <span
                className={`text-xs font-medium px-2 py-0.5 rounded-full ${TASK_STATUS_BADGE[task.status]}`}
              >
                {TASK_STATUS_LABELS[task.status]}
              </span>
            </div>
            <SheetTitle className="mt-1">{task.taskLabel}</SheetTitle>
            <p className="text-xs text-gray-500 mt-0.5">
              {task.siteName} · {task.projectName}
            </p>
          </SheetHeader>

          <div className="p-5 pt-4 flex flex-col gap-5 overflow-y-auto max-h-[70vh]">

            {/* ── Assignment ───────────────────────────────────────────── */}
            {/* Hidden in readOnly mode (Recent Activity context) */}
            {!readOnly && (
            <section>
              <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
                Assignment
              </h4>

              {/*
               * When the engineers list is empty AND not loading, the user
               * store isn't populated — this is a field-engineer session where
               * UsersListener doesn't run.  Show a read-only summary instead
               * of an empty dropdown.
               */}
              {!engLoading && engineers.length === 0 ? (
                <div className="flex flex-col gap-2">
                  <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2.5">
                    <p className="text-sm text-gray-800 font-medium">
                      {task.assignedToName ?? 'Unassigned'}
                      {task.assignedToCode && (
                        <span className="text-xs text-gray-500 ml-1.5 font-normal">
                          ({task.assignedToCode})
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5">Assigned engineer</p>
                  </div>
                  {task.dueDate && (
                    <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2.5">
                      <p className="text-sm text-gray-800 font-medium">
                        {task.dueDate.toLocaleDateString('en-GB', {
                          day: '2-digit', month: 'short', year: 'numeric',
                        })}
                      </p>
                      <p className="text-xs text-gray-400 mt-0.5">Due date</p>
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="stdd-engineer">Engineer</Label>
                    {engLoading ? (
                      <Skeleton className="h-9 rounded-md" />
                    ) : (
                      <Select
                        value={selectedEngineerId}
                        onValueChange={setSelectedEngineerId}
                      >
                        <SelectTrigger id="stdd-engineer">
                          <SelectValue placeholder="Select engineer…" />
                        </SelectTrigger>
                        <SelectContent>
                          {engineers.map((e) => (
                            <SelectItem key={e.uid} value={e.uid}>
                              {e.displayName}
                              {e.engineerCode ? ` (${e.engineerCode})` : ''}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="stdd-duedate">
                      Due Date{' '}
                      <span className="text-gray-400 font-normal text-xs">(optional)</span>
                    </Label>
                    <input
                      id="stdd-duedate"
                      type="date"
                      value={dueDateStr}
                      onChange={(e) => setDueDateStr(e.target.value)}
                      className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    />
                  </div>

                  <Button
                    onClick={handleSaveAssignment}
                    disabled={!isDirty || saving || engLoading}
                    className="bg-brand-blue hover:bg-brand-navy text-white self-end"
                    size="sm"
                  >
                    {saving ? 'Saving…' : 'Save Assignment'}
                  </Button>
                </div>
              )}
            </section>
            )}

            {/* ── Checklist ────────────────────────────────────────────── */}
            {task.subtasks.length > 0 && (
              <section>
                <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
                  Checklist
                </h4>
                <div className="flex flex-col">
                  {task.subtasks.map((sub) => {
                    const answer = task.subtaskAnswers[sub.subtaskId];
                    return (
                      <div
                        key={sub.subtaskId}
                        className="flex items-start justify-between gap-3 py-2.5 border-b border-gray-100 last:border-0"
                      >
                        <span className="text-xs text-gray-600 leading-snug flex-1">
                          {sub.label}
                          {sub.isRequired && (
                            <span className="text-red-400 ml-0.5">*</span>
                          )}
                        </span>
                        <span className="text-xs font-medium text-gray-800 text-right shrink-0 max-w-[45%]">
                          {answer?.value || <span className="text-gray-300">—</span>}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {/* ── Photos ───────────────────────────────────────────────── */}
            {allPhotos.length > 0 && (
              <section>
                <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
                  Photos
                </h4>
                <div className="grid grid-cols-3 gap-2">
                  {allPhotos.map((url, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setLightboxUrl(url)}
                      className="aspect-square rounded-lg overflow-hidden border border-gray-200 hover:border-brand-blue transition-colors"
                    >
                      <img
                        src={url}
                        alt={`Photo ${i + 1}`}
                        className="w-full h-full object-cover"
                      />
                    </button>
                  ))}
                </div>
              </section>
            )}

            {/* ── GPS ──────────────────────────────────────────────────── */}
            <section>
              <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                GPS Location
              </h4>
              {task.location ? (
                <a
                  href={`https://www.google.com/maps?q=${task.location.lat},${task.location.lng}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: '#00B4D8' }}
                  className="text-sm hover:underline flex items-center gap-1"
                >
                  <MapPin className="h-3.5 w-3.5 shrink-0" />
                  {task.location.lat.toFixed(5)}, {task.location.lng.toFixed(5)}
                </a>
              ) : (
                <p className="text-xs text-gray-400">Not captured yet</p>
              )}
            </section>

            {/* ── Submission History ────────────────────────────────────── */}
            <section>
              <button
                type="button"
                className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 uppercase tracking-wide w-full"
                onClick={() => setShowHistory((v) => !v)}
              >
                Submission History
                {showHistory
                  ? <ChevronUp   className="h-3.5 w-3.5" />
                  : <ChevronDown className="h-3.5 w-3.5" />
                }
              </button>

              {showHistory && (
                <div className="mt-3">
                  {historyLoading ? (
                    <div className="flex flex-col gap-2">
                      {[...Array(2)].map((_, i) => (
                        <Skeleton key={i} className="h-14 rounded-lg" />
                      ))}
                    </div>
                  ) : history.length === 0 ? (
                    <p className="text-xs text-gray-400 py-2">No submissions yet</p>
                  ) : (
                    <div className="flex flex-col gap-2">
                      {history.map((entry) => (
                        <div
                          key={entry.id}
                          className="rounded-lg border border-gray-100 p-3"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-medium text-gray-800">
                              {entry.submittedByName}
                            </span>
                            <span
                              className={`text-xs font-medium px-2 py-0.5 rounded-full ${TASK_STATUS_BADGE[entry.status]}`}
                            >
                              {TASK_STATUS_LABELS[entry.status]}
                            </span>
                          </div>
                          <p className="text-xs text-gray-400 mt-1">
                            {formatDateTime(entry.submittedAt)}
                          </p>
                          {entry.blockedReason && (
                            <p className="text-xs text-red-500 mt-1 leading-snug">
                              {entry.blockedReason}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </section>

            {/* ── Archive — hidden in readOnly mode ────────────────────── */}
            {!readOnly && (
            <div className="flex justify-end pt-1 pb-2">
              {archiveConfirm ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500">Archive this task?</span>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs"
                    onClick={() => setArchiveConfirm(false)}
                    disabled={archiving}
                  >
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    className="bg-red-500 hover:bg-red-600 text-white text-xs"
                    onClick={handleArchive}
                    disabled={archiving}
                  >
                    {archiving ? 'Archiving…' : 'Confirm'}
                  </Button>
                </div>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 text-xs text-gray-500 border-gray-200 hover:border-red-200 hover:text-red-500"
                  onClick={() => setArchiveConfirm(true)}
                >
                  <Archive className="h-3.5 w-3.5" />
                  Archive Task
                </Button>
              )}
            </div>
            )}

          </div>
        </SheetContent>
      </Sheet>

      {/* ── Lightbox ─────────────────────────────────────────────────────── */}
      {lightboxUrl && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80"
          onClick={() => setLightboxUrl(null)}
        >
          <button
            type="button"
            aria-label="Close photo"
            className="absolute top-4 right-4 text-white bg-black/40 rounded-full p-1.5 hover:bg-black/60 transition-colors"
            onClick={() => setLightboxUrl(null)}
          >
            <X className="h-5 w-5" />
          </button>
          <img
            src={lightboxUrl}
            alt="Full size"
            className="max-w-[95vw] max-h-[90vh] object-contain rounded-lg"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </>
  );
}
