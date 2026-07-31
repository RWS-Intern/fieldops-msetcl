/**
 * Resize and re-encode an image file as JPEG at 80% quality.
 * Maximum dimension is 1200px on either side; aspect ratio is preserved.
 * Files > 10 MB are rejected before canvas work begins.
 *
 * Shared by uploadToCloudinary.ts (compress before network upload) and
 * PhotoCapture.tsx (compress before IndexedDB storage) — a photo is
 * compressed exactly once, at capture time, regardless of which path it
 * takes afterward (immediate upload, or stored locally for later).
 */
export async function compressImage(file: File): Promise<File> {
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
      reject(new Error('Failed to load image'));
    };

    img.src = url;
  });
}
