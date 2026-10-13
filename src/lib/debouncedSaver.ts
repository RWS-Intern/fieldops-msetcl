/**
 * Debounced background saver — the scheduling logic, with no React in it.
 *
 * Deliberately framework-free. The timing rules below are the part that is
 * easy to get subtly wrong and impossible to eyeball, so they live somewhere
 * they can be driven by a fake clock and asserted directly; the React hook
 * (useDebouncedRemoteSave) is a thin binding over this.
 *
 * Built for the survey wizard, where an engineer spends 30–45 minutes on a
 * substation with unreliable signal. The local IndexedDB draft (500ms) remains
 * the crash-recovery buffer; this is the slower push that makes the work
 * survive the DEVICE, so it can be resumed on another one.
 *
 * The five rules:
 *
 *   1. TRAILING DEBOUNCE WITH A MAX-WAIT CAP. A plain debounce never fires
 *      while someone types steadily — a surveyor working a long step without
 *      pausing would sync nothing at all. The cap forces a save through
 *      however continuous the editing is, and is NOT reset per keystroke;
 *      that is what makes it a ceiling rather than a second debounce.
 *
 *   2. FLUSH ON DEMAND, for checkpoints the caller knows about (moving
 *      between wizard steps, the page being hidden). Worth more than a timer.
 *
 *   3. NOTHING CHANGED, NOTHING WRITTEN. Saves are compared against the last
 *      signature CONFIRMED saved, so an idle wizard left open does not write
 *      every interval forever.
 *
 *   4. NEVER TWO WRITES IN FLIGHT. A request arriving mid-save is coalesced
 *      into one follow-up rather than queued, so a slow link cannot build a
 *      backlog of redundant writes.
 *
 *   5. THE SIGNATURE THAT WAS SENT IS THE ONE MARKED SAVED — not whatever the
 *      live value is when the request returns. Edits made while a save was in
 *      the air must stay dirty, or they are silently dropped.
 *
 * A failed save is NOT retried on a timer. Firestore's own offline persistence
 * queues and replays writes already; retrying on top of it would duplicate
 * work the SDK does better. The failure is reported so the caller can show it.
 */

export type Signature = string | number;

export interface DebouncedSaverOptions {
  /** Performs the write. Must reject on failure — resolving marks data saved. */
  save: () => Promise<void>;
  /** Quiet period before a save fires. */
  debounceMs?: number;
  /** Longest an edit may go unsaved, however continuous the editing. */
  maxWaitMs?: number;
  /** Called whenever observable state changes, so a UI can re-render. */
  onStateChange?: (state: SaverState) => void;
  /** Injectable for tests. Defaults to the global timers. */
  setTimeoutFn?: (fn: () => void, ms: number) => unknown;
  clearTimeoutFn?: (handle: unknown) => void;
}

export interface SaverState {
  saving: boolean;
  lastSavedAt: Date | null;
  error: Error | null;
  /**
   * The signature last CONFIRMED written. The caller derives "dirty" by
   * comparing its live signature against this, rather than the saver
   * publishing a dirty flag on every keystroke — that would mean emitting
   * state synchronously from setSignature, which a React binding cannot do
   * from inside an effect.
   */
  savedSignature: Signature | null;
}

export class DebouncedSaver {
  private readonly save: () => Promise<void>;
  private readonly debounceMs: number;
  private readonly maxWaitMs: number;
  private readonly onStateChange?: (state: SaverState) => void;
  private readonly setTimeoutFn: (fn: () => void, ms: number) => unknown;
  private readonly clearTimeoutFn: (handle: unknown) => void;

  /** Current data signature. */
  private signature: Signature | null = null;
  /** Signature last CONFIRMED written. */
  private savedSignature: Signature | null = null;
  /** Signature handed to the in-flight save — see rule 5. */
  private inFlightSignature: Signature | null = null;

  private debounceHandle: unknown = null;
  private maxWaitHandle: unknown = null;
  private saving = false;
  private rerun = false;
  private disposed = false;

  private lastSavedAt: Date | null = null;
  private error: Error | null = null;

  constructor(options: DebouncedSaverOptions) {
    this.save           = options.save;
    this.debounceMs     = options.debounceMs ?? 25_000;
    this.maxWaitMs      = options.maxWaitMs  ?? 60_000;
    this.onStateChange  = options.onStateChange;
    this.setTimeoutFn   = options.setTimeoutFn
      ?? ((fn, ms) => setTimeout(fn, ms) as unknown);
    this.clearTimeoutFn = options.clearTimeoutFn
      ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  }

  /** Observable state, for a UI binding. */
  getState(): SaverState {
    return {
      saving:         this.saving,
      lastSavedAt:    this.lastSavedAt,
      error:          this.error,
      savedSignature: this.savedSignature,
    };
  }

  private emit(): void {
    this.onStateChange?.(this.getState());
  }

  /**
   * Records that the data changed and schedules a save.
   *
   * Calling this with an unchanged signature is a no-op, so it is safe to call
   * on every render.
   */
  setSignature(next: Signature): void {
    if (this.disposed) return;
    if (next === this.signature) return;

    this.signature = next;

    if (next === this.savedSignature) {
      // Edited back to the last-saved value — nothing to write, and any
      // pending timers would now write a no-op.
      this.cancelTimers();
      return;
    }

    // Rule 1 — restart the quiet period …
    if (this.debounceHandle !== null) this.clearTimeoutFn(this.debounceHandle);
    this.debounceHandle = this.setTimeoutFn(() => { void this.run(); }, this.debounceMs);

    // … but let one ceiling run to completion.
    if (this.maxWaitHandle === null) {
      this.maxWaitHandle = this.setTimeoutFn(() => { void this.run(); }, this.maxWaitMs);
    }
  }

  /** Saves now if there is anything to save. Rule 2. */
  flush(): void {
    if (this.disposed) return;
    void this.run();
  }

  /** Stops all timers. Does NOT save — the caller flushes at its own checkpoints. */
  dispose(): void {
    this.disposed = true;
    this.cancelTimers();
  }

  private cancelTimers(): void {
    if (this.debounceHandle !== null) { this.clearTimeoutFn(this.debounceHandle); this.debounceHandle = null; }
    if (this.maxWaitHandle  !== null) { this.clearTimeoutFn(this.maxWaitHandle);  this.maxWaitHandle  = null; }
  }

  private async run(): Promise<void> {
    if (this.disposed) return;
    this.cancelTimers();

    // Rule 3.
    if (this.signature === this.savedSignature) return;

    // Rule 4.
    if (this.saving) { this.rerun = true; return; }

    this.saving = true;
    this.inFlightSignature = this.signature;
    this.emit();

    try {
      await this.save();
      // Rule 5 — mark what was SENT, not what is live now.
      this.savedSignature = this.inFlightSignature;
      this.lastSavedAt = new Date();
      this.error = null;
    } catch (err) {
      this.error = err instanceof Error ? err : new Error(String(err));
    } finally {
      this.saving = false;
      this.inFlightSignature = null;

      const needsFollowUp = this.rerun && this.signature !== this.savedSignature;
      this.rerun = false;
      this.emit();

      // Schedule rather than recurse: a fast typist must not drive this into
      // a tight loop of back-to-back writes.
      if (needsFollowUp && !this.disposed) {
        this.debounceHandle = this.setTimeoutFn(() => { void this.run(); }, this.debounceMs);
      }
    }
  }
}
