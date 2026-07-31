import { useEffect, useRef, useState } from 'react';
import { Camera, Check, Loader2, X } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { compressImage } from '@/utils/imageCompression';
import { uploadToCloudinary } from '@/utils/uploadToCloudinary';
import { savePhoto, getPhoto, deletePhoto } from '@/lib/surveyPhotoStore';
import { useNetworkStatus } from '@/hooks/useNetworkStatus';
import { SurveyPhotoThumb } from './SurveyPhotoThumb';

const LOCAL_PREFIX = 'local://';

interface PhotoCaptureProps {
  photos:      string[];
  onChange:    (photos: string[]) => void;
  /** Replaces one local://<photoId> reference with its uploaded https:// URL — see StepProps.ts. */
  onReplacePhotoRef: (oldRef: string, newRef: string) => void;
  workOrderId: string;
  siteCode:    string;
  readOnly:    boolean;
  label?:      string;
}

/**
 * One photo-capture surface used everywhere the survey needs photos:
 * Section I's named slots, and each bay/device entry. A captured photo is
 * compressed and stored as a Blob in surveyPhotoStore — never as base64
 * inside the survey object itself (see surveyPhotoStore.ts for why). The
 * survey only ever holds a short `local://<photoId>` or `https://…`
 * reference string. Adding/removing photos goes through `onChange` (a single
 * user action, never concurrent); replacing a reference after a background
 * upload goes through `onReplacePhotoRef` instead, since several of those can
 * legitimately be in flight at once — see its call site below.
 *
 * Online: uploads immediately after storing, replaces the local:// reference
 * with the returned https:// URL, and deletes the local blob. If the upload
 * fails, the local:// reference is kept so submit-time queueing can retry it
 * later — a photo is never lost just because an opportunistic upload failed.
 * Offline: stores only; submit-time queueing (SurveyWizardPage.tsx) handles
 * the rest.
 */
export function PhotoCapture({
  photos, onChange, onReplacePhotoRef, workOrderId, siteCode, readOnly, label,
}: PhotoCaptureProps) {
  const isOnline = useNetworkStatus();
  const inputRef = useRef<HTMLInputElement>(null);
  const [processing, setProcessing]       = useState(false);
  const [uploadingIds, setUploadingIds]   = useState<Set<string>>(new Set());
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [lastError, setLastError]         = useState<string | null>(null);

  // Synchronous guard — a given photoId must never have two uploads in
  // flight at once (capture-time immediate upload racing an online-retry
  // sweep, or two reconnect events firing close together). The `uploadingIds`
  // STATE above is for the UI badge only and isn't safe for this: state
  // updates aren't visible synchronously, so two calls starting in the same
  // tick would both read the pre-update set and both proceed.
  const uploadingPhotoIdsRef = useRef<Set<string>>(new Set());

  async function tryUploadAndReplace(localRef: string, file: File) {
    const photoId = localRef.slice(LOCAL_PREFIX.length);
    if (uploadingPhotoIdsRef.current.has(photoId)) return;
    uploadingPhotoIdsRef.current.add(photoId);

    setUploadingIds((prev) => new Set(prev).add(photoId));
    try {
      const result = await uploadToCloudinary(file, { taskNum: siteCode, photoType: 'completion', index: 0 });
      // A functional setSurveyData update (see SurveyWizardPage.tsx), not a
      // precomputed onChange(photos.map(...)) call — several photos can
      // finish uploading in the same React batch, and only the functional
      // form guarantees each replacement is applied against the latest
      // state instead of two concurrent completions clobbering each other.
      onReplacePhotoRef(localRef, result.url);
      await deletePhoto(photoId).catch(() => {});
    } catch (err) {
      // Keep the local:// reference — submit-time queueing will read the
      // still-stored blob and retry later. Never lose the photo just
      // because this opportunistic upload failed.
      console.error('[PhotoCapture] upload failed, kept locally:', err);
    } finally {
      uploadingPhotoIdsRef.current.delete(photoId);
      setUploadingIds((prev) => {
        const next = new Set(prev);
        next.delete(photoId);
        return next;
      });
    }
  }

  // Opportunistic retry: the moment the connection returns, give every
  // still-local photo one more upload attempt right away rather than making
  // the surveyor wait for Submit. Fires only on the offline→online edge (not
  // on every render while already online, and not on mount) — tryUploadAndReplace
  // already fails silently and leaves the local:// reference intact on
  // failure, so submit-time resolution remains the backstop either way.
  const wasOnlineRef = useRef(isOnline);
  useEffect(() => {
    const cameOnline = isOnline && !wasOnlineRef.current;
    wasOnlineRef.current = isOnline;
    if (!cameOnline) return;

    async function retryUpload(localRef: string, photoId: string) {
      try {
        const stored = await getPhoto(photoId);
        if (!stored) return; // nothing recoverable locally — submit-time handling already tolerates this
        const file = new File([stored.blob], `${photoId}.jpg`, { type: stored.mimeType });
        await tryUploadAndReplace(localRef, file);
      } catch (err) {
        console.error('[PhotoCapture] online-retry failed:', err);
      }
    }

    for (const ref of photos) {
      if (!ref.startsWith(LOCAL_PREFIX)) continue;
      void retryUpload(ref, ref.slice(LOCAL_PREFIX.length));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnline]);

  async function handleFilesSelected(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList);
    setProcessing(true);
    setLastError(null);

    const added: { ref: string; file: File }[] = [];
    let failures = 0;

    // Sequential, not Promise.all: keeps compress+store from fighting over
    // the same canvas/IDB connection on a low-end device, and the delay
    // between files is imperceptible next to camera capture time itself.
    for (const file of files) {
      try {
        const compressed = await compressImage(file);
        const photoId = crypto.randomUUID();
        await savePhoto(photoId, workOrderId, compressed, compressed.type);
        added.push({ ref: `${LOCAL_PREFIX}${photoId}`, file: compressed });
      } catch (err) {
        console.error('[PhotoCapture] compress/store failed:', err);
        failures++;
      }
    }

    // One onChange call for the whole batch — several incremental calls here
    // would each compute their patch from the same pre-batch `photos` prop
    // and overwrite each other.
    if (added.length > 0) {
      onChange([...photos, ...added.map((a) => a.ref)]);
    }
    if (failures > 0) {
      setLastError(`Couldn't add ${failures} photo${failures !== 1 ? 's' : ''}. Try again.`);
    }
    setProcessing(false);

    if (isOnline) {
      for (const entry of added) {
        void tryUploadAndReplace(entry.ref, entry.file);
      }
    }
  }

  async function handleRemove(ref: string) {
    if (ref.startsWith(LOCAL_PREFIX)) {
      await deletePhoto(ref.slice(LOCAL_PREFIX.length)).catch(() => {});
    }
    onChange(photos.filter((p) => p !== ref));
    setConfirmRemove(null);
  }

  return (
    <div className="flex flex-col gap-2">
      {label && <Label>{label}</Label>}

      <div className="flex flex-wrap gap-2">
        {photos.map((ref) => {
          const isLocal       = ref.startsWith(LOCAL_PREFIX);
          const photoId       = isLocal ? ref.slice(LOCAL_PREFIX.length) : null;
          const isUploading   = photoId != null && uploadingIds.has(photoId);
          const isConfirming  = confirmRemove === ref;

          return (
            <div key={ref} className="relative h-20 w-20 rounded-lg overflow-hidden border border-gray-200 shrink-0 bg-gray-50">
              <SurveyPhotoThumb reference={ref} className="h-full w-full" />

              <div
                className={cn(
                  'absolute bottom-0 inset-x-0 flex items-center justify-center gap-0.5 py-0.5 text-[9px] font-medium text-white',
                  isUploading ? 'bg-brand-blue/85' : isLocal ? 'bg-amber-600/85' : 'bg-green-700/85',
                )}
              >
                {isUploading ? (
                  <><Loader2 className="h-2.5 w-2.5 animate-spin" />Uploading</>
                ) : isLocal ? (
                  'On device'
                ) : (
                  <><Check className="h-2.5 w-2.5" />Uploaded</>
                )}
              </div>

              {!readOnly && !isConfirming && (
                <button
                  type="button"
                  onClick={() => setConfirmRemove(ref)}
                  aria-label="Remove photo"
                  className="absolute top-0.5 right-0.5 h-5 w-5 rounded-full bg-black/60 text-white flex items-center justify-center"
                >
                  <X className="h-3 w-3" />
                </button>
              )}

              {isConfirming && (
                <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center gap-1 p-1">
                  <p className="text-[9px] text-white text-center leading-tight">Remove?</p>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => setConfirmRemove(null)}
                      className="text-[9px] px-1.5 py-0.5 rounded bg-white/25 text-white"
                    >
                      No
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRemove(ref)}
                      className="text-[9px] px-1.5 py-0.5 rounded bg-brand-red text-white"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {!readOnly && (
          <button
            type="button"
            disabled={processing}
            onClick={() => inputRef.current?.click()}
            className="h-20 w-20 rounded-lg border-2 border-dashed border-gray-300 flex flex-col items-center justify-center gap-1 text-gray-400 hover:border-brand-blue hover:text-brand-blue transition-colors shrink-0 disabled:opacity-50"
          >
            <Camera className="h-5 w-5" />
            <span className="text-[10px]">{processing ? 'Saving…' : 'Add photo'}</span>
          </button>
        )}
      </div>

      {lastError && <p className="text-xs text-brand-red">{lastError}</p>}

      {!readOnly && (
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          capture="environment"
          multiple
          className="hidden"
          onChange={(e) => {
            void handleFilesSelected(e.target.files);
            e.target.value = '';
          }}
        />
      )}
    </div>
  );
}
