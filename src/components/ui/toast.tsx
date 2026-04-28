import * as React from 'react';
import { cn } from '@/lib/utils';

// ─── Type ─────────────────────────────────────────────────────────────────────

export type ToastType = 'success' | 'error' | 'warning' | 'info';

// ─── Per-type style tokens ─────────────────────────────────────────────────────

interface ToastStyle {
  container: string;
  closeBtn:  string;
}

const STYLES: Record<ToastType, ToastStyle> = {
  success: {
    container: 'bg-green-600 text-white',
    closeBtn:  'text-white/80 hover:text-white',
  },
  error: {
    container: 'bg-brand-red text-white',
    closeBtn:  'text-white/80 hover:text-white',
  },
  warning: {
    container: 'bg-amber-50 border border-amber-200 text-amber-800',
    closeBtn:  'text-amber-600/80 hover:text-amber-800',
  },
  info: {
    container: 'bg-brand-blue text-white',
    closeBtn:  'text-white/80 hover:text-white',
  },
};

// ─── Visual component ─────────────────────────────────────────────────────────

interface ToastProps {
  message: string;
  type?: ToastType;
  onClose?: () => void;
}

export function Toast({ message, type = 'info', onClose }: ToastProps) {
  const { container, closeBtn } = STYLES[type];

  return (
    <div
      className={cn(
        'fixed bottom-20 left-1/2 -translate-x-1/2 z-[9999] flex items-center gap-3 rounded-lg px-4 py-3 text-sm shadow-lg min-w-[240px] max-w-sm',
        container
      )}
      role="alert"
    >
      <span className="flex-1">{message}</span>
      {onClose && (
        <button onClick={onClose} className={cn('ml-2', closeBtn)}>
          ✕
        </button>
      )}
    </div>
  );
}

// ─── Global event emitter ─────────────────────────────────────────────────────
// Module-level Set so the root <Toaster /> receives toasts even after the
// component that called showToast() has unmounted.

type ToastListener = (message: string, type: ToastType) => void;

const _listeners = new Set<ToastListener>();

/** Called by <Toaster /> to subscribe to incoming toasts. */
export function _subscribeToast(fn: ToastListener): () => void {
  _listeners.add(fn);
  return () => { _listeners.delete(fn); };
}

/** Internal emit — consumed by useToast hook below. */
export function _emitToast(message: string, type: ToastType = 'info'): void {
  _listeners.forEach((fn) => fn(message, type));
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * useToast — delegates to the global <Toaster /> mounted at app root.
 * ToastComponent is null for backward compat; existing {ToastComponent}
 * render sites are harmless no-ops.
 */
export function useToast() {
  const showToast = React.useCallback(
    (message: string, type: ToastType = 'info') => {
      _emitToast(message, type);
    },
    []
  );

  return { showToast, ToastComponent: null as React.ReactNode };
}
