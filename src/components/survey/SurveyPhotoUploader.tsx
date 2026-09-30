import { useEffect } from 'react';
import { useFeatureFlags } from '@/hooks/useFeatureFlags';
import { useNetworkStatus } from '@/hooks/useNetworkStatus';
import { drainPhotoUploads } from '@/lib/surveyPhotoUploader';

const TICK_MS = 15_000;

/**
 * Drives the background photo uploader. Mounted only for field sessions (see
 * Layout), and does nothing unless the admin switch is on.
 *
 * Runs on a tick as well as on reconnect: the offline→online edge alone misses
 * a connection that was already up when the app loaded.
 */
export function SurveyPhotoUploader() {
  const { surveyBackgroundPhotoUploadEnabled: enabled } = useFeatureFlags();
  const isOnline = useNetworkStatus();

  useEffect(() => {
    if (!enabled) return;
    const t = setInterval(() => { void drainPhotoUploads(); }, TICK_MS);
    return () => clearInterval(t);
  }, [enabled]);

  useEffect(() => {
    if (enabled && isOnline) void drainPhotoUploads();
  }, [enabled, isOnline]);

  return null;
}
