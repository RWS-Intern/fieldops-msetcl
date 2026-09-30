import { useSyncExternalStore } from 'react';
import { getPendingPhotos, subscribePendingPhotos } from '@/lib/surveyPhotoUploader';

/** Photos still stored only on this device — for one work order, or all. */
export function usePendingPhotos(workOrderId?: string): number {
  return useSyncExternalStore(
    subscribePendingPhotos,
    () => getPendingPhotos(workOrderId),
    () => 0,
  );
}
