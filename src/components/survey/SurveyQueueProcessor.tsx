import { useEffect, useRef } from 'react';
import { useNetworkStatus }   from '@/hooks/useNetworkStatus';
import { useSurveyActions }   from '@/hooks/useSurveyActions';
import {
  getAllQueuedSurveys,
  dequeueSurveySubmission,
  updateSurveyQueueItem,
} from '@/lib/surveySubmitQueue';
import { deleteDraft }       from '@/lib/surveyDraftStore';
import { deletePhotosForWorkOrder } from '@/lib/surveyPhotoStore';
import { uploadToCloudinary } from '@/utils/uploadToCloudinary';
import { _emitToast }        from '@/components/ui/toast';
import { useAuthStore }      from '@/store/authStore';
import type {
  QueuedSurveySubmission,
  PendingSurveyPhoto,
  PendingSurveyPhotoTarget,
  SurveyPayload,
} from '@/lib/surveySubmitQueue';

// ─── Photo helpers ────────────────────────────────────────────────────────────
// Mirrors SiteTaskQueueProcessor.tsx's base64→File→Cloudinary path. No photo
// capture exists yet (task 3), so pendingPhotos is always [] today — this
// exists so the drain logic doesn't need to change when it lands.

function base64ToFile(base64: string, filename: string): File {
  const arr   = base64.split(',');
  const mime  = arr[0].match(/:(.*?);/)?.[1] ?? 'image/jpeg';
  const bstr  = atob(arr[1]);
  let   n     = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) u8arr[n] = bstr.charCodeAt(n);
  return new File([u8arr], filename, { type: mime });
}

async function uploadPendingPhoto(photo: PendingSurveyPhoto, siteCode: string): Promise<string> {
  if (photo.localUrl.startsWith('https://')) return photo.localUrl; // already uploaded

  if (!photo.localUrl.startsWith('data:')) {
    console.warn('[SurveyQueue] Unexpected URL scheme — passing through:', photo.localUrl.slice(0, 30));
    return photo.localUrl;
  }

  const file = base64ToFile(photo.localUrl, `${photo.photoId}.jpg`);
  // Survey photos don't have their own Cloudinary photoType bucket yet —
  // 'completion' is a reasonable placeholder categorisation; only the
  // folder/filename are affected, not correctness.
  const result = await uploadToCloudinary(file, {
    taskNum:   siteCode,
    photoType: 'completion',
    index:     0,
  });
  return result.url;
}

/** Splices an uploaded photo's final URL into the right spot in the survey payload. */
function appendUploadedPhoto(
  data:   SurveyPayload,
  target: PendingSurveyPhotoTarget,
  url:    string,
): SurveyPayload {
  switch (target.kind) {
    case 'bay':
      return {
        ...data,
        bays: data.bays.map((b) =>
          b.uid === target.bayUid ? { ...b, photos: [...b.photos, url] } : b
        ),
      };
    case 'device':
      return {
        ...data,
        devices: data.devices.map((d) =>
          d.uid === target.deviceUid ? { ...d, photos: [...d.photos, url] } : d
        ),
      };
    case 'sitePhoto':
      return {
        ...data,
        sitePhotos: [...data.sitePhotos, { url, caption: target.caption }],
      };
    case 'signOffSignedPage':
      return {
        ...data,
        signOff: { ...data.signOff, signedPagePhotos: [...data.signOff.signedPagePhotos, url] },
      };
    case 'signOffSurveyorSignature':
      return {
        ...data,
        signOff: { ...data.signOff, surveyorSignatureImage: url },
      };
    case 'signOffMsetclSignature':
      return {
        ...data,
        signOff: { ...data.signOff, msetclSignatureImage: url },
      };
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * SurveyQueueProcessor — invisible component mounted once at Layout level.
 *
 * When the device comes back online (or the app opens while already online)
 * it drains the IndexedDB `fieldops-survey-queue`:
 *   1. Upload any locally-captured photos to Cloudinary and splice their
 *      final URLs into the survey payload.
 *   2. Write the survey (+ parent work order) via submitSurvey.
 *   3. Delete the local draft and remove the queue entry.
 *
 * On failure the item's `attempts` counter is incremented and processing
 * stops — a subsequent `online` event retries.
 */
export function SurveyQueueProcessor() {
  const isOnline               = useNetworkStatus();
  const { submitSurvey }       = useSurveyActions();
  const { currentUser }        = useAuthStore();
  const processingRef          = useRef(false);

  async function processSingleItem(item: QueuedSurveySubmission): Promise<void> {
    // Step 1: upload any locally-captured photos, splicing final URLs in.
    let data = item.data;
    for (const photo of item.pendingPhotos) {
      const url = await uploadPendingPhoto(photo, item.siteCode);
      data = appendUploadedPhoto(data, photo.target, url);
    }

    // Step 2: write the survey + parent work order.
    await submitSurvey(item.surveyReportId, {
      workOrderId:     item.workOrderId,
      data,
      submittedBy:     item.submittedBy,
      submittedByName: item.submittedByName,
    });

    // Step 3: clear the local draft and any remaining local photo blobs — the
    // server now has the submitted copy (any pendingPhotos blobs still in
    // surveyPhotoStore are redundant at this point: their bytes already made
    // it to Firestore via the URL spliced in step 1).
    await deleteDraft(item.workOrderId).catch(() => {
      // Non-critical — a stray local draft is harmless, just cleanup debt.
    });
    await deletePhotosForWorkOrder(item.workOrderId).catch(() => {
      // Non-critical — stray local blobs are harmless, just cleanup debt.
    });
  }

  async function processQueue(): Promise<void> {
    if (processingRef.current || !currentUser) return;

    const queue = await getAllQueuedSurveys();
    if (queue.length === 0) return;

    processingRef.current = true;
    console.log(`[SurveyQueue] Processing ${queue.length} queued item(s)`);

    let succeeded = 0;
    let failed    = 0;

    for (const item of queue) {
      try {
        await processSingleItem(item);
        await dequeueSurveySubmission(item.id!);
        succeeded++;
        console.log('[SurveyQueue] Synced:', item.workOrderId);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        console.error('[SurveyQueue] Failed to sync:', item.workOrderId, err);

        await updateSurveyQueueItem(item.id!, {
          attempts:  item.attempts + 1,
          lastError: message,
        });

        failed++;
        break; // Stop on first failure — device is likely still offline
      }
    }

    processingRef.current = false;

    if (succeeded > 0 && failed === 0) {
      _emitToast(
        `${succeeded} offline survey submission${succeeded !== 1 ? 's' : ''} synced successfully`,
        'success',
      );
    } else if (succeeded > 0 && failed > 0) {
      _emitToast(`${succeeded} synced, ${failed} failed — will retry when reconnected`, 'warning');
    } else if (failed > 0) {
      _emitToast('Offline survey sync failed — will retry when reconnected', 'error');
    }
  }

  useEffect(() => {
    if (!isOnline) return;
    const timer = setTimeout(() => { processQueue(); }, 2000);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnline, currentUser?.uid]);

  return null;
}
