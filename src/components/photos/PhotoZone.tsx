import { useRef, useState, useEffect } from 'react';
import { Camera, X, Loader2 } from 'lucide-react';
import { uploadToCloudinary } from '@/utils/uploadToCloudinary';
import { _emitToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────

interface PhotoZoneProps {
  label:           string;     // e.g. "Completion Photos"
  photos:          string[];   // committed Cloudinary URLs from parent state
  onPhotosChange:  (urls: string[]) => void;
  required?:       boolean;    // shows red border + star when empty
  maxPhotos?:      number;     // default 5
  disabled?:       boolean;
  // Naming / folder context passed through to Cloudinary
  taskNum?:        string;
  taskId?:         string;
  subtaskId?:      string;
  photoType?:      'subtask' | 'completion';
}

interface PendingUpload {
  tempId:     string;
  progress:   number;   // 0–100
  previewUrl: string;   // revocable object URL for thumbnail preview
}

// ─── Module-level counter for unique temp IDs ─────────────────────────────────
let _uid = 0;
function nextTempId() { return `pp-${++_uid}`; }

// ─── Component ────────────────────────────────────────────────────────────────

export function PhotoZone({
  label,
  photos,
  onPhotosChange,
  required   = false,
  maxPhotos  = 5,
  disabled   = false,
  taskNum,
  taskId,
  subtaskId,
  photoType,
}: PhotoZoneProps) {
  const fileInputRef      = useRef<HTMLInputElement>(null);
  const [pendingUploads, setPendingUploads] = useState<PendingUpload[]>([]);

  // ── Refs kept current so async upload callbacks never close over stale values ──
  // Using refs avoids the "stale closure" problem where two uploads completing
  // near-simultaneously would both append to the same old `photos` snapshot.
  const latestPhotosRef   = useRef<string[]>(photos);
  const onChangeRef       = useRef(onPhotosChange);
  const pendingRef        = useRef<PendingUpload[]>([]);

  useEffect(() => { latestPhotosRef.current = photos;         }, [photos]);
  useEffect(() => { onChangeRef.current     = onPhotosChange; }, [onPhotosChange]);
  useEffect(() => { pendingRef.current      = pendingUploads; }, [pendingUploads]);

  // Revoke any dangling object URLs when the component unmounts
  useEffect(() => () => {
    pendingRef.current.forEach((p) => URL.revokeObjectURL(p.previewUrl));
  }, []);

  // ── Derived ───────────────────────────────────────────────────────────────────

  const totalShown = photos.length + pendingUploads.length;
  const canAdd     = !disabled && totalShown < maxPhotos;
  const isEmpty    = totalShown === 0;
  const showError  = required && isEmpty;

  // ── Handlers ──────────────────────────────────────────────────────────────────

  function removePhoto(url: string) {
    if (disabled) return;
    const updated = latestPhotosRef.current.filter((u) => u !== url);
    latestPhotosRef.current = updated;
    onChangeRef.current(updated);
  }

  function startUpload(file: File, index = 0) {
    const tempId     = nextTempId();
    const previewUrl = URL.createObjectURL(file);

    // Add a pending slot immediately so the user sees a spinner thumbnail
    setPendingUploads((prev) => [...prev, { tempId, progress: 0, previewUrl }]);

    uploadToCloudinary(file, {
      onProgress: (pct) => {
        setPendingUploads((prev) =>
          prev.map((p) => (p.tempId === tempId ? { ...p, progress: pct } : p)),
        );
      },
      taskNum,
      taskId,
      subtaskId,
      photoType,
      index,
    })
      .then(({ url }) => {
        setPendingUploads((prev) => prev.filter((p) => p.tempId !== tempId));
        URL.revokeObjectURL(previewUrl);
        // Use the ref, not the prop, to avoid stale-closure duplicates
        const updated = [...latestPhotosRef.current, url];
        latestPhotosRef.current = updated;
        onChangeRef.current(updated);
      })
      .catch(() => {
        setPendingUploads((prev) => prev.filter((p) => p.tempId !== tempId));

        if (!navigator.onLine) {
          // Keep the blob URL as a committed "local" photo.
          // When the user taps Submit offline, UpdateSiteTaskDrawer converts
          // all blob: URLs to base64 data URIs before queuing in IndexedDB.
          // Do NOT revoke the blob URL here — the thumbnail still needs it.
          const updated = [...latestPhotosRef.current, previewUrl];
          latestPhotosRef.current = updated;
          onChangeRef.current(updated);
          _emitToast('Photo saved locally — will upload when you reconnect', 'success');
        } else {
          URL.revokeObjectURL(previewUrl);
          _emitToast('Failed to upload photo. Try again.', 'error');
        }
      });
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    // Reset value so selecting the same file again fires onChange
    e.target.value = '';
    if (files.length === 0) return;

    // ── Size validation ───────────────────────────────────────────────────────
    const oversized = files.filter((f) => f.size > 10 * 1024 * 1024);
    oversized.forEach((f) =>
      _emitToast(`"${f.name}" exceeds the 10 MB limit.`, 'error'),
    );
    const valid = files.filter((f) => f.size <= 10 * 1024 * 1024);
    if (valid.length === 0) return;

    // ── maxPhotos guard ───────────────────────────────────────────────────────
    // Use the ref for committed photos since state may not have updated yet
    const remaining = maxPhotos - (latestPhotosRef.current.length + pendingUploads.length);
    if (remaining <= 0) {
      _emitToast(`Maximum ${maxPhotos} photo${maxPhotos !== 1 ? 's' : ''} allowed.`, 'warning');
      return;
    }
    if (valid.length > remaining) {
      _emitToast(
        `Only ${remaining} more photo${remaining !== 1 ? 's' : ''} can be added.`,
        'warning',
      );
    }

    const baseIndex = latestPhotosRef.current.length + pendingRef.current.length;
    valid.slice(0, remaining).forEach((f, i) => startUpload(f, baseIndex + i));
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-2">
      {/* ── Thumbnail grid — shown as soon as there is at least one item ── */}
      {!isEmpty && (
        <div className="grid grid-cols-3 gap-2">
          {/* Committed (uploaded) photos */}
          {photos.map((url, i) => (
            <div key={url} className="relative">
              {/* Aspect-ratio wrapper — padding-bottom trick keeps it square */}
              <div
                className="relative rounded-lg overflow-hidden bg-gray-100"
                style={{ paddingBottom: '100%' }}
              >
                <img
                  src={url}
                  alt={`${label} ${i + 1}`}
                  className="absolute inset-0 h-full w-full object-cover"
                />
              </div>

              {!disabled && (
                <button
                  type="button"
                  onClick={() => removePhoto(url)}
                  className="absolute right-1 top-1 rounded-full bg-black/60 p-0.5 transition-colors hover:bg-black/80"
                  aria-label="Remove photo"
                >
                  <X className="h-3 w-3 text-white" />
                </button>
              )}
            </div>
          ))}

          {/* In-progress upload thumbnails */}
          {pendingUploads.map((p) => (
            <div key={p.tempId} className="relative">
              <div
                className="relative rounded-lg overflow-hidden bg-gray-200"
                style={{ paddingBottom: '100%' }}
              >
                <img
                  src={p.previewUrl}
                  alt="Uploading…"
                  className="absolute inset-0 h-full w-full object-cover opacity-40"
                />
                {/* Progress overlay */}
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-1">
                  <Loader2 className="h-5 w-5 animate-spin text-gray-600" />
                  <span className="text-xs font-semibold text-gray-700">
                    {p.progress}%
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Add-photo button area ── */}
      {canAdd && (
        <div
          className={cn(
            'rounded-lg border-2 transition-colors',
            isEmpty ? 'border-dashed' : 'border-solid',
            showError
              ? 'border-red-300 bg-red-50'
              : 'border-gray-200 bg-gray-50 hover:border-gray-300',
          )}
        >
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex w-full items-center justify-center gap-2 py-3 text-xs font-medium text-brand-blue hover:text-brand-blue/80 transition-colors"
          >
            <Camera className="h-4 w-4" />
            {isEmpty ? 'Add Photo' : 'Add More'}
          </button>
        </div>
      )}

      {/* Slots-full indicator */}
      {!disabled && !canAdd && totalShown >= maxPhotos && (
        <p className="text-center text-xs text-gray-400">
          Maximum {maxPhotos} photo{maxPhotos !== 1 ? 's' : ''} reached
        </p>
      )}

      {/* ── Hidden file input ── */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        className="hidden"
        onChange={handleFileChange}
      />
    </div>
  );
}
