import { useEffect, useRef } from 'react';
import { useNetworkStatus } from '@/hooks/useNetworkStatus';
import { getAllQueued, dequeueUpdate } from '@/hooks/useOfflineQueue';
import { useTaskActions } from '@/hooks/useTaskActions';
import { useOfflineQueue } from '@/hooks/useOfflineQueue';
import { _emitToast } from '@/components/ui/toast';

/**
 * OfflineQueueProcessor — invisible component mounted once at the Layout level.
 *
 * When the device comes back online it drains the IndexedDB offline queue,
 * replaying each queued `submitTaskUpdate` call in the order it was enqueued.
 * Success / failure toasts are emitted via the global Toaster.
 */
export function OfflineQueueProcessor() {
  const isOnline          = useNetworkStatus();
  const { submitTaskUpdate } = useTaskActions();
  const { refreshCount }  = useOfflineQueue();
  const processingRef     = useRef(false);

  useEffect(() => {
    if (!isOnline || processingRef.current) return;

    async function drain() {
      processingRef.current = true;
      try {
        const items = await getAllQueued();
        if (items.length === 0) return;

        let succeeded = 0;
        let failed    = 0;

        for (const item of items) {
          try {
            await submitTaskUpdate(item.taskId, item.taskNum, item.payload);
            await dequeueUpdate(item.id!);
            succeeded++;
          } catch (err) {
            console.error('[OfflineQueue] Failed to sync item:', item.id, err);
            failed++;
          }
        }

        await refreshCount();

        if (succeeded > 0 && failed === 0) {
          _emitToast(
            `${succeeded} offline update${succeeded !== 1 ? 's' : ''} synced successfully`,
            'success'
          );
        } else if (succeeded > 0 && failed > 0) {
          _emitToast(
            `${succeeded} synced, ${failed} failed — check connection`,
            'warning'
          );
        } else if (failed > 0) {
          _emitToast('Offline sync failed — updates still queued', 'error');
        }
      } finally {
        processingRef.current = false;
      }
    }

    // Small delay to let the connection stabilise before firing Firestore writes
    const timer = setTimeout(drain, 1500);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnline]);

  return null;
}
