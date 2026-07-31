import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { Label } from '@/components/ui/label';
import { SurveyPhotoThumb } from './SurveyPhotoThumb';
import { savePhoto, deletePhoto } from '@/lib/surveyPhotoStore';

const LOCAL_PREFIX = 'local://';
const SAVE_DEBOUNCE_MS = 500;

interface SignaturePadProps {
  /** local://<photoId> or https://… reference, or null if unsigned. */
  value: string | null;
  onChange: (ref: string | null) => void;
  workOrderId: string;
  readOnly: boolean;
  /** e.g. "Surveyor (our representative)". */
  signerLabel: string;
  /** Printed beneath the baseline. */
  signerName: string | null;
}

/**
 * On-screen signature capture — canvas + pointer events (works with finger,
 * stylus and mouse alike), sized to devicePixelRatio so strokes aren't blurry
 * on phones. A signature follows the exact same local:// pipeline as every
 * other photo (see surveyPhotoStore.ts / surveySubmitQueue.ts) — the PNG blob
 * never enters the survey object or the draft store, only a short reference
 * string does.
 *
 * Renders in one of two modes:
 *  - Editing (no signature yet, or "Re-sign" tapped): a live, drawable
 *    canvas. Never rendered when readOnly.
 *  - Viewing (a signature exists and isn't being redrawn): the saved image
 *    via SurveyPhotoThumb — a plain <img>, which is what actually prints
 *    reliably; the live canvas is print:hidden regardless, since canvas
 *    print support is inconsistent across browsers.
 */
export function SignaturePad({ value, onChange, workOrderId, readOnly, signerLabel, signerName }: SignaturePadProps) {
  const canvasRef      = useRef<HTMLCanvasElement>(null);
  const drawingRef     = useRef(false);
  const lastPointRef   = useRef<{ x: number; y: number } | null>(null);
  const hasStrokesRef  = useRef(false);
  const saveTimerRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isEditing, setIsEditing] = useState(!value);
  const [saving, setSaving]       = useState(false);

  // Backing store sized to CSS size × devicePixelRatio, context scaled to
  // match — otherwise strokes look soft at 2-3x pixel density phone screens.
  useEffect(() => {
    if (!isEditing) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr  = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width  = rect.width  * dpr;
    canvas.height = rect.height * dpr;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.scale(dpr, dpr);
      ctx.lineWidth   = 2;
      ctx.lineCap     = 'round';
      ctx.lineJoin    = 'round';
      ctx.strokeStyle = '#111827';
    }
    hasStrokesRef.current = false;
  }, [isEditing]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  function getPoint(e: ReactPointerEvent<HTMLCanvasElement>): { x: number; y: number } {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function handlePointerDown(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (readOnly) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.setPointerCapture(e.pointerId);
    drawingRef.current = true;
    lastPointRef.current = getPoint(e);
  }

  function handlePointerMove(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || !lastPointRef.current) return;
    const point = getPoint(e);
    ctx.beginPath();
    ctx.moveTo(lastPointRef.current.x, lastPointRef.current.y);
    ctx.lineTo(point.x, point.y);
    ctx.stroke();
    lastPointRef.current = point;
    hasStrokesRef.current = true;
  }

  function handlePointerUp(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    lastPointRef.current = null;
    canvasRef.current?.releasePointerCapture(e.pointerId);
    scheduleSave();
  }

  function scheduleSave() {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => { void commitSignature(); }, SAVE_DEBOUNCE_MS);
  }

  async function commitSignature() {
    const canvas = canvasRef.current;
    if (!canvas || !hasStrokesRef.current) return;

    setSaving(true);
    try {
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (!blob) return;

      const photoId = crypto.randomUUID();
      await savePhoto(photoId, workOrderId, blob, 'image/png');

      const previousRef = value;
      onChange(`${LOCAL_PREFIX}${photoId}`);
      setIsEditing(false);

      // Save-then-reference-then-delete, not delete-first: if the delete
      // below ever failed, the signer would still have never been left
      // without a valid signature at any point.
      if (previousRef?.startsWith(LOCAL_PREFIX)) {
        await deletePhoto(previousRef.slice(LOCAL_PREFIX.length)).catch(() => {});
      }
    } catch (err) {
      console.error('[SignaturePad] failed to save signature:', err);
    } finally {
      setSaving(false);
    }
  }

  function handleClear() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (canvas && ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    hasStrokesRef.current = false;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
  }

  const showCanvas = isEditing && !readOnly;

  return (
    <div className="flex flex-col gap-2 break-inside-avoid">
      <Label>{signerLabel}</Label>

      {!showCanvas && value && (
        <div className="flex flex-col gap-1">
          <div className="border border-gray-200 rounded-lg bg-white h-28 flex items-center justify-center overflow-hidden">
            <SurveyPhotoThumb reference={value} className="h-full w-full object-contain" />
          </div>
          <div className="border-t border-gray-400 pt-1 flex items-center justify-between">
            <span className="text-xs text-gray-600">{signerName || 'Unnamed'}</span>
            {!readOnly && (
              <button
                type="button"
                onClick={() => setIsEditing(true)}
                className="print:hidden text-xs text-brand-blue hover:underline"
              >
                Re-sign
              </button>
            )}
          </div>
        </div>
      )}

      {!showCanvas && !value && (
        <div className="border border-dashed border-gray-300 rounded-lg bg-gray-50 h-28 flex items-center justify-center">
          <span className="text-xs text-gray-400">Not signed yet</span>
        </div>
      )}

      {showCanvas && (
        <div className="flex flex-col gap-1">
          <canvas
            ref={canvasRef}
            className="print:hidden border border-gray-300 rounded-lg bg-white h-28 w-full touch-none"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
          />
          <div className="print:hidden border-t border-gray-400 pt-1 flex items-center justify-between">
            <span className="text-xs text-gray-600">{signerName || 'Unnamed'}</span>
            <div className="flex items-center gap-3">
              {saving && <span className="text-[10px] text-gray-400">Saving…</span>}
              <button type="button" onClick={handleClear} className="text-xs text-brand-red hover:underline">
                Clear
              </button>
              {value && (
                <button type="button" onClick={() => setIsEditing(false)} className="text-xs text-gray-500 hover:underline">
                  Cancel
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
