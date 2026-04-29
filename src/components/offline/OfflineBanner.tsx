import { WifiOff, Clock } from 'lucide-react';
import { useNetworkStatus }          from '@/hooks/useNetworkStatus';
import { useOfflineQueue }           from '@/hooks/useOfflineQueue';
import { useSiteTaskOfflineQueue }   from '@/hooks/useSiteTaskOfflineQueue';

/**
 * OfflineBanner — shown at the top of the screen whenever the device is
 * offline or there are pending updates waiting to sync.
 *
 * Combines the v2.1 task queue count (useOfflineQueue) and the v3.0
 * site-task queue count (useSiteTaskOfflineQueue) into a single banner.
 */
export function OfflineBanner() {
  const isOnline                       = useNetworkStatus();
  const { queueCount: v2QueueCount }   = useOfflineQueue();
  const { queueCount: stQueueCount }   = useSiteTaskOfflineQueue();

  const totalPending = v2QueueCount + stQueueCount;

  // Online and nothing pending → render nothing
  if (isOnline && totalPending === 0) return null;

  if (!isOnline) {
    return (
      <div className="flex items-center gap-2 bg-amber-500 text-white px-4 py-2 text-sm font-medium">
        <WifiOff className="h-4 w-4 shrink-0" />
        <span className="flex-1">
          You&apos;re offline — updates will sync when connection is restored
        </span>
        {totalPending > 0 && (
          <span className="rounded-full bg-white/20 px-2 py-0.5 text-xs font-semibold">
            {totalPending} pending
          </span>
        )}
      </div>
    );
  }

  // Online but queue not yet fully drained
  if (totalPending > 0) {
    return (
      <div className="flex items-center gap-2 bg-brand-blue/10 border-b border-brand-blue/20 text-brand-navy px-4 py-2 text-sm">
        <Clock className="h-4 w-4 shrink-0 text-brand-blue animate-spin" />
        <span>
          Syncing {totalPending} offline update{totalPending !== 1 ? 's' : ''}…
        </span>
      </div>
    );
  }

  return null;
}
