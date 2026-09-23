/**
 * Signed-page attachments: telling a PDF from a photo, and getting something
 * viewable out of a PDF.
 *
 * WHY TYPE IS INFERRED RATHER THAN STORED: `signOff.signedPagePhotos` is a
 * `string[]` that has held real production data since the survey was built.
 * Migrating it to `{ url, kind }[]` would mean touching the three offline-queue
 * helpers that find/strip/replace `local://` references inside it, the read
 * mapper, the validator and the submit path — a wide blast radius on the one
 * field that is the legal document of record. Inference is safe here because
 * every URL in that array is one we wrote ourselves: Cloudinary's delivery URL
 * always carries the format extension, images are uploaded as JPEG, and a
 * `local://` reference is always a camera capture by construction. If a second
 * document type ever needs distinguishing, that is the point to revisit this.
 */

/** True for an attachment that is a PDF rather than a photo. */
export function isPdfRef(reference: string): boolean {
  return /\.pdf(?:$|[?#])/i.test(reference);
}

/**
 * A page-1 JPEG rendering of a PDF, for an inline preview.
 *
 * Cloudinary classifies an uploaded PDF as an `image` resource (verified
 * against this account's own preset), which makes it transformable — `pg_1`
 * selects the first page and `f_jpg` rasterises it. The `.pdf` extension is
 * deliberately left on the end: `f_jpg` governs the output format, and
 * rewriting the extension buys nothing.
 *
 * Returns null for anything that is not a Cloudinary image-delivery URL — a
 * `local://` reference, or a URL shape we do not recognise — so callers fall
 * back to the plain link rather than rendering a guess.
 */
export function pdfPreviewUrl(reference: string): string | null {
  if (!isPdfRef(reference)) return null;
  if (!reference.startsWith('https://')) return null;
  const marker = '/image/upload/';
  const at = reference.indexOf(marker);
  if (at === -1) return null;

  const transform = 'pg_1,f_jpg,w_600,h_800,c_fit,q_auto';
  return `${reference.slice(0, at + marker.length)}${transform}/${reference.slice(at + marker.length)}`;
}
