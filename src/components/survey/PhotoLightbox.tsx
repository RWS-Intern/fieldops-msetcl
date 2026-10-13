import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, RotateCcw, RotateCw, X } from 'lucide-react';
import { SurveyPhotoThumb } from './SurveyPhotoThumb';

interface PhotoLightboxProps {
  /** Photo references (https:// or local://) the viewer can step through. */
  refs: string[];
  /** Index of the photo shown; null = closed. */
  index: number | null;
  onIndexChange: (index: number | null) => void;
}

/**
 * Full-screen viewer for survey photos.
 *
 * Portalled to document.body above the survey preview (which itself sits at
 * z-[9999]), so it opens on top of it. Uses SurveyPhotoThumb, so a photo that
 * is still only on this device (local://) shows as well as an uploaded one.
 * Close with the ✕, Escape, or a click on the backdrop; ← / → step through.
 *
 * Landscape and portrait photos both fit the screen whole (object-contain).
 * The rotate buttons (or R / Shift+R) turn a photo 90° at a time — so a
 * landscape photo can fill a phone held upright, and a sideways shot can be
 * read the right way up. Rotation resets when moving to another photo.
 */
export function PhotoLightbox({ refs, index, onIndexChange }: PhotoLightboxProps) {
  const open = index !== null && index >= 0 && index < refs.length;
  const count = refs.length;
  // Rotation belongs to one photo: stored with its index, so it reads as 0
  // for any other photo without an effect resetting it.
  const [turn, setTurn] = useState<{ index: number | null; deg: number }>({ index: null, deg: 0 });
  const deg = turn.index === index ? turn.deg : 0;
  const rotate = (by: number) => setTurn({ index, deg: deg + by });
  const sideways = Math.abs(deg / 90) % 2 === 1;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onIndexChange(null);
      else if (e.key === 'ArrowRight' && count > 1) onIndexChange(((index ?? 0) + 1) % count);
      else if (e.key === 'ArrowLeft' && count > 1) onIndexChange(((index ?? 0) - 1 + count) % count);
      else if (e.key === 'r' || e.key === 'R') setTurn({ index, deg: deg + (e.shiftKey ? -90 : 90) });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, index, count, deg, onIndexChange]);

  if (!open) return null;

  const step = (delta: number) => onIndexChange(((index ?? 0) + delta + count) % count);
  const navClass =
    'absolute top-1/2 z-10 -translate-y-1/2 rounded-full bg-black/40 p-2 text-white hover:bg-black/60 transition-colors';
  const toolClass = 'rounded-full bg-black/40 p-1.5 text-white hover:bg-black/60 transition-colors';

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Photo viewer"
      className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/90 print:hidden"
      onClick={(e) => { if (e.target === e.currentTarget) onIndexChange(null); }}
    >
      <div className="absolute top-4 right-4 z-10 flex items-center gap-2">
        <button type="button" aria-label="Rotate left" title="Rotate left" className={toolClass} onClick={() => rotate(-90)}>
          <RotateCcw className="h-5 w-5" />
        </button>
        <button type="button" aria-label="Rotate right" title="Rotate right" className={toolClass} onClick={() => rotate(90)}>
          <RotateCw className="h-5 w-5" />
        </button>
        <button type="button" aria-label="Close photo" title="Close" className={toolClass} onClick={() => onIndexChange(null)}>
          <X className="h-5 w-5" />
        </button>
      </div>

      {count > 1 && (
        <>
          <button type="button" aria-label="Previous photo" className={`${navClass} left-3`} onClick={() => step(-1)}>
            <ChevronLeft className="h-6 w-6" />
          </button>
          <button type="button" aria-label="Next photo" className={`${navClass} right-3`} onClick={() => step(1)}>
            <ChevronRight className="h-6 w-6" />
          </button>
          <span className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-black/40 px-3 py-1 text-xs text-white">
            {(index ?? 0) + 1} / {count}
          </span>
        </>
      )}

      {/* Turned sideways, the photo's width runs up the screen — so its size
          limits swap, and it still fits whole, landscape or portrait. */}
      <div
        className="flex items-center justify-center transition-transform duration-200"
        style={{ transform: `rotate(${deg}deg)` }}
      >
        <SurveyPhotoThumb
          key={refs[index ?? 0]}
          reference={refs[index ?? 0]}
          className={sideways
            ? 'max-h-[92vw] max-w-[85vh] rounded-lg object-contain'
            : 'max-h-[85vh] max-w-[92vw] rounded-lg object-contain'}
        />
      </div>
    </div>,
    document.body,
  );
}
