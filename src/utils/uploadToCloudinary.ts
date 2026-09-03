import { compressImage } from './imageCompression';

export interface UploadResult {
  url:      string;
  publicId: string;
}

/**
 * Upload a single image file to Cloudinary via the unsigned upload API.
 * The image is compressed to ≤ 1200px on the longest side at 80% JPEG quality
 * before upload. Progress callbacks fire per-xhr upload event.
 *
 * Optional naming options:
 *   taskNum   — used as the sub-folder:  <VITE_CLOUDINARY_FOLDER>/<taskNum>/
 *   subtaskId — used as the filename prefix for subtask photos
 *   photoType — 'subtask' | 'completion'
 *   index     — position within the upload batch (for ordering)
 */
export async function uploadToCloudinary(
  file:     File,
  options?: {
    onProgress?: (percent: number) => void;
    taskId?:     string;
    taskNum?:    string;
    subtaskId?:  string;
    photoType?:  'subtask' | 'completion';
    index?:      number;
  },
): Promise<UploadResult> {
  const cloudName        = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME    as string;
  const uploadPreset     = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET as string;
  const cloudinaryFolder = import.meta.env.VITE_CLOUDINARY_FOLDER        as string;

  if (!cloudName || !uploadPreset || !cloudinaryFolder) {
    throw new Error('Cloudinary env vars not set');
  }

  const { onProgress, taskNum, subtaskId, photoType, index } = options ?? {};

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

  // Compress before upload — reduces bandwidth and storage cost
  const compressed = await compressImage(file);

  const formData = new FormData();
  formData.append('file',          compressed);
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
      `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
    );
    xhr.send(formData);
  });
}
