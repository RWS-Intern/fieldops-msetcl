import { useState, useEffect } from 'react';
import {
  collection,
  query,
  orderBy,
  getDocs,
  doc,
  getDoc,
} from 'firebase/firestore';
import { ExternalLink, X, Archive } from 'lucide-react';
import { db } from '@/firebase/config';
import { useTaskMaster } from '@/hooks/useTaskMaster';
import { useAuthStore } from '@/store/authStore';
import { useToast } from '@/components/ui/toast';
import { archiveTask } from '@/hooks/useTaskActions';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { isOverdue, formatDate, formatDateTime, getStatusColour, getStatusLabel } from '@/lib/taskUtils';
import type { Task, TaskUpdate } from '@/types';

interface TaskDetailDrawerProps {
  task: Task;
  open: boolean;
  onClose: () => void;
}

const ANSWER_COLOUR: Record<string, string> = {
  yes: 'text-green-600',
  no:  'text-brand-red',
  na:  'text-gray-400',
};

function StatusBadge({ status }: { status: string }) {
  const colour = getStatusColour(status as Parameters<typeof getStatusColour>[0]);
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold text-white"
      style={{ backgroundColor: colour }}
    >
      {getStatusLabel(status as Parameters<typeof getStatusLabel>[0])}
    </span>
  );
}

function MetaRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-1.5 border-b border-gray-50 last:border-0">
      <span className="text-xs text-gray-500 shrink-0">{label}</span>
      <span className="text-xs text-gray-800 text-right">{value}</span>
    </div>
  );
}

export function TaskDetailDrawer({ task, open, onClose }: TaskDetailDrawerProps) {
  const { getTaskType }  = useTaskMaster();
  const { currentUser }  = useAuthStore();
  const { showToast }    = useToast();

  const [updates, setUpdates]                     = useState<TaskUpdate[]>([]);
  const [loadingUpdates, setLoadingUpdates]       = useState(false);
  const [createdByName, setCreatedByName]         = useState<string>('—');
  const [lightboxUrl, setLightboxUrl]             = useState<string | null>(null);
  // Archive confirmation state
  const [archiveConfirm, setArchiveConfirm]       = useState(false);
  const [archiving, setArchiving]                 = useState(false);

  const taskType = getTaskType(task.type);
  const overdue = isOverdue(task);

  // Load submission history and creator name on open
  useEffect(() => {
    if (!open) return;
    setArchiveConfirm(false);

    // Creator name
    async function loadCreator() {
      try {
        const snap = await getDoc(doc(db, 'users', task.createdBy));
        if (snap.exists()) setCreatedByName(snap.data()['name'] ?? '—');
      } catch { /* non-critical */ }
    }
    loadCreator();

    // Submission history
    setLoadingUpdates(true);
    async function loadUpdates() {
      try {
        const q = query(
          collection(db, 'tasks', task.id, 'updates'),
          orderBy('submittedAt', 'desc')
        );
        const snap = await getDocs(q);
        const loaded: TaskUpdate[] = snap.docs.map((d) => {
          const data = d.data();
          return {
            id:              d.id,
            submittedBy:     data['submittedBy'],
            submittedByName: data['submittedByName'],
            submittedAt:     data['submittedAt']?.toDate?.() ?? new Date(),
            status:          data['status'],
            location:        data['location'] ?? null,
            blockedReason:   data['blockedReason'] ?? null,
            subtaskAnswers:  data['subtaskAnswers'] ?? {},
            subtaskPhotos:   data['subtaskPhotos'] ?? {},
            completionPhotos: data['completionPhotos'] ?? [],
          };
        });
        setUpdates(loaded);
      } catch {
        setUpdates([]);
      } finally {
        setLoadingUpdates(false);
      }
    }
    loadUpdates();
  }, [open, task.id, task.createdBy]);

  const subtasks = taskType
    ? [...taskType.subtasks].sort((a, b) => a.sortOrder - b.sortOrder)
    : [];

  const hasAnswers = Object.keys(task.subtaskAnswers ?? {}).length > 0;

  async function handleArchive() {
    setArchiving(true);
    try {
      await archiveTask(task.id, true);
      showToast('Task archived', 'success');
      onClose();
    } catch {
      showToast('Failed to archive task', 'error');
    } finally {
      setArchiving(false);
    }
  }

  return (
    <>
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="flex flex-col w-full md:max-w-[480px]" aria-describedby={undefined}>
        {/* Header */}
        <SheetHeader className="pb-3 border-b border-gray-100">
          <p className="text-xs font-mono text-gray-400">{task.taskNum}</p>
          <SheetTitle className="pr-8 leading-snug">{task.title}</SheetTitle>
          <div className="mt-1">
            <StatusBadge status={task.status} />
          </div>
        </SheetHeader>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-5">

          {/* Metadata grid */}
          <div className="rounded-lg border border-gray-100 bg-white p-3">
            <MetaRow
              label="Type"
              value={taskType?.typeLabel ?? task.type}
            />
            <MetaRow label="Site Code" value={task.siteCode || '—'} />
            <MetaRow label="Assigned To" value={task.assignedToName} />
            <MetaRow label="Created By" value={createdByName} />
            <MetaRow label="Start Date" value={formatDate(task.startDate)} />
            <MetaRow
              label="Due Date"
              value={
                <span className={overdue ? 'text-brand-red font-semibold' : ''}>
                  {formatDate(task.dueDate)}
                  {overdue && ' · Overdue'}
                </span>
              }
            />
            <MetaRow label="Created At" value={formatDateTime(task.createdAt)} />
          </div>

          {/* Description */}
          {task.description && (
            <div className="rounded-lg border border-gray-100 bg-white p-3">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
                Description
              </p>
              <p className="text-sm text-gray-800 leading-relaxed">{task.description}</p>
            </div>
          )}

          {/* Blocked reason */}
          {task.status === 'blocked' && task.blockedReason && (
            <div className="rounded-lg bg-red-50 border border-red-100 p-3">
              <p className="text-xs font-semibold text-brand-red mb-1">Blocked Reason</p>
              <p className="text-sm text-gray-800">{task.blockedReason}</p>
            </div>
          )}

          {/* GPS location */}
          {task.location && (
            <div className="rounded-lg border border-gray-100 bg-white p-3">
              <p className="text-xs font-semibold text-gray-500 mb-1">Last Known Location</p>
              <p className="text-sm text-gray-800 mb-1">
                {task.location.lat.toFixed(5)}, {task.location.lng.toFixed(5)}
              </p>
              <a
                href={`https://maps.google.com/?q=${task.location.lat},${task.location.lng}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-brand-blue hover:underline"
              >
                Open in Maps
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          )}

          {/* Subtask answers */}
          <div>
            <p className="text-sm font-semibold text-gray-700 mb-2">Checklist Answers</p>
            {!hasAnswers ? (
              <p className="text-xs text-gray-400">No answers submitted yet.</p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {subtasks.map((s) => {
                  const answer = task.subtaskAnswers[s.subtaskId];
                  const photos = task.subtaskPhotos?.[s.subtaskId] ?? [];
                  return (
                    <div
                      key={s.subtaskId}
                      className="py-1.5 border-b border-gray-50 last:border-0"
                    >
                      <div className="flex justify-between items-start gap-3">
                        <span className="text-xs text-gray-600">{s.label}</span>
                        <div className="text-right shrink-0">
                          {answer ? (
                            <span
                              className={`text-xs font-medium ${
                                s.collectionType === 'yesno'
                                  ? ANSWER_COLOUR[answer.value] ?? 'text-gray-700'
                                  : 'text-brand-navy'
                              }`}
                            >
                              {answer.value}
                            </span>
                          ) : (
                            <span className="text-xs text-gray-300">—</span>
                          )}
                        </div>
                      </div>
                      {photos.length > 0 && (
                        <div className="grid grid-cols-3 gap-1 mt-2">
                          {photos.map((url, i) => (
                            <img
                              key={i}
                              src={url}
                              alt={`Photo ${i + 1}`}
                              className="rounded aspect-square object-cover cursor-pointer w-full hover:opacity-90 transition-opacity"
                              onClick={() => setLightboxUrl(url)}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Proof of Work Photos */}
          <div>
            <p className="text-sm font-semibold text-gray-700 mb-2">Proof of Work Photos</p>
            {(task.completionPhotos ?? []).length === 0 ? (
              <p className="text-xs text-gray-400">No completion photos submitted.</p>
            ) : (
              <div className="grid grid-cols-3 gap-1">
                {task.completionPhotos.map((url, i) => (
                  <img
                    key={i}
                    src={url}
                    alt={`Completion photo ${i + 1}`}
                    className="rounded aspect-square object-cover cursor-pointer w-full hover:opacity-90 transition-opacity"
                    onClick={() => setLightboxUrl(url)}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Submission history */}
          <div>
            <p className="text-sm font-semibold text-gray-700 mb-2">Submission History</p>
            {loadingUpdates ? (
              <div className="flex flex-col gap-2">
                <Skeleton className="h-14 rounded-lg" />
                <Skeleton className="h-14 rounded-lg" />
              </div>
            ) : updates.length === 0 ? (
              <p className="text-xs text-gray-400">No submissions yet.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {updates.map((u) => (
                  <div
                    key={u.id}
                    className="rounded-lg border border-gray-100 bg-white p-3 flex flex-col gap-1.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-gray-800">
                        {u.submittedByName}
                      </span>
                      <StatusBadge status={u.status} />
                    </div>
                    <span className="text-xs text-gray-400">
                      {formatDateTime(u.submittedAt)}
                    </span>
                    {u.blockedReason && (
                      <p className="text-xs text-brand-red bg-red-50 rounded px-2 py-1">
                        {u.blockedReason}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── Footer: admin archive action ── */}
        {currentUser?.role === 'admin' && (
          <div className="px-5 pb-5 pt-3 border-t border-gray-100 shrink-0">
            {!archiveConfirm ? (
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 text-gray-500 hover:text-gray-700"
                onClick={() => setArchiveConfirm(true)}
              >
                <Archive className="h-3.5 w-3.5" />
                Archive Task
              </Button>
            ) : (
              <div className="flex flex-col gap-2">
                <p className="text-xs text-gray-600">
                  Archive this task? It will be hidden from all task lists but data is
                  preserved. You can restore it from the archived view.
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={() => setArchiveConfirm(false)}
                    disabled={archiving}
                  >
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    className="flex-1 bg-gray-600 hover:bg-gray-700"
                    onClick={handleArchive}
                    disabled={archiving}
                  >
                    {archiving ? 'Archiving…' : 'Archive'}
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>

    {/* ── Lightbox ── */}
    {lightboxUrl && (
      <div
        className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80"
        onClick={() => setLightboxUrl(null)}
      >
        <button
          type="button"
          className="absolute right-4 top-4 rounded-full bg-black/40 p-2 text-white transition-colors hover:bg-black/60"
          onClick={(e) => { e.stopPropagation(); setLightboxUrl(null); }}
          aria-label="Close photo"
        >
          <X className="h-5 w-5" />
        </button>
        <img
          src={lightboxUrl}
          alt="Full size"
          className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain"
          onClick={(e) => e.stopPropagation()}
        />
      </div>
    )}
    </>
  );
}
