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
 *   taskNum   — used as the sub-folder:  fieldops/<taskNum>/
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
  const cloudName    = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME    as string;
  const uploadPreset = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET as string;

  if (!cloudName || !uploadPreset) {
    throw new Error('Cloudinary env vars not set');
  }

  const { onProgress, taskNum, subtaskId, photoType, index } = options ?? {};

  // Build folder path: fieldops/<taskNum> or fieldops
  const folder = taskNum ? `fieldops/${taskNum}` : 'fieldops';

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

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Resize and re-encode a file as JPEG at 80% quality.
 * Maximum dimension is 1200px on either side; aspect ratio is preserved.
 * Files > 10 MB are rejected before canvas work begins.
 */
async function compressImage(file: File): Promise<File> {
  if (file.size > 10 * 1024 * 1024) {
    throw new Error('File too large. Maximum size is 10MB.');
  }

  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);

      const MAX_DIM = 1200;
      let { width, height } = img;

      if (width > MAX_DIM || height > MAX_DIM) {
        if (width > height) {
          height = Math.round((height / width) * MAX_DIM);
          width  = MAX_DIM;
        } else {
          width  = Math.round((width / height) * MAX_DIM);
          height = MAX_DIM;
        }
      }

      const canvas = document.createElement('canvas');
      canvas.width  = width;
      canvas.height = height;

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        // Canvas not supported — upload original
        resolve(file);
        return;
      }

      ctx.drawImage(img, 0, 0, width, height);

      canvas.toBlob(
        (blob) => {
          if (!blob) {
            resolve(file);
            return;
          }
          resolve(
            new File(
              [blob],
              file.name.replace(/\.[^.]+$/, '.jpg'),
              { type: 'image/jpeg' },
            ),
          );
        },
        'image/jpeg',
        0.8,
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image'));
    };

    img.src = url;
  });
}
