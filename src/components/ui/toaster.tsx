import { useState, useEffect } from 'react';
import { Toast, _subscribeToast } from '@/components/ui/toast';
import type { ToastType } from '@/components/ui/toast';

/**
 * Toaster — mount once at the app root (inside App.tsx / BrowserRouter).
 *
 * Listens for toasts emitted via useToast() / _emitToast() from anywhere in
 * the component tree, even after the calling component has unmounted.
 */
export function Toaster() {
  const [toast, setToast] = useState<{
    message: string;
    type: ToastType;
  } | null>(null);

  useEffect(() => {
    return _subscribeToast((message, type) => {
      setToast({ message, type });
      // Auto-dismiss after 3.5 s
      setTimeout(() => setToast(null), 3500);
    });
  }, []);

  if (!toast) return null;

  return (
    <Toast
      message={toast.message}
      type={toast.type}
      onClose={() => setToast(null)}
    />
  );
}
