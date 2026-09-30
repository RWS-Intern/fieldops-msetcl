import { useEffect, useRef, useState } from 'react';
import { DebouncedSaver } from '@/lib/debouncedSaver';
import type { SaverState, Signature } from '@/lib/debouncedSaver';

/**
 * React binding for DebouncedSaver — see that file for the timing rules and
 * why they live outside React (so they can be driven by a fake clock).
 *
 * INERT UNTIL ENABLED. With `enabled: false` no saver is constructed, no
 * timers start, no listeners are registered and `save` is never called. That
 * is deliberate rather than defensive: this ships into a live app behind a
 * kill switch, and "off" has to mean the code truly does not run.
 *
 * Also flushes when the page is hidden or unloaded — screen lock, tab close,
 * backgrounded browser and battery death are the last moments anything can
 * run, and waiting out a 25-second timer there loses the work this exists to
 * protect.
 */

export interface UseDebouncedRemoteSaveOptions {
  /** Master switch. False means the hook does nothing at all. */
  enabled: boolean;
  /**
   * Performs the write. Must reject on failure — a resolved promise is taken
   * as "this is on the server now".
   */
  save: () => Promise<void>;
  /**
   * Cheap value that changes whenever the data does — a revision counter, or
   * a hash. Compared by equality, never deep-compared: this is evaluated on
   * every render, and stringifying a whole survey each time would be wasteful.
   */
  signature: Signature;
  /** Quiet period before a save fires. Default 25s. */
  debounceMs?: number;
  /** Longest an edit may go unsaved, however continuous the typing. Default 60s. */
  maxWaitMs?: number;
}

export interface UseDebouncedRemoteSaveResult extends SaverState {
  /** True when the current signature has not reached the server yet. */
  dirty: boolean;
  /** Saves immediately if dirty — for step changes and other checkpoints. */
  flush: () => void;
}

const IDLE: SaverState = {
  saving: false, lastSavedAt: null, error: null, savedSignature: null,
};

export function useDebouncedRemoteSave({
  enabled,
  save,
  signature,
  debounceMs,
  maxWaitMs,
}: UseDebouncedRemoteSaveOptions): UseDebouncedRemoteSaveResult {
  const [state, setState] = useState<SaverState>(IDLE);
  const saverRef = useRef<DebouncedSaver | null>(null);

  // Held in a ref so the saver always calls the CURRENT closure. Rebuilding
  // the saver whenever `save` changes identity would reset its debounce on
  // every render and mean it never fires.
  //
  // Updated in an effect rather than during render: writing a ref while
  // rendering is what react-hooks/refs forbids, and it is safe here because
  // the saver only ever calls through this from a timer, long after mount.
  const saveRef = useRef(save);
  useEffect(() => { saveRef.current = save; }, [save]);

  // Construct and tear down with `enabled` only — never with `save` or the
  // signature, both of which change constantly.
  useEffect(() => {
    if (!enabled) {
      // No setState here: the hook RETURNS IDLE while disabled (see below),
      // so there is nothing to reset and nothing to write from an effect.
      saverRef.current = null;
      return;
    }

    const saver = new DebouncedSaver({
      save: () => saveRef.current(),
      debounceMs,
      maxWaitMs,
      onStateChange: setState,
    });
    saverRef.current = saver;

    return () => {
      saver.dispose();
      saverRef.current = null;
    };
  }, [enabled, debounceMs, maxWaitMs]);

  // Feed the signature through on every change.
  useEffect(() => {
    saverRef.current?.setSignature(signature);
  }, [signature]);

  // Last chance to run before the page goes away.
  useEffect(() => {
    if (!enabled) return;

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') saverRef.current?.flush();
    };
    const onPageHide = () => { saverRef.current?.flush(); };

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, [enabled]);

  // Derived rather than stored: comparing the live signature against the last
  // confirmed one is exact, and costs nothing, whereas having the saver push a
  // dirty flag would mean a setState on every keystroke.
  const effective = enabled ? state : IDLE;

  return {
    ...effective,
    dirty: enabled && signature !== effective.savedSignature,
    flush: () => saverRef.current?.flush(),
  };
}
