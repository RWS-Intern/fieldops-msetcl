import { WifiOff, Clock } from 'lucide-react';
import { useNetworkStatus } from '@/hooks/useNetworkStatus';
import { useOfflineQueue } from '@/hooks/useOfflineQueue';

/**
 * OfflineBanner — shown at the top of the screen whenever the device
 * is offline.  Also shows a pending-sync badge when queued updates exist.
 */
export function OfflineBanner() {
  const isOnline    = useNetworkStatus();
  const { queueCount } = useOfflineQueue();

  // Online and no pending items → render nothing
  if (isOnline && queueCount === 0) return null;

  if (!isOnline) {
    return (
      <div className="flex items-center gap-2 bg-amber-500 text-white px-4 py-2 text-sm font-medium">
        <WifiOff className="h-4 w-4 shrink-0" />
        <span className="flex-1">
          You&apos;re offline — updates will sync when connection is restored
        </span>
        {queueCount > 0 && (
          <span className="rounded-full bg-white/20 px-2 py-0.5 text-xs font-semibold">
            {queueCount} pending
          </span>
        )}
      </div>
    );
  }

  // Online but queue not yet drained
  if (queueCount > 0) {
    return (
      <div className="flex items-center gap-2 bg-brand-blue/10 border-b border-brand-blue/20 text-brand-navy px-4 py-2 text-sm">
        <Clock className="h-4 w-4 shrink-0 text-brand-blue animate-spin" />
        <span>Syncing {queueCount} offline update{queueCount !== 1 ? 's' : ''}…</span>
      </div>
    );
  }

  return null;
}
