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
export function SignedPdfAttach({
  pdfs, onChange, siteCode, readOnly, label,
}: SignedPdfAttachProps) {
  const isOnline = useNetworkStatus();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError]         = useState<string | null>(null);

  async function handleFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    setUploading(true);
    setError(null);

    const added: string[] = [];
    let failures = 0;

    for (const file of Array.from(fileList)) {
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
        failures++;
      }
    }

    if (added.length > 0) onChange([...pdfs, ...added]);
    if (failures > 0) {
      setError(`Couldn't upload ${failures} file${failures !== 1 ? 's' : ''}. Check the connection and try again.`);
    }
    setUploading(false);
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

      {error && <p className="text-xs text-brand-red">{error}</p>}
    </div>
  );
}
