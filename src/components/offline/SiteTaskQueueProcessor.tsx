import { useEffect, useRef } from 'react';
import { useNetworkStatus }     from '@/hooks/useNetworkStatus';
import { useSiteTaskActions }   from '@/hooks/useSiteTaskActions';
import {
  getAllQueuedST,
  dequeueSTUpdate,
  updateSTQueueItem,
} from '@/hooks/useSiteTaskOfflineQueue';
import { uploadToCloudinary }   from '@/utils/uploadToCloudinary';
import { _emitToast }           from '@/components/ui/toast';
import { useAuthStore }         from '@/store/authStore';
import type { QueuedSiteTaskUpdate } from '@/types';

// ─── Photo helpers ────────────────────────────────────────────────────────────

/**
 * Convert a base64 data URI to a File object.
 * Used before uploading queued photos to Cloudinary.
 */
function base64ToFile(base64: string, filename: string): File {
  const arr   = base64.split(',');
  const mime  = arr[0].match(/:(.*?);/)?.[1] ?? 'image/jpeg';
  const bstr  = atob(arr[1]);
  let   n     = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) u8arr[n] = bstr.charCodeAt(n);
  return new File([u8arr], filename, { type: mime });
}

/**
 * Upload a single photo URL.
 * - `https://` Cloudinary URLs: returned as-is (already uploaded).
 * - `data:` base64 URIs: converted to File and uploaded to Cloudinary.
 * Throws on upload failure so the caller can break the queue loop.
 */
async function uploadQueuedPhoto(
  url:       string,
  taskCode:  string,
  photoType: 'subtask' | 'completion',
  index:     number,
  subtaskId?: string,
): Promise<string> {
  if (url.startsWith('https://')) return url;   // already a real URL

  if (!url.startsWith('data:')) {
    console.warn('[SiteTaskQueue] Unexpected URL scheme — passing through:', url.slice(0, 30));
    return url;
  }

  const file = base64ToFile(url, `photo_${index}.jpg`);
  const result = await uploadToCloudinary(file, {
    taskNum:   taskCode,
    subtaskId,
    photoType,
    index,
  });
  return result.url;
}

/** Upload an entire array of photo URLs, returning the final Cloudinary URL array. */
async function uploadPhotoArray(
  urls:      string[],
  taskCode:  string,
  photoType: 'subtask' | 'completion',
  subtaskId?: string,
): Promise<string[]> {
  const results: string[] = [];
  for (let i = 0; i < urls.length; i++) {
    // Sequential uploads so a single failure throws and stops the outer loop
    results.push(await uploadQueuedPhoto(urls[i], taskCode, photoType, i, subtaskId));
  }
  return results;
}

/** Upload all photos in a subtask-keyed map. */
async function uploadSubtaskPhotos(
  photos:   Record<string, string[]>,
  taskCode: string,
): Promise<Record<string, string[]>> {
  const result: Record<string, string[]> = {};
  for (const [subtaskId, urls] of Object.entries(photos)) {
    result[subtaskId] = await uploadPhotoArray(urls, taskCode, 'subtask', subtaskId);
  }
  return result;
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * SiteTaskQueueProcessor — invisible component mounted once at Layout level.
 *
 * When the device comes back online (or when the app is opened while online)
 * it drains the IndexedDB `fieldops-offline-st` queue:
 *   1. Upload any base64-encoded photos to Cloudinary.
 *   2. Write the final Firestore documents via `submitSiteTaskUpdate`.
 *   3. Remove the successfully processed entry from the queue.
 *
 * On failure the item's `attempts` counter is incremented and processing
 * stops — a subsequent `online` event will retry.
 */
export function SiteTaskQueueProcessor() {
  const isOnline                      = useNetworkStatus();
  const { submitSiteTaskUpdate }      = useSiteTaskActions();
  const { currentUser }               = useAuthStore();
  const processingRef                 = useRef(false);

  async function processQueue(): Promise<void> {
    if (processingRef.current || !currentUser) return;

    const queue = await getAllQueuedST();
    if (queue.length === 0) return;

    processingRef.current = true;

    console.log(`[SiteTaskQueue] Processing ${queue.length} queued item(s)`);

    let succeeded = 0;
    let failed    = 0;

    for (const item of queue) {
      try {
        await processSingleItem(item);
        await dequeueSTUpdate(item.id!);
        succeeded++;
        console.log('[SiteTaskQueue] Synced:', item.taskCode);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        console.error('[SiteTaskQueue] Failed to sync:', item.taskCode, err);

        await updateSTQueueItem(item.id!, {
          attempts:  item.attempts + 1,
          lastError: message,
        });

        failed++;
        break;   // Stop on first failure — device is likely still offline
      }
    }

    processingRef.current = false;

    if (succeeded > 0 && failed === 0) {
      _emitToast(
        `${succeeded} offline update${succeeded !== 1 ? 's' : ''} synced successfully`,
        'success',
      );
    } else if (succeeded > 0 && failed > 0) {
      _emitToast(`${succeeded} synced, ${failed} failed — will retry when reconnected`, 'warning');
    } else if (failed > 0) {
      _emitToast('Offline sync failed — will retry when reconnected', 'error');
    }
  }

  async function processSingleItem(item: QueuedSiteTaskUpdate): Promise<void> {
    // Step 1: Upload any base64 photos to Cloudinary
    const finalSubtaskPhotos    = await uploadSubtaskPhotos(
      item.payload.subtaskPhotos,
      item.taskCode,
    );
    const finalCompletionPhotos = await uploadPhotoArray(
      item.payload.completionPhotos,
      item.taskCode,
      'completion',
    );

    // Step 2: Write to Firestore (reuses all completedTaskCount / audit logic)
    await submitSiteTaskUpdate(item.siteTaskId, {
      status:           item.payload.status,
      blockedReason:    item.payload.blockedReason ?? null,
      subtaskAnswers:   item.payload.subtaskAnswers,
      subtaskPhotos:    finalSubtaskPhotos,
      completionPhotos: finalCompletionPhotos,
      location:         item.payload.location,
      siteId:           item.siteId,
      siteCode:         item.siteCode,
      taskCode:         item.taskCode,
      taskLabel:        item.taskLabel,
      previousStatus:   item.previousStatus,
    });
  }

  // ── Effect: process on reconnect + on initial mount if already online ────────
  useEffect(() => {
    if (!isOnline) return;

    // Small delay to let the connection stabilise before firing Firestore writes
    const timer = setTimeout(() => { processQueue(); }, 2000);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnline, currentUser?.uid]);

  // This component renders nothing — it only has side effects
  return null;
}
