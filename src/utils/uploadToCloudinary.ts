import { compressImage } from './imageCompression';

export interface UploadResult {
  url:      string;
  publicId: string;
}

/**
 * Upload a single file to Cloudinary via the unsigned upload API. Progress
 * callbacks fire per-xhr upload event.
 *
 * IMAGES (the default, and everything this app uploaded before the approval
 * chain) are compressed to ≤ 1200px on the longest side at 80% JPEG quality
 * first. NON-IMAGES ARE NEVER COMPRESSED — running a PDF or a spreadsheet
 * through the canvas re-encoder would destroy it. The decision is made from
 * the file's own MIME type, not from `resourceType`, so passing
 * resourceType: 'auto' with an image still gets the compression an image
 * should get.
 *
 * Optional naming options:
 *   taskNum   — used as the sub-folder:  <VITE_CLOUDINARY_FOLDER>/<taskNum>/
 *   subtaskId — used as the filename prefix for subtask photos
 *   photoType — 'subtask' | 'completion'
 *   index     — position within the upload batch (for ordering)
 *
 * resourceType selects the Cloudinary endpoint:
 *   'image' (default) — the historic behaviour, unchanged for every existing caller.
 *   'auto'            — lets Cloudinary classify the upload; required for a
 *                       generic attachment that may be a PDF, document, etc.
 *                       (see the approval-stage attachment on the review screen).
 */
export async function uploadToCloudinary(
  file:     File,
  options?: {
    onProgress?:   (percent: number) => void;
    taskId?:       string;
    taskNum?:      string;
    subtaskId?:    string;
    photoType?:    'subtask' | 'completion';
    index?:        number;
    resourceType?: 'image' | 'auto';
  },
): Promise<UploadResult> {
  const cloudName        = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME    as string;
  const uploadPreset     = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET as string;
  const cloudinaryFolder = import.meta.env.VITE_CLOUDINARY_FOLDER        as string;

  if (!cloudName || !uploadPreset || !cloudinaryFolder) {
    throw new Error('Cloudinary env vars not set');
  }

  const { onProgress, taskNum, subtaskId, photoType, index, resourceType = 'image' } = options ?? {};

  // Build folder path: <VITE_CLOUDINARY_FOLDER>/<taskNum> or <VITE_CLOUDINARY_FOLDER>
  const folder = taskNum ? `${cloudinaryFolder}/${taskNum}` : cloudinaryFolder;

  // Build public_id (filename without extension — Cloudinary adds it)
  let publicId: string | undefined;
  if (photoType === 'subtask' && subtaskId) {
    publicId = `${subtaskId}_${index ?? 0}_${Date.now()}`;
  } else if (photoType === 'completion') {
    publicId = `completion_${index ?? 0}_${Date.now()}`;
  }
  // else: leave undefined → Cloudinary auto-generates

  // Compress before upload — reduces bandwidth and storage cost. Images only:
  // compressImage re-encodes through a canvas as JPEG, which would corrupt any
  // non-image payload rather than shrink it.
  const isImage = file.type.startsWith('image/');
  const payload = isImage ? await compressImage(file) : file;

  const formData = new FormData();
  formData.append('file',          payload);
  formData.append('upload_preset', uploadPreset);
  formData.append('folder',        folder);
  if (publicId) {
    formData.append('public_id', publicId);
  }

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    });

    xhr.addEventListener('load', () => {
      if (xhr.status === 200) {
        const data = JSON.parse(xhr.responseText);
        resolve({
          url:      data.secure_url  as string,
          publicId: data.public_id   as string,
        });
      } else {
        reject(new Error(`Upload failed: ${xhr.status}`));
      }
    });

    xhr.addEventListener('error', () => {
      reject(new Error('Upload network error'));
    });

    xhr.open(
      'POST',
      `https://api.cloudinary.com/v1_1/${cloudName}/${resourceType}/upload`,
    );
    xhr.send(formData);
  });
}
