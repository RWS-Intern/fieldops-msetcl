import { useState, useEffect, useRef } from 'react';
import { MapPin } from 'lucide-react';
import { useSiteTaskActions } from '@/hooks/useSiteTaskActions';
import { useToast }           from '@/components/ui/toast';
import { useNetworkStatus }   from '@/hooks/useNetworkStatus';
import { useAuthStore }       from '@/store/authStore';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button }       from '@/components/ui/button';
import { Textarea }     from '@/components/ui/textarea';
import { ChecklistItem } from '@/components/tasks/checklist/ChecklistItem';
import { PhotoZone }    from '@/components/photos/PhotoZone';
import { cn }           from '@/lib/utils';
import type { SiteTask, TaskStatus, CollectionType } from '@/types';

// ─── Constants ────────────────────────────────────────────────────────────────

const UPDATE_STATUSES: { key: TaskStatus; label: string }[] = [
  { key: 'in_progress', label: 'In Progress' },
  { key: 'completed',   label: 'Completed'   },
  { key: 'blocked',     label: 'Blocked'     },
];

// ─── Props ────────────────────────────────────────────────────────────────────

interface UpdateSiteTaskDrawerProps {
  task:    SiteTask;
  open:    boolean;
  onClose: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function UpdateSiteTaskDrawer({
  task,
  open,
  onClose,
}: UpdateSiteTaskDrawerProps) {
  const { submitSiteTaskUpdate }         = useSiteTaskActions();
  const { showToast, ToastComponent }    = useToast();
  const isOnline                         = useNetworkStatus();
  const { currentUser }                  = useAuthStore();

  // Subtasks are embedded directly on the SiteTask (snapshot of project template
  // at creation time) — no taskMaster lookup needed.
  const subtasks = [...(task.subtasks ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);

  // Default status: keep current if it's an actionable status, else start at in_progress
  const validStatuses: TaskStatus[] = ['in_progress', 'completed', 'blocked'];
  const defaultStatus: TaskStatus = validStatuses.includes(task.status)
    ? task.status
    : 'in_progress';

  const [status,         setStatus]         = useState<TaskStatus>(defaultStatus);
  const [blockedReason,  setBlockedReason]  = useState('');
  const [answers,        setAnswers]        = useState<Record<string, string>>({});
  const [showErrors,     setShowErrors]     = useState(false);
  const [blockedError,   setBlockedError]   = useState(false);
  const [submitting,     setSubmitting]     = useState(false);

  // ── Geolocation ──────────────────────────────────────────────────────────────
  const [geo,      setGeo]      = useState<{ lat: number; lng: number } | null>(null);
  const [geoError, setGeoError] = useState<string | null>(null);

  // Ref stays in sync with GPS callback, avoiding React render-cycle race
  const latestGeoRef  = useRef<{ lat: number; lng: number } | null>(null);
  // Holds the resolve fn for the waitForGeo() promise
  const geoResolveRef = useRef<((coords: { lat: number; lng: number } | null) => void) | null>(null);

  // ── Per-subtask + completion photos ──────────────────────────────────────────
  const [subtaskPhotos,    setSubtaskPhotos]    = useState<Record<string, string[]>>({});
  const [completionPhotos, setCompletionPhotos] = useState<string[]>([]);

  const firstErrorRef = useRef<HTMLDivElement>(null);

  // ── Reset state when a new task opens ─────────────────────────────────────
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
        } catch { /* Permissions API unavailable — proceed */ }
      }

      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          latestGeoRef.current = coords;
          setGeo(coords);
          setGeoError(null);
          if (geoResolveRef.current) {
            geoResolveRef.current(coords);
            geoResolveRef.current = null;
          }
        },
        (err) => {
          console.warn('[UpdateSiteTaskDrawer] geolocation error:', err.code, err.message);
          let msg = 'Could not get location.';
          if (err.code === 1) msg = 'Location permission denied. Enable in device settings.';
          if (err.code === 3) msg = 'Location timed out. Move to open area and try again.';
          setGeoError(msg);
          if (geoResolveRef.current) {
            geoResolveRef.current(null);
            geoResolveRef.current = null;
          }
        },
        { enableHighAccuracy: false, timeout: 8000, maximumAge: 120000 },
      );
    }

    requestGeo();
  }, [open]);

  // ── waitForGeo ──────────────────────────────────────────────────────────────
  async function waitForGeo(): Promise<{ lat: number; lng: number } | null> {
    if (latestGeoRef.current) return latestGeoRef.current;
    if (geoError) return null;
    return new Promise<{ lat: number; lng: number } | null>((resolve) => {
      geoResolveRef.current = resolve;
      setTimeout(() => {
        if (geoResolveRef.current) {
          geoResolveRef.current(null);
          geoResolveRef.current = null;
        }
      }, 5000);
    });
  }

  // ── handleAnswerChange ──────────────────────────────────────────────────────
  function handleAnswerChange(subtaskId: string, value: string) {
    setAnswers((prev) => ({ ...prev, [subtaskId]: value }));
  }

  // ── handleSubmit ────────────────────────────────────────────────────────────
  async function handleSubmit() {
    if (!currentUser) return;

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
        (s) =>
          s.isRequired &&
          s.collectionType !== 'image_only' &&
          !answers[s.subtaskId]?.trim(),
      );
      if (missingRequired) {
        setShowErrors(true);
        showToast('Please complete all required checklist items', 'error');
        valid = false;
        setTimeout(
          () => firstErrorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }),
          100,
        );
      }

      const missingSubtaskPhoto = subtasks.find(
        (s) => s.imageRequired && !(subtaskPhotos[s.subtaskId]?.length >= 1),
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

    if (!isOnline) {
      showToast('No connection. Please go online and try again.', 'error');
      return;
    }

    // Disable button immediately; show "Getting location…" if GPS pending
    setSubmitting(true);
    try {
      const location = await waitForGeo();

      // Build subtaskAnswers map
      const subtaskAnswers: Record<string, { value: string; type: CollectionType }> = {};
      for (const s of subtasks) {
        const val = answers[s.subtaskId];
        if (val !== undefined && val !== '') {
          subtaskAnswers[s.subtaskId] = { value: val, type: s.collectionType };
        }
      }

      await submitSiteTaskUpdate(task.id, {
        status,
        blockedReason:    status === 'blocked' ? blockedReason.trim() : null,
        subtaskAnswers,
        subtaskPhotos,
        completionPhotos,
        location,
        siteId:           task.siteId,
        siteCode:         task.siteCode,
        taskCode:         task.taskCode,
        taskLabel:        task.taskLabel,
        previousStatus:   task.status,   // status BEFORE this submission
      });

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
            <p className="text-xs text-gray-400 font-mono">{task.taskCode}</p>
            <SheetTitle className="leading-snug pr-8">{task.taskLabel}</SheetTitle>
            <p className="text-xs text-gray-500 mt-0.5">
              {task.siteCode} · {task.city}
            </p>
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
                        : 'border-gray-200 bg-white text-gray-700 hover:bg-blue-50',
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

            {/* Checklist — subtasks are embedded directly on the SiteTask snapshot */}
            {subtasks.length > 0 && (
              <div>
                <p className="text-sm font-semibold text-gray-700 mb-2">Checklist</p>
                <div className="flex flex-col gap-2">
                  {subtasks.map((s, i) => {
                    const isError =
                      showErrors &&
                      s.isRequired &&
                      s.collectionType !== 'image_only' &&
                      !answers[s.subtaskId]?.trim();
                    const firstErrorIdx = subtasks.findIndex(
                      (x) =>
                        showErrors &&
                        x.isRequired &&
                        x.collectionType !== 'image_only' &&
                        !answers[x.subtaskId]?.trim(),
                    );
                    return (
                      <div
                        key={s.subtaskId}
                        ref={isError && i === firstErrorIdx ? firstErrorRef : undefined}
                      >
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
                              taskNum={task.taskCode}
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
                taskNum={task.taskCode}
                taskId={task.id}
                photoType="completion"
              />
            </div>
          </div>

          {/* Submit button */}
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
