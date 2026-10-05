/**
 * Why a chosen photo could not be used, and what to tell the field expert.
 *
 * PURE and DOM-free on purpose: the decode itself needs a canvas and cannot be
 * exercised outside a browser, but deciding *why* it failed is just string and
 * number logic — so that part is testable, and is tested.
 *
 * Exists because the only message a failure produced was "Couldn't add 1
 * photo. Try again.", which is actively misleading: none of the real causes
 * below are fixed by retrying. Same trap as the PDF size error.
 */

export type PhotoFailureReason =
  | 'not-image'
  | 'heic'
  | 'too-large'
  | 'unreadable'
  | 'decode';

/** The size ceiling compressImage enforces before any canvas work. */
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

/** Extensions a browser may reasonably be handed for a photo. */
const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'heic', 'heif', 'avif', 'bmp'];
const HEIC_EXTENSIONS  = ['heic', 'heif'];

/** Lowercase extension without the dot, or '' when the name carries none. */
function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase();
}

/** The minimum of File this module needs — keeps it testable without a DOM. */
export interface PhotoFileFacts {
  name: string;
  type: string;
  size: number;
}

/**
 * Classifies a failed photo.
 *
 * Order matters. `not-image` is checked first because a file that is not an
 * image at all should say so rather than blaming the decoder; `heic` before
 * the generic `decode` because it is the one cause with a specific, actionable
 * remedy; `too-large` before `unreadable` because an oversized file never
 * reaches a read.
 */
export function classifyPhotoFailure(file: PhotoFileFacts): PhotoFailureReason {
  const ext = extensionOf(file.name);
  const isImageMime = file.type.startsWith('image/');
  const isHeicMime  = file.type === 'image/heic' || file.type === 'image/heif';
  const isHeicExt   = HEIC_EXTENSIONS.includes(ext);

  // Neither the MIME nor the extension says "image". An empty MIME is common
  // on Android file managers, so the extension alone is enough to pass here.
  if (!isImageMime && !IMAGE_EXTENSIONS.includes(ext)) return 'not-image';

  if (file.size > MAX_PHOTO_BYTES) return 'too-large';

  // Zero bytes means the picker handed over a placeholder it could not
  // materialise — typically a cloud-only Google Photos item.
  if (file.size === 0) return 'unreadable';

  if (isHeicMime || isHeicExt) return 'heic';

  return 'decode';
}

/** The message shown to the field expert for each reason. */
export function photoFailureMessage(file: PhotoFileFacts, reason: PhotoFailureReason): string {
  const mb = (file.size / 1024 / 1024).toFixed(1);
  switch (reason) {
    case 'not-image':
      return `“${file.name}” isn't a photo. Choose an image file.`;
    case 'heic':
      return `“${file.name}” is in HEIC format, which this browser can't read. `
        + 'Set the phone camera to JPEG (turn off “High efficiency pictures” on Samsung, '
        + 'or choose “Most Compatible” on iPhone), or use the Take photo tile.';
    case 'too-large':
      return `“${file.name}” is ${mb} MB; the limit is 10 MB. Choose a smaller photo or use Take photo.`;
    case 'unreadable':
      return `“${file.name}” couldn't be read. If it is stored in the cloud, download it to the phone first.`;
    case 'decode':
    default:
      return `“${file.name}” couldn't be opened as a photo. Try a different one or use Take photo.`;
  }
}

/**
 * One line of diagnostics for the console, so a failure reported from the
 * field can be understood without reproducing it. Deliberately includes
 * lastModified: it distinguishes a freshly-shot photo from an old library item.
 */
export function photoFailureDetail(
  file: PhotoFileFacts & { lastModified?: number },
  reason: PhotoFailureReason,
): Record<string, unknown> {
  return {
    reason,
    name: file.name,
    type: file.type || '(empty)',
    size: file.size,
    lastModified: file.lastModified ?? null,
  };
}
