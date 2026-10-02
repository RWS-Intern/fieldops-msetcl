import { useRef, useState } from 'react';
import { FileText, Loader2, X } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { uploadToCloudinary } from '@/utils/uploadToCloudinary';
import { useNetworkStatus } from '@/hooks/useNetworkStatus';

interface SignedPdfAttachProps {
  /** PDF references only — the caller splits them out of the mixed array. */
  pdfs:     string[];
  onChange: (pdfs: string[]) => void;
  siteCode: string;
  readOnly: boolean;
  label?:   string;
}

/**
 * Attaches a scanned PDF of the signed survey.
 *
 * A SEPARATE control from PhotoCapture, deliberately:
 *
 *   - PhotoCapture is a CAMERA surface (`capture="environment"`), which is the
 *     wrong affordance for picking a file a scanner produced.
 *   - Its whole pipeline is image-shaped: compressImage re-encodes through a
 *     canvas, surveyPhotoStore holds blobs for offline retry, and the three
 *     submit-queue helpers walk `local://` references. Threading "this one is
 *     a PDF" through all of that would change photo behaviour for every other
 *     photo field in the survey, which this change is explicitly scoped out of.
 *
 * So this sits alongside it and writes into the same `signedPagePhotos` array,
 * which keeps "a photo OR a PDF satisfies the requirement" true with no change
 * to the validator.
 *
 * ONLINE ONLY, and says so. A PDF comes off a scanner or a filesystem, not a
 * camera in a substation yard, so the offline-capture story photos need does
 * not apply — and a PDF is never compressed, so there is nothing to gain from
 * the local blob path. `uploadToCloudinary` already skips compression for
 * non-images by checking the file's own MIME type.
 */
/**
 * Cloudinary's per-file ceiling on this account, MEASURED not assumed: an
 * 11 MB upload is refused with "File size too large. Got 11534791. Maximum is
 * 10485760." Checked here so an oversized scan fails instantly with an
 * actionable message, instead of after a long upload with a 400 whose body the
 * shared uploader discards.
 */
const MAX_BYTES = 10 * 1024 * 1024;

const mb = (bytes: number) => (bytes / 1024 / 1024).toFixed(1);

/**
 * Why this file cannot be attached, or null if it can.
 *
 * Accepts on EITHER the extension or the MIME type: `accept` is only a hint to
 * the picker (a user can switch it to "All files"), and some Android file
 * managers hand back a PDF with an empty `file.type`, so requiring the MIME
 * would reject valid scans on exactly the devices this is for.
 */
function rejectReason(file: File): string | null {
  const looksPdf = /\.pdf$/i.test(file.name) || file.type === 'application/pdf';
  if (!looksPdf) {
    return `“${file.name}” is not a PDF. Attach a PDF, or photograph the signed page instead.`;
  }
  if (file.size > MAX_BYTES) {
    return `“${file.name}” is ${mb(file.size)} MB — the limit is 10 MB. `
      + 'Re-scan in black and white or at a lower resolution, or photograph the page instead.';
  }
  return null;
}

export function SignedPdfAttach({
  pdfs, onChange, siteCode, readOnly, label,
}: SignedPdfAttachProps) {
  const isOnline = useNetworkStatus();
  const inputRef = useRef<HTMLInputElement>(null);
  // Synchronous lock. `uploading` only disables the button after React commits
  // a render, so two taps in the same tick both get past it — same reasoning as
  // the Submit control's lock.
  const busyRef  = useRef(false);
  const [uploading, setUploading] = useState(false);
  const [errors, setErrors]       = useState<string[]>([]);

  async function handleFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    if (busyRef.current) return;
    busyRef.current = true;

    setUploading(true);
    setErrors([]);

    const added:  string[] = [];
    const failed: string[] = [];

    try {
      for (const file of Array.from(fileList)) {
        // Checked BEFORE the upload: a 10 MB scan over a substation's mobile
        // signal is a long wait to be told it was never going to work.
        const reason = rejectReason(file);
        if (reason) { failed.push(reason); continue; }

        try {
          // resourceType 'auto', not the 'image' default: it is what lets
          // Cloudinary classify a non-image upload. Verified against this
          // account's own unsigned preset — a PDF comes back as an `image`
          // resource with format `pdf`, which is also what makes the page-1
          // preview transformation available.
          const result = await uploadToCloudinary(file, {
            taskNum:      siteCode,
            resourceType: 'auto',
          });
          added.push(result.url);
        } catch (err) {
          console.error('[SignedPdfAttach] upload failed:', err);
          failed.push(`“${file.name}” didn't upload. Check the connection and try again.`);
        }
      }

      // Only successful uploads are appended, so a failure never leaves a
      // broken entry behind.
      if (added.length > 0) onChange([...pdfs, ...added]);
      setErrors(failed);
    } finally {
      setUploading(false);
      busyRef.current = false;
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {label && <Label>{label}</Label>}

      {pdfs.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {pdfs.map((url) => (
            <li
              key={url}
              className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-2.5 py-2"
            >
              <FileText className="h-4 w-4 shrink-0 text-brand-blue" />
              {/* A real link, not a viewer: opening in a new tab uses the
                  device's own PDF handling, which is the reliable path on
                  both desktop and mobile. */}
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="min-w-0 flex-1 truncate text-xs font-medium text-brand-blue hover:underline"
              >
                Open signed survey PDF
              </a>
              {!readOnly && (
                <button
                  type="button"
                  aria-label="Remove PDF"
                  onClick={() => onChange(pdfs.filter((p) => p !== url))}
                  className="shrink-0 rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {!readOnly && (
        <>
          <button
            type="button"
            disabled={uploading || !isOnline}
            onClick={() => inputRef.current?.click()}
            className="flex items-center justify-center gap-2 rounded-lg border-2 border-dashed border-gray-300 px-3 py-2.5 text-xs font-medium text-gray-500 transition-colors hover:border-brand-blue hover:text-brand-blue disabled:opacity-50 disabled:hover:border-gray-300 disabled:hover:text-gray-500"
          >
            {uploading
              ? <><Loader2 className="h-4 w-4 animate-spin" />Uploading…</>
              : <><FileText className="h-4 w-4" />Attach scanned PDF</>}
          </button>
          {!isOnline && (
            <p className="text-xs text-amber-700">
              PDF attachment needs a connection. Photograph the signed page instead — that works
              offline and satisfies the same requirement.
            </p>
          )}
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf,.pdf"
            multiple
            className="hidden"
            onChange={(e) => {
              void handleFiles(e.target.files);
              e.target.value = '';
            }}
          />
        </>
      )}

      {/* One line per rejected file, naming it — a batch where only the third
          scan was oversized should say which. */}
      {errors.length > 0 && (
        <ul className="flex flex-col gap-0.5">
          {errors.map((msg) => (
            <li key={msg} className="text-xs text-brand-red">{msg}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
