import {
  classifyPhotoFailure, photoFailureMessage, photoFailureDetail,
} from '@/lib/photoFailure';
import type { PhotoFailureReason } from '@/lib/photoFailure';

/**
 * A compressImage failure that knows WHY.
 *
 * Extends Error and keeps a readable `message`, so every existing caller that
 * does `catch (err)` and reads `err.message` — or ignores it entirely — keeps
 * working unchanged. Only callers that want the specific cause need look at
 * `reason`.
 */
export class ImageCompressionError extends Error {
  readonly reason: PhotoFailureReason;
  constructor(reason: PhotoFailureReason, message: string) {
    super(message);
    this.name = 'ImageCompressionError';
    this.reason = reason;
  }
}

/**
 * Resize and re-encode an image file as JPEG at 80% quality.
 * Maximum dimension is 1200px on either side; aspect ratio is preserved.
 * Files > 10 MB are rejected before canvas work begins.
 *
 * Shared by uploadToCloudinary.ts (compress before network upload) and
 * PhotoCapture.tsx (compress before IndexedDB storage) — a photo is
 * compressed exactly once, at capture time, regardless of which path it
 * takes afterward (immediate upload, or stored locally for later).
 *
 * The SUCCESS path and the signature are untouched. Failures now throw an
 * ImageCompressionError carrying a classified reason, and log the file's
 * name/type/size/lastModified — without that, a report from the field was
 * just "Failed to load image" with nothing to act on.
 */
export async function compressImage(file: File): Promise<File> {
  // Decided BEFORE any canvas work — the 10 MB guard exactly as before, plus
  // the two other causes a decode attempt could never diagnose: a file that is
  // not an image at all, and a zero-byte placeholder (a cloud-only gallery
  // item the picker could not materialise).
  //
  // A HEIC is deliberately NOT rejected here: Safari decodes them fine, so it
  // gets its decode attempt and is only classified 'heic' if that attempt
  // actually fails.
  const preReason = classifyPhotoFailure(file);
  if (preReason === 'not-image' || preReason === 'too-large' || preReason === 'unreadable') {
    console.error('[compressImage] rejected:', photoFailureDetail(file, preReason));
    throw new ImageCompressionError(preReason, photoFailureMessage(file, preReason));
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
        // Canvas not supported — upload/store the original
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
      // The browser could not decode it. classifyPhotoFailure separates the
      // one cause with a real remedy (HEIC) from the generic case.
      const reason = classifyPhotoFailure(file);
      console.error('[compressImage] decode failed:', photoFailureDetail(file, reason));
      reject(new ImageCompressionError(reason, photoFailureMessage(file, reason)));
    };

    img.src = url;
  });
}
