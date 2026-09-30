/**
 * Timing tests for DebouncedSaver, driven by a fake clock.
 *
 * These are the assertions that make the debounce trustworthy: real timers
 * would make the suite take minutes and still not prove the ordering. The
 * saver takes its timer functions by injection precisely so this can exist.
 *
 * Run via scripts/runFeatureTests.mjs alongside the rest.
 */
import { DebouncedSaver } from '@/lib/debouncedSaver';

// ─── Fake clock ───────────────────────────────────────────────────────────────

interface ScheduledTask { id: number; at: number; fn: () => void }

class FakeClock {
  private now = 0;
  private nextId = 1;
  private tasks: ScheduledTask[] = [];

  setTimeout = (fn: () => void, ms: number): unknown => {
    const id = this.nextId++;
    this.tasks.push({ id, at: this.now + ms, fn });
    return id;
  };

  clearTimeout = (handle: unknown): void => {
    this.tasks = this.tasks.filter((t) => t.id !== handle);
  };

  /** Advances time, running every task due, in chronological order. */
  advance(ms: number): void {
    const target = this.now + ms;
    for (;;) {
      const due = this.tasks
        .filter((t) => t.at <= target)
        .sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      this.tasks = this.tasks.filter((t) => t.id !== due.id);
      this.now = due.at;
      due.fn();
    }
    this.now = target;
  }

  get pending(): number { return this.tasks.length; }
}

/** Lets the microtask queue drain so awaited saves settle. */
const settle = () => new Promise<void>((r) => setImmediate(r));

// ─── Harness ──────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function ok(name: string, cond: boolean, detail?: string): void {
  if (cond) { passed++; console.log(`  ok   ${name}`); }
  else { failed++; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`); }
}
function eq(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  ok(name, a === e, a === e ? undefined : `expected ${e}, got ${a}`);
}

interface Rig {
  clock: FakeClock;
  saver: DebouncedSaver;
  /** How many times save() was invoked. */
  calls: () => number;
  /** Resolves the save currently in flight. */
  resolve: () => void;
  /** Rejects the save currently in flight. */
  reject: (err?: Error) => void;
}

function rig(opts: { manual?: boolean; debounceMs?: number; maxWaitMs?: number } = {}): Rig {
  const clock = new FakeClock();
  let calls = 0;
  let pendingResolve: (() => void) | null = null;
  let pendingReject:  ((e: Error) => void) | null = null;

  const saver = new DebouncedSaver({
    debounceMs: opts.debounceMs ?? 1000,
    maxWaitMs:  opts.maxWaitMs  ?? 5000,
    setTimeoutFn:   clock.setTimeout,
    clearTimeoutFn: clock.clearTimeout,
    save: () => {
      calls++;
      // Manual mode keeps the save in flight so mid-save behaviour is testable.
      if (!opts.manual) return Promise.resolve();
      return new Promise<void>((res, rej) => { pendingResolve = res; pendingReject = rej; });
    },
  });

  return {
    clock, saver,
    calls: () => calls,
    resolve: () => { pendingResolve?.(); pendingResolve = null; },
    reject: (err = new Error('offline')) => { pendingReject?.(err); pendingReject = null; },
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

export async function runSaverTests(): Promise<number> {
  console.log('\n── DebouncedSaver (fake clock) ──────────────────────────');

  // Rule 1 — quiet period.
  {
    const r = rig();
    r.saver.setSignature('a');
    r.clock.advance(999);
    eq('does not save before the quiet period elapses', r.calls(), 0);
    r.clock.advance(1);
    await settle();
    eq('saves once the quiet period elapses', r.calls(), 1);
  }

  // Rule 1 — typing keeps resetting the quiet period …
  {
    const r = rig();
    for (let i = 0; i < 4; i++) {
      r.saver.setSignature(`edit-${i}`);
      r.clock.advance(900);            // always less than the 1000ms debounce
    }
    eq('continuous typing keeps deferring the debounce', r.calls(), 0);

    // … but the ceiling still forces one through.
    r.clock.advance(1500);             // total now past maxWaitMs
    await settle();
    ok('the max-wait ceiling forces a save through', r.calls() >= 1,
      `saves=${r.calls()}`);
  }

  // Rule 3 — nothing changed, nothing written.
  {
    const r = rig();
    r.saver.setSignature('a');
    r.clock.advance(1000);
    await settle();
    eq('first save happens', r.calls(), 1);

    r.clock.advance(60_000);
    await settle();
    eq('an idle saver never writes again', r.calls(), 1);

    r.saver.setSignature('a');         // same value
    r.clock.advance(60_000);
    await settle();
    eq('re-setting the same signature writes nothing', r.calls(), 1);
  }

  // Editing back to the saved value cancels the pending write.
  {
    const r = rig();
    r.saver.setSignature('a');
    r.clock.advance(1000);
    await settle();
    r.saver.setSignature('b');
    r.saver.setSignature('a');         // undone
    r.clock.advance(60_000);
    await settle();
    eq('editing back to the saved value cancels the write', r.calls(), 1);
  }

  // Rule 2 — flush.
  {
    const r = rig();
    r.saver.setSignature('a');
    r.saver.flush();
    await settle();
    eq('flush saves immediately', r.calls(), 1);

    r.saver.flush();
    await settle();
    eq('flush with nothing dirty writes nothing', r.calls(), 1);
  }

  // Rule 4 — never two in flight.
  {
    const r = rig({ manual: true });
    r.saver.setSignature('a');
    r.saver.flush();
    await settle();
    eq('one save in flight', r.calls(), 1);

    r.saver.setSignature('b');
    r.saver.flush();                    // arrives mid-save
    await settle();
    eq('a second save is coalesced, not started', r.calls(), 1);

    r.resolve();
    await settle();
    r.clock.advance(1000);              // the scheduled follow-up
    await settle();
    eq('the coalesced change is saved afterwards', r.calls(), 2);
  }

  // Rule 5 — an edit made mid-save stays dirty.
  {
    const r = rig({ manual: true });
    r.saver.setSignature('a');
    r.saver.flush();
    await settle();

    r.saver.setSignature('b');          // changed while 'a' was in the air
    r.resolve();                        // 'a' lands
    await settle();

    eq('the signature that was SENT is what counts as saved',
      r.saver.getState().savedSignature, 'a');
    r.clock.advance(1000);
    await settle();
    eq('the mid-save edit is written next', r.calls(), 2);
  }

  // Failure handling.
  {
    const r = rig({ manual: true });
    r.saver.setSignature('a');
    r.saver.flush();
    await settle();
    r.reject(new Error('network down'));
    await settle();

    const st = r.saver.getState();
    ok('a failed save records the error', st.error?.message === 'network down');
    eq('a failed save does NOT mark the data saved', st.savedSignature, null);
    ok('a failed save is not retried on a timer — Firestore already replays it',
      r.clock.pending === 0, `pending timers=${r.clock.pending}`);
  }

  // A later success clears the error.
  {
    const r = rig({ manual: true });
    r.saver.setSignature('a');
    r.saver.flush();
    await settle();
    r.reject();
    await settle();
    ok('error is set after failure', r.saver.getState().error !== null);

    r.saver.flush();
    await settle();
    r.resolve();
    await settle();
    ok('a later success clears the error', r.saver.getState().error === null);
    eq('and marks the data saved', r.saver.getState().savedSignature, 'a');
  }

  // dispose() stops everything.
  {
    const r = rig();
    r.saver.setSignature('a');
    r.saver.dispose();
    eq('dispose cancels pending timers', r.clock.pending, 0);
    r.clock.advance(60_000);
    await settle();
    eq('a disposed saver never writes', r.calls(), 0);

    r.saver.setSignature('b');
    r.saver.flush();
    await settle();
    eq('a disposed saver ignores flush', r.calls(), 0);
  }

  console.log(`\n${failed === 0 ? 'ALL PASSED' : 'FAILURES'} — ${passed} passed, ${failed} failed`);
  return failed;
}
