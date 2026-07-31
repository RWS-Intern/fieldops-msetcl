import { useEffect, useState } from 'react';
import { getPhoto } from '@/lib/surveyPhotoStore';
import { cn } from '@/lib/utils';

interface SurveyPhotoThumbProps {
  /** An https:// URL, or a local://<photoId> reference. */
  reference: string;
  className?: string;
}

/**
 * Renders a photo reference. An https:// URL renders directly; a
 * local://<photoId> reference loads the Blob from surveyPhotoStore and
 * renders it via URL.createObjectURL. The object URL is revoked on
 * unmount/reference change — leaking these across a long survey with many
 * photos is a real memory problem.
 */
export function SurveyPhotoThumb({ reference, className }: SurveyPhotoThumbProps) {
  const isLocal = reference.startsWith('local://');
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [missing, setMissing]     = useState(false);

  useEffect(() => {
    if (!isLocal) return;

    let cancelled = false;
    let createdUrl: string | null = null;
    const photoId = reference.slice('local://'.length);

    getPhoto(photoId)
      .then((stored) => {
        if (cancelled) return;
        if (!stored) {
          setMissing(true);
          return;
        }
        createdUrl = URL.createObjectURL(stored.blob);
        setObjectUrl(createdUrl);
      })
      .catch(() => {
        if (!cancelled) setMissing(true);
      });

    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [reference, isLocal]);

  if (missing) {
    return (
      <div className={cn('flex items-center justify-center bg-gray-100 text-gray-400 text-[9px] text-center px-1', className)}>
        Photo unavailable
      </div>
    );
  }

  const src = isLocal ? objectUrl : reference;

  if (!src) {
    return <div className={cn('bg-gray-100 animate-pulse', className)} />;
  }

  return <img src={src} alt="" className={cn('object-cover', className)} />;
}
