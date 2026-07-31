import { openDB, type IDBPDatabase } from 'idb';

/**
 * Local blob storage for survey photos — deliberately a SEPARATE store from
 * both the survey object and the draft-autosave store (surveyDraftStore.ts).
 *
 * The wizard autosaves the ENTIRE survey object to IndexedDB on a 500ms
 * debounce. If photo bytes lived inside that object (e.g. as base64), every
 * keystroke pause would rewrite megabytes of image data — twenty photos at
 * ~300KB base64 each is ~6MB rewritten every 500ms, which makes the form
 * unusable on a mid-range phone. So a photo reference inside the survey is
 * always a short string (`local://<photoId>` before upload, `https://…`
 * after), and the actual compressed Blob lives only here, keyed by that same
 * photoId — see PhotoCapture.tsx and SurveyPhotoThumb.tsx for the read/write
 * sides of that contract.
 */

const DB_NAME          = 'fieldops-survey-photos';
const DB_VERSION       = 1;
const STORE            = 'photos';
const WORK_ORDER_INDEX = 'workOrderId';

export interface StoredSurveyPhoto {
  photoId:     string;
  workOrderId: string;
  blob:        Blob;
  mimeType:    string;
  /** Date.now() at capture time. */
  capturedAt:  number;
}

let _dbPromise: Promise<IDBPDatabase> | null = null;

function getDB(): Promise<IDBPDatabase> {
  if (!_dbPromise) {
    _dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: 'photoId' });
          store.createIndex(WORK_ORDER_INDEX, 'workOrderId');
        }
      },
    });
  }
  return _dbPromise;
}

/** Save (or overwrite) a photo's compressed blob. */
export async function savePhoto(
  photoId:     string,
  workOrderId: string,
  blob:        Blob,
  mimeType:    string,
): Promise<void> {
  const db = await getDB();
  const record: StoredSurveyPhoto = { photoId, workOrderId, blob, mimeType, capturedAt: Date.now() };
  await db.put(STORE, record);
}

/** Fetch a single photo's blob, or null if it doesn't exist (e.g. already cleaned up). */
export async function getPhoto(photoId: string): Promise<StoredSurveyPhoto | null> {
  const db = await getDB();
  const record = (await db.get(STORE, photoId)) as StoredSurveyPhoto | undefined;
  return record ?? null;
}

/** Delete a single photo's blob — called once it's uploaded, or explicitly removed. */
export async function deletePhoto(photoId: string): Promise<void> {
  const db = await getDB();
  await db.delete(STORE, photoId);
}

/** List every locally-stored photo for a work order. */
export async function listPhotosForWorkOrder(workOrderId: string): Promise<StoredSurveyPhoto[]> {
  const db = await getDB();
  return db.getAllFromIndex(STORE, WORK_ORDER_INDEX, workOrderId) as Promise<StoredSurveyPhoto[]>;
}

/** Delete every locally-stored photo for a work order — same lifecycle as deleteDraft. */
export async function deletePhotosForWorkOrder(workOrderId: string): Promise<void> {
  const photos = await listPhotosForWorkOrder(workOrderId);
  const db = await getDB();
  await Promise.all(photos.map((p) => db.delete(STORE, p.photoId)));
}

/** Converts a Blob to a base64 data: URI — the shape SurveyQueueProcessor's base64ToFile expects. */
export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror   = () => reject(reader.error ?? new Error('Failed to read blob'));
    reader.readAsDataURL(blob);
  });
}
