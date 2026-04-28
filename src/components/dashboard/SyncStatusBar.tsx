import { useEffect, useState } from 'react';

interface SyncStatusBarProps {
  lastUpdated: Date | null;
  isConnected: boolean;
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString('en-GB', {
    hour:   '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

export function SyncStatusBar({ lastUpdated, isConnected }: SyncStatusBarProps) {
  // Tick every second to keep the displayed timestamp live
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="flex items-center gap-2 text-xs text-gray-500">
      {isConnected ? (
        <>
          <span className="h-2 w-2 rounded-full bg-green-500 shrink-0" />
          <span>
            Live — last updated{' '}
            <span className="font-medium tabular-nums">
              {lastUpdated ? formatTime(lastUpdated) : '—'}
            </span>
          </span>
        </>
      ) : (
        <>
          <span className="h-2 w-2 rounded-full bg-amber-400 shrink-0 animate-pulse" />
          <span>Reconnecting…</span>
        </>
      )}
    </div>
  );
}
