import { useState, useEffect, useRef } from 'react';
import { MapPin } from 'lucide-react';
import { useTaskActions } from '@/hooks/useTaskActions';
import { useTaskMaster } from '@/hooks/useTaskMaster';
import { useToast } from '@/components/ui/toast';
import { useNetworkStatus } from '@/hooks/useNetworkStatus';
import { useOfflineQueue } from '@/hooks/useOfflineQueue';
import { useAuthStore } from '@/store/authStore';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ChecklistItem } from './checklist/ChecklistItem';
import { PhotoZone } from '@/components/photos/PhotoZone';
import { cn } from '@/lib/utils';
import type { Task, TaskStatus, CollectionType } from '@/types';

interface UpdateTaskDrawerProps {
  task: Task;
  open: boolean;
  onClose: () => void;
}

const UPDATE_STATUSES: { key: TaskStatus; label: string }[] = [
  { key: 'in_progress', label: 'In Progress' },
  { key: 'completed',   label: 'Completed' },
  { key: 'blocked',     label: 'Blocked' },
];

export function UpdateTaskDrawer({ task, open, onClose }: UpdateTaskDrawerProps) {
  const { submitTaskUpdate } = useTaskActions();
  const { getTaskType }      = useTaskMaster();
  const { showToast, ToastComponent } = useToast();
  const isOnline             = useNetworkStatus();
  const { enqueue }          = useOfflineQueue();
  const { currentUser }      = useAuthStore();

  // Status selector — default to current if valid, else in_progress
  const validStatuses: TaskStatus[] = ['in_progress', 'completed', 'blocked'];
  const defaultStatus: TaskStatus = validStatuses.includes(task.status)
    ? task.status
    : 'in_progress';

  const [status, setStatus]               = useState<TaskStatus>(defaultStatus);
  const [blockedReason, setBlockedReason] = useState('');
  const [answers, setAnswers]             = useState<Record<string, string>>({});
  const [showErrors, setShowErrors]       = useState(false);
  const [blockedError, setBlockedError]   = useState(false);
  const [submitting, setSubmitting]       = useState(false);

  // geo / geoError — drive the location bar UI
  const [geo,      setGeo]      = useState<{ lat: number; lng: number } | null>(null);
  const [geoError, setGeoError] = useState<string | null>(null);

  // latestGeoRef — updated synchronously in the GPS callback so waitForGeo()
  // always sees the most recent coords even if React hasn't re-rendered yet.
  const latestGeoRef = useRef<{ lat: number; lng: number } | null>(null);

  // geoResolveRef — holds the resolve fn of the promise created by waitForGeo()
  // so the GPS callback can resolve it from outside React's render cycle.
  const geoResolveRef = useRef<((coords: { lat: number; lng: number } | null) => void) | null>(null);

  // Per-subtask photos: keyed by subtaskId — only populated for imageRequired subtasks
  const [subtaskPhotos, setSubtaskPhotos]       = useState<Record<string, string[]>>({});
  // Completion photos — required when marking a task as Completed
  const [completionPhotos, setCompletionPhotos] = useState<string[]>([]);
  const firstErrorRef = useRef<HTMLDivElement>(null);

  // ── Pre-populate answers from existing task data ────────────────────────────
  useEffect(() => {
    if (!open) return;
    const pre: Record<string, string> = {};
    for (const [k, v] of Object.entries(task.subtaskAnswers ?? {})) {
      pre[k] = v.value;
    }
    setAnswers(pre);
    setBlockedReason('');
    setShowErrors(false);
    setBlockedError(false);
    setStatus(defaultStatus);
    setSubtaskPhotos(task.subtaskPhotos ?? {});
    setCompletionPhotos(task.completionPhotos ?? []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, task.id]);

  // ── Geolocation on open ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return;

    // Reset all geo state on each open
    setGeo(null);
    setGeoError(null);
    latestGeoRef.current  = null;
    geoResolveRef.current = null;

    if (!window.isSecureContext) {
      setGeoError('Location requires HTTPS. Use localhost or deploy to test on mobile.');
      return;
    }
    if (!navigator.geolocation) {
      setGeoError('GPS not supported on this device.');
      return;
    }

    async function requestGeo() {
      if (navigator.permissions) {
        try {
          const perm = await navigator.permissions.query({ name: 'geolocation' });
          if (perm.state === 'denied') {
            const msg = 'Location blocked. Enable in browser/device settings.';
            setGeoError(msg);
            geoResolveRef.current?.(null);
            geoResolveRef.current = null;
            return;
          }
        } catch {
          // Permissions API unavailable — proceed
        }
      }

      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          // Update ref synchronously BEFORE state (avoids render-cycle race in waitForGeo)
          latestGeoRef.current = coords;
          setGeo(coords);
          setGeoError(null);
          // Resolve any pending waitForGeo() promise
          if (geoResolveRef.current) {
            geoResolveRef.current(coords);
            geoResolveRef.current = null;
          }
        },
        (err) => {
          console.warn('[Geolocation] error:', err.code, err.message);
          let msg = 'Could not get location.';
          if (err.code === 1) msg = 'Location permission denied. Enable in device settings.';
          if (err.code === 3) msg = 'Location timed out. Move to open area and try again.';
          setGeoError(msg);
          // Resolve pending waitForGeo() with null so submit is not blocked
          if (geoResolveRef.current) {
            geoResolveRef.current(null);
            geoResolveRef.current = null;
          }
        },
        {
          // FIX 2: enableHighAccuracy:false uses WiFi/cell — resolves in < 1 s.
          // true waits for satellite lock (10-30 s indoors — too slow).
          enableHighAccuracy: false,
          timeout:    8000,    // 8 s max before TIMEOUT error
          maximumAge: 120000,  // accept a cached position up to 2 minutes old
        },
      );
    }

    requestGeo();
  }, [open]);

  // ── waitForGeo ──────────────────────────────────────────────────────────────
  // If GPS already resolved, returns immediately. Otherwise waits up to 5 s,
  // then proceeds without location rather than blocking the submission.
  async function waitForGeo(): Promise<{ lat: number; lng: number } | null> {
    // Check the ref first (synchronous, never stale)
    if (latestGeoRef.current) return latestGeoRef.current;
    // If GPS already failed, don't wait
    if (geoError) return null;

    return new Promise<{ lat: number; lng: number } | null>((resolve) => {
      geoResolveRef.current = resolve;
      // 5-second safety timeout — never block a submission indefinitely
      setTimeout(() => {
        if (geoResolveRef.current) {
          geoResolveRef.current(null);
          geoResolveRef.current = null;
        }
      }, 5000);
    });
  }

  // ── Task type / subtasks ────────────────────────────────────────────────────
  const taskType = getTaskType(task.type);
  const subtasks = taskType
    ? [...taskType.subtasks].sort((a, b) => a.sortOrder - b.sortOrder)
    : [];

  function handleAnswerChange(subtaskId: string, value: string) {
    setAnswers((prev) => ({ ...prev, [subtaskId]: value }));
  }

  // ── handleSubmit ────────────────────────────────────────────────────────────
  async function handleSubmit() {
    let valid = true;

    if (status === 'blocked' && !blockedReason.trim()) {
      setBlockedError(true);
      showToast('Please enter a blocked reason', 'error');
      valid = false;
    } else {
      setBlockedError(false);
    }

    if (status === 'completed') {
      const missingRequired = subtasks.some(
        (s) => s.isRequired &&
          s.collectionType !== 'image_only' &&
          !answers[s.subtaskId]?.trim()
      );
      if (missingRequired) {
        setShowErrors(true);
        showToast('Please complete all required checklist items', 'error');
        valid = false;
        setTimeout(() => firstErrorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 100);
      }

      const missingSubtaskPhoto = subtasks.find(
        (s) => s.imageRequired && !(subtaskPhotos[s.subtaskId]?.length >= 1)
      );
      if (missingSubtaskPhoto) {
        showToast(`Please add a photo for: ${missingSubtaskPhoto.label}`, 'error');
        valid = false;
      }
      if (completionPhotos.length === 0) {
        showToast('Please add at least one completion photo', 'error');
        valid = false;
      }
    }

    if (!valid) return;

    // FIX 1: set submitting BEFORE awaiting GPS so the button disables immediately
    // and shows "Getting location…" while we wait.
    setSubmitting(true);
    try {
      // Wait up to 5 s for GPS; proceed with null if unavailable
      const location = await waitForGeo();

      // Build subtaskAnswers map
      const subtaskAnswers: Record<string, { value: string; type: CollectionType }> = {};
      for (const s of subtasks) {
        const val = answers[s.subtaskId];
        if (val !== undefined && val !== '') {
          subtaskAnswers[s.subtaskId] = { value: val, type: s.collectionType };
        }
      }

      const payload = {
        status,
        blockedReason:    status === 'blocked' ? blockedReason.trim() : null,
        subtaskAnswers,
        subtaskPhotos,
        completionPhotos,
        location,
        projectId:        task.projectId ?? undefined,
        title:            task.title,
        type:             task.type,
        siteCode:         task.siteCode ?? '',
      };

      if (!isOnline) {
        await enqueue({
          taskId:     task.id,
          taskNum:    task.taskNum,
          userId:     currentUser?.uid ?? '',
          payload,
          enqueuedAt: Date.now(),
        });
        showToast('Saved offline — will sync when connected', 'warning');
        onClose();
        return;
      }

      await submitTaskUpdate(task.id, task.taskNum, payload);
      showToast('Task updated successfully', 'success');
      onClose();
    } catch {
      showToast('Failed to submit. Try again.', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <>
      {ToastComponent}
      <Sheet open={open} onOpenChange={(o) => { if (!o && !submitting) onClose(); }}>
        <SheetContent side="bottom" className="flex flex-col" aria-describedby={undefined}>
          {/* Header */}
          <SheetHeader className="mb-0">
            <p className="text-xs text-gray-400 font-mono">{task.taskNum}</p>
            <SheetTitle className="leading-snug pr-8">{task.title}</SheetTitle>
          </SheetHeader>

          {/* Scrollable body */}
          <div className="flex-1 overflow-y-auto px-5 pb-4 flex flex-col gap-5 mt-4">
            {/* Location bar */}
            <div className="flex items-center gap-2 text-xs rounded-lg bg-gray-50 px-3 py-2">
              <MapPin className="h-3.5 w-3.5 shrink-0" />
              {geo ? (
                <span className="text-green-600 font-medium">
                  {geo.lat.toFixed(4)}, {geo.lng.toFixed(4)}
                </span>
              ) : geoError ? (
                <span className="text-amber-600">{geoError}</span>
              ) : (
                <span className="text-gray-400">Fetching location…</span>
              )}
            </div>

            {/* Status selector */}
            <div>
              <p className="text-sm font-semibold text-gray-700 mb-2">Status</p>
              <div className="flex gap-2">
                {UPDATE_STATUSES.map(({ key, label }) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setStatus(key)}
                    className={cn(
                      'flex-1 rounded-md border px-2 py-2 text-sm font-medium transition-colors',
                      status === key
                        ? 'bg-brand-blue text-white border-brand-blue'
                        : 'border-gray-200 bg-white text-gray-700 hover:bg-blue-50'
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Blocked reason */}
            {status === 'blocked' && (
              <div>
                <p className="text-sm font-semibold text-gray-700 mb-1">
                  Blocked Reason <span className="text-brand-red">*</span>
                </p>
                <Textarea
                  value={blockedReason}
                  onChange={(e) => setBlockedReason(e.target.value)}
                  placeholder="Describe what is blocking this task…"
                  className={blockedError ? 'border-brand-red focus-visible:ring-brand-red' : ''}
                  rows={3}
                />
                {blockedError && (
                  <p className="mt-1 text-xs text-brand-red">Blocked reason is required</p>
                )}
              </div>
            )}

            {/* Checklist */}
            {subtasks.length > 0 && (
              <div>
                <p className="text-sm font-semibold text-gray-700 mb-2">Checklist</p>
                <div className="flex flex-col gap-2">
                  {subtasks.map((s, i) => {
                    const isError =
                      showErrors && s.isRequired &&
                      s.collectionType !== 'image_only' &&
                      !answers[s.subtaskId]?.trim();
                    return (
                      <div key={s.subtaskId} ref={isError && i === subtasks.findIndex(
                        (x) => showErrors && x.isRequired &&
                          x.collectionType !== 'image_only' &&
                          !answers[x.subtaskId]?.trim()
                      ) ? firstErrorRef : undefined}>
                        <ChecklistItem
                          subtask={s}
                          answer={answers[s.subtaskId] ?? null}
                          onAnswerChange={handleAnswerChange}
                          showError={showErrors}
                        />
                        {s.imageRequired && (
                          <div className="mt-2">
                            <PhotoZone
                              label={`Photo for: ${s.label}`}
                              photos={subtaskPhotos[s.subtaskId] ?? []}
                              onPhotosChange={(urls) =>
                                setSubtaskPhotos((prev) => ({
                                  ...prev,
                                  [s.subtaskId]: urls,
                                }))
                              }
                              required={true}
                              disabled={submitting}
                              taskNum={task.taskNum}
                              taskId={task.id}
                              subtaskId={s.subtaskId}
                              photoType="subtask"
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Completion photos */}
            <div>
              <p className="text-sm font-medium mb-2">
                Proof of Work Photos
                <span className="text-red-500 ml-1">*</span>
              </p>
              <p className="text-xs text-gray-500 mb-3">
                Required when marking task as Completed
              </p>
              <PhotoZone
                label="Completion Photos"
                photos={completionPhotos}
                onPhotosChange={setCompletionPhotos}
                required={status === 'completed'}
                disabled={submitting}
                taskNum={task.taskNum}
                taskId={task.id}
                photoType="completion"
              />
            </div>
          </div>

          {/* Submit */}
          <div className="px-5 pb-6 pt-2 border-t border-gray-100">
            <Button
              className="w-full"
              onClick={handleSubmit}
              disabled={submitting}
            >
              {submitting ? (
                <span className="flex items-center gap-2">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  {!geo && !geoError ? 'Getting location…' : 'Submitting…'}
                </span>
              ) : (
                'Submit Update'
              )}
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
