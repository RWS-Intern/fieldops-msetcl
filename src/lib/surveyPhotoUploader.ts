import { listAllPhotos, deletePhoto } from '@/lib/surveyPhotoStore';
import { loadDraft, saveDraft } from '@/lib/surveyDraftStore';
import { replaceLocalPhotoRef, LOCAL_PHOTO_PREFIX } from '@/lib/surveySubmitQueue';
import { uploadToCloudinary } from '@/utils/uploadToCloudinary';
import type { SurveyReport } from '@/types';

/**
 * Background uploader for survey photos and signatures.
 *
 * Complements, never replaces, the existing paths: PhotoCapture still uploads
 * at capture time and submit still resolves anything left. This closes the gap
 * between them — a photo captured offline on Step 9 used to wait until Submit,
 * because PhotoCapture only retries for the step on screen.
 *
 * Rules:
 *   - SERIAL. One upload at a time; twenty in parallel on a 2G link all time out.
 *   - BACKOFF on failure, capped, instead of hammering a dead connection.
 *   - NEVER DESTRUCTIVE. A blob is deleted only after its URL is written back.
 *     An unreferenced blob is skipped, not deleted.
 *   - ONE UPLOADER PER PHOTO. claimPhoto is shared with PhotoCapture.
 */

// ─── Shared in-flight guard ───────────────────────────────────────────────────

const inFlight = new Set<string>();

/** Returns false if the photo is already uploading elsewhere. */
export function claimPhoto(photoId: string): boolean {
  if (inFlight.has(photoId)) return false;
  inFlight.add(photoId);
  return true;
}

export function releasePhoto(photoId: string): void {
  inFlight.delete(photoId);
}

// ─── Backoff ──────────────────────────────────────────────────────────────────

const BACKOFF_BASE_MS = 5_000;
const BACKOFF_CAP_MS  = 5 * 60_000;

/** Delay before retry n (0-based): 5s, 10s, 20s … capped at 5 min. */
export function backoffDelay(attempt: number): number {
  return Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, attempt));
}

// ─── Pending counts (Phase 2) ─────────────────────────────────────────────────

let pending = new Map<string, number>();
const listeners = new Set<() => void>();

export function getPendingPhotos(workOrderId?: string): number {
  if (workOrderId) return pending.get(workOrderId) ?? 0;
  let total = 0;
  pending.forEach((n) => { total += n; });
  return total;
}

export function subscribePendingPhotos(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

async function recount(): Promise<void> {
  const next = new Map<string, number>();
  for (const p of await listAllPhotos()) next.set(p.workOrderId, (next.get(p.workOrderId) ?? 0) + 1);
  pending = next;
  listeners.forEach((fn) => fn());
}

// ─── Ref swap event ───────────────────────────────────────────────────────────

export const PHOTO_UPLOADED_EVENT = 'survey-photo-uploaded';

export interface PhotoUploadedDetail {
  workOrderId: string;
  oldRef:      string;
  newRef:      string;
  /** Set by an open wizard that applied the swap to its live state. */
  handled:     boolean;
}

/**
 * Hands the swap to an open wizard first. If one handles it, its own 500ms
 * autosave persists it — writing the draft here as well would race the
 * wizard's in-memory state and could drop its latest edits.
 */
function announceSwap(detail: Omit<PhotoUploadedDetail, 'handled'>): boolean {
  const event = new CustomEvent<PhotoUploadedDetail>(PHOTO_UPLOADED_EVENT, {
    detail: { ...detail, handled: false },
  });
  window.dispatchEvent(event);   // synchronous — listeners have run by now
  return event.detail.handled;
}

// ─── Drain ────────────────────────────────────────────────────────────────────

let draining = false;
/** photoId → uploaded URL, awaiting confirmation it is saved in the draft. */
const uploadedUrls = new Map<string, string>();
let failures = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Uploads every pending photo it can, one at a time. Safe to call often —
 * overlapping calls are coalesced and a pending backoff is respected.
 */
export async function drainPhotoUploads(): Promise<void> {
  if (draining || retryTimer) return;
  if (typeof navigator !== 'undefined' && !navigator.onLine) { await recount(); return; }

  draining = true;
  try {
    const photos = (await listAllPhotos()).sort((a, b) => a.capturedAt - b.capturedAt);

    for (const photo of photos) {
      if (!navigator.onLine) break;
      if (!claimPhoto(photo.photoId)) continue;

      const oldRef = `${LOCAL_PHOTO_PREFIX}${photo.photoId}`;
      try {
        const draft = await loadDraft(photo.workOrderId);
        const inDraft = !!draft && JSON.stringify(draft.data).includes(oldRef);
        const known = uploadedUrls.get(photo.photoId);

        let url: string;
        if (known) {
          // Uploaded on an earlier pass and handed to an open wizard.
          if (!inDraft) {
            // The wizard persisted the new URL — the blob is finally redundant.
            await deletePhoto(photo.photoId);
            uploadedUrls.delete(photo.photoId);
            continue;
          }
          url = known;   // wizard closed before saving: reuse, don't re-upload
        } else {
          // Skip, never delete, a blob nothing references yet — the wizard may
          // hold a fresh capture its 500ms autosave has not written.
          if (!inDraft) continue;
          const siteCode = (draft.data.siteCode as string | undefined) ?? 'survey';
          const file = new File([photo.blob], `${photo.photoId}.jpg`, { type: photo.mimeType });
          url = (await uploadToCloudinary(file, { taskNum: siteCode, photoType: 'completion', index: 0 })).url;
        }

        if (announceSwap({ workOrderId: photo.workOrderId, oldRef, newRef: url })) {
          // The wizard owns persistence now. Keep the blob until a later pass
          // sees the new URL in the saved draft — deleting now would lose the
          // photo if the tab closed inside the wizard's 500ms save window.
          uploadedUrls.set(photo.photoId, url);
          continue;
        }

        const fresh = await loadDraft(photo.workOrderId);
        if (!fresh) continue;   // draft vanished — keep the blob
        await saveDraft(photo.workOrderId, {
          data:      replaceLocalPhotoRef(fresh.data as SurveyReport, oldRef, url),
          stepIndex: fresh.stepIndex,
        });
        // Only now: the URL is persisted where it will reach the server.
        await deletePhoto(photo.photoId);
        uploadedUrls.delete(photo.photoId);
        failures = 0;
      } catch (err) {
        console.error('[surveyPhotoUploader] upload failed, will retry:', err);
        failures += 1;
        retryTimer = setTimeout(() => {
          retryTimer = null;
          void drainPhotoUploads();
        }, backoffDelay(failures - 1));
        break;   // stop the pass; a dead link fails every photo the same way
      } finally {
        releasePhoto(photo.photoId);
      }
    }
  } finally {
    draining = false;
    await recount();
  }
}

/** For capture sites: a photo was added or removed, so counts are stale. */
export function notifyPhotosChanged(): void {
  void recount();
}

/** Test hook — resets module state between cases. */
export function _resetUploaderForTests(): void {
  inFlight.clear();
  uploadedUrls.clear();
  failures = 0;
  draining = false;
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
}
