import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/firebase/config';

/**
 * Delta autosave: send only the top-level survey fields that changed since the
 * last push, instead of the whole survey every time.
 *
 * A survey is tens of KB; a typical edit touches one field. On a slow link the
 * difference decides whether a save lands in one second or twenty.
 *
 * Top-level granularity on purpose: Firestore replaces a map/array field as a
 * whole anyway, and diffing deeper would need dotted field paths that break on
 * arrays (feeders, relays…). One changed feeder re-sends the feeder list —
 * still far smaller than the whole document.
 */

export type FieldSignatures = Map<string, string>;

/**
 * Canonical form for comparing field values: object keys sorted, and a key
 * whose value is null or undefined dropped (so "empty" and "missing" are equal).
 * Dates compare by instant.
 *
 * Plain JSON.stringify is NOT safe here: identical data built in different
 * places lists its keys in different orders (a feeder created in the UI vs the
 * same feeder read back from Firestore), and an unanswered field is absent on
 * one side and null on the other. Either made an unchanged section look
 * changed, so a stale copy kept re-sending it and overwrote fresh answers.
 */
function canonical(value: unknown): unknown {
  if (value instanceof Date) return { $date: value.getTime() };
  if (Array.isArray(value)) return value.map((v) => (v === undefined ? null : canonical(v)));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as object).sort()) {
      const v = (value as Record<string, unknown>)[k];
      if (v !== null && v !== undefined) out[k] = canonical(v);
    }
    return out;
  }
  return value;
}

function sig(value: unknown): string {
  return JSON.stringify(canonical(value)) ?? 'null';
}

/** Per-field signatures of a payload, for comparing the next push against. */
export function signFields(payload: Record<string, unknown>): FieldSignatures {
  const out: FieldSignatures = new Map();
  for (const [k, v] of Object.entries(payload)) out.set(k, sig(v));
  return out;
}

/**
 * The fields of `payload` that differ from `last`. `alwaysSend` keys (the sync
 * token) are included regardless — they are what tells other devices a save
 * happened.
 */
export function changedFields(
  payload: Record<string, unknown>,
  last: FieldSignatures,
  alwaysSend: readonly string[] = [],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload)) {
    if (alwaysSend.includes(k) || last.get(k) !== sig(v)) out[k] = v;
  }
  return out;
}

/**
 * Writes just the given fields to the survey document — one write, not the two
 * saveProgress does (the parent work order's status only changes on the
 * open→in_progress transition, which saveProgress still handles).
 *
 * Only valid once the survey is in_progress: firestore.rules' engineer branch
 * requires the resulting status to be in_progress or pending_approval, and a
 * write that leaves an 'open' document 'open' is refused. Callers fall back to
 * saveProgress otherwise.
 */
export async function writeSurveyFields(
  surveyReportId: string,
  fields: Record<string, unknown>,
): Promise<void> {
  await updateDoc(doc(db, 'surveyReports', surveyReportId), {
    ...fields,
    updatedAt: serverTimestamp(),
  });
}

/**
 * Per-field adopt of another device's save — the fix for typed answers being
 * wiped.
 *
 * A field is taken from the server ONLY when the server changed it (its value
 * differs from the last server version this device knew) AND this device has
 * not changed it locally (its local value still equals that last known server
 * value). A field the user edited here is never overwritten — it is pushed on
 * the next save and wins instead.
 *
 * Replacing whole sections (as before) lost anything typed but not yet sent,
 * which with a Feeder List meant every in-progress feeder field.
 *
 * Returns the SAME object when nothing is adopted, so callers can skip a
 * state update and the form does not re-render.
 */
export function adoptRemoteFields<T extends object>(
  local: T,
  server: T,
  localSigs: FieldSignatures,
  serverSigs: FieldSignatures,
  knownSigs: FieldSignatures,
  /** Fields the user operated on here — never adopted over, whatever the values. */
  touched?: ReadonlySet<string>,
): T {
  let next: Record<string, unknown> | null = null;
  for (const [key, serverSig] of serverSigs) {
    if (key === 'draftSyncToken') continue;
    const known = knownSigs.get(key);
    const serverChanged   = serverSig !== known;
    // With interaction tracking, "untouched" means the user did not operate on
    // it here — not a value comparison, which stale copies can fool.
    const untouchedLocally = touched ? !touched.has(key) : localSigs.get(key) === known;
    if (serverChanged && untouchedLocally) {
      next ??= { ...(local as Record<string, unknown>) };
      next[key] = (server as Record<string, unknown>)[key];
    }
  }
  return (next as T | null) ?? local;
}

// ─── Filled-answer shield ─────────────────────────────────────────────────────

/** An answer nobody has given yet. false and 0 are real answers, not empty. */
function isEmptyAnswer(v: unknown): boolean {
  return v === null || v === undefined
    || (typeof v === 'string' && v.trim() === '')
    || (Array.isArray(v) && v.length === 0);
}

/** How list items are matched across devices — never by position when an id exists. */
function itemKey(v: unknown, index: number): string {
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (typeof o['uid'] === 'string') return `uid:${o['uid']}`;
    if (typeof o['itemKey'] === 'string') return `item:${o['itemKey']}`;
    if (typeof o['url'] === 'string') return `url:${o['url']}`;
  }
  return `i:${index}`;
}

function shieldValue(local: unknown, server: unknown, base: unknown): unknown {
  // The rule: local is empty, the server has an answer, and this device never
  // saw that answer (its baseline was empty) — so the empty value here is not
  // a deliberate clear, just an old copy. Keep the server's answer.
  if (isEmptyAnswer(local) && !isEmptyAnswer(server) && isEmptyAnswer(base)) return server;
  if (local instanceof Date || local === null || typeof local !== 'object') return local;

  if (Array.isArray(local)) {
    const serverArr = Array.isArray(server) ? server : [];
    const baseArr   = Array.isArray(base) ? base : [];
    const serverBy  = new Map(serverArr.map((v, i) => [itemKey(v, i), v]));
    const baseBy    = new Map(baseArr.map((v, i) => [itemKey(v, i), v]));
    const out = local.map((v, i) => {
      const k = itemKey(v, i);
      return shieldValue(v, serverBy.get(k), baseBy.get(k));
    });
    // Items another device added that this device never saw: keep them. An
    // item this device DID see and removed is in its baseline, so it stays
    // removed.
    const localKeys = new Set(local.map((v, i) => itemKey(v, i)));
    serverArr.forEach((v, i) => {
      const k = itemKey(v, i);
      if (!k.startsWith('i:') && !localKeys.has(k) && !baseBy.has(k)) out.push(v);
    });
    return out;
  }

  const out: Record<string, unknown> = { ...(local as Record<string, unknown>) };
  const s = (server && typeof server === 'object' ? server : {}) as Record<string, unknown>;
  const b = (base && typeof base === 'object' ? base : {}) as Record<string, unknown>;
  for (const k of new Set([...Object.keys(out), ...Object.keys(s)])) {
    out[k] = shieldValue(out[k], s[k], b[k]);
  }
  return out;
}

/**
 * Filled-answer shield: a device can never blank out an answer it has never
 * seen filled.
 *
 * `server` is the latest server copy; `base` is the server copy this device's
 * form was built from. A field that is empty here, filled on the server, and
 * was empty in `base` came from an OLD copy (a stale draft, Firestore's
 * offline cache, a tab left open) — so the server's answer is kept, at every
 * depth, including inside each feeder, relay and transformer.
 *
 * A deliberate clear still works: if the user saw a value (it is in `base`)
 * and emptied it, `base` is not empty and the clear goes through.
 *
 * Returns the SAME object when nothing needed shielding.
 */
export function shieldFilledAnswers<T>(local: T, server: T, base: T): T {
  const out = shieldValue(local, server, base) as T;
  return sig(out) === sig(local) ? local : out;
}

// ─── Autosave plan ────────────────────────────────────────────────────────────

export type AutosavePlan =
  /** Nothing changed — write nothing at all. */
  | { kind: 'skip' }
  /** Survey already in progress — write just these fields, one document. */
  | { kind: 'fields'; fields: Record<string, unknown> }
  /** Still open / changes_requested — write just these fields via saveProgress,
   *  which also performs the status transition the rules require. */
  | { kind: 'progress'; fields: Record<string, unknown> };

/**
 * Decides what an autosave writes. BOTH paths send only changed fields.
 *
 * The open / changes_requested path used to send the ENTIRE survey. A device
 * opening the survey with an old copy (Firestore's offline cache from its last
 * session still reads status 'open') fired its first autosave ~2s after
 * opening and wrote that whole old copy over the other device's work — the
 * wipe on logging in to another device. With a delta on every path, a device
 * that has not typed anything writes nothing, whatever status it believes.
 */
export function planAutosave(
  payload: Record<string, unknown>,
  knownServer: FieldSignatures,
  status: string,
  /**
   * Fields the user actually operated on, on this device, since they were last
   * sent. When given, NOTHING outside this set is ever written — however
   * different it looks. A device can only change what its user touched.
   */
  touched?: ReadonlySet<string>,
): AutosavePlan {
  const all = changedFields(payload, knownServer, ['draftSyncToken']);
  const delta: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(all)) {
    if (k === 'draftSyncToken' || !touched || touched.has(k)) delta[k] = v;
  }
  if (Object.keys(delta).filter((k) => k !== 'draftSyncToken').length === 0) return { kind: 'skip' };
  return status === 'in_progress' ? { kind: 'fields', fields: delta } : { kind: 'progress', fields: delta };
}

// ── Per-input touch tracking ────────────────────────────────────────────────
// A device may only change the inputs its user actually operated on. Each
// edit records the exact input path (object keys + list-item ids, see
// itemKey); a save lays ONLY those inputs over the latest server copy, and
// adopt shows the server copy with only those inputs kept. A value that merely
// LOOKS different (stale cache, old draft) is never sent.

/** One input's address: object keys and list-item keys. */
export type InputPath = string[];
/** Top-level field → the touched input paths under it (keyed by JSON). */
export type TouchedInputs = Map<string, Map<string, InputPath>>;

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date);
}

/**
 * List items by identity: records by itemKey, plain values (photo URLs) by the
 * value itself — so replacing one URL is one input, not the whole list.
 */
function listEntries(list: unknown[]): Map<string, { v: unknown; i: number }> {
  const out = new Map<string, { v: unknown; i: number }>();
  list.forEach((v, i) => {
    let k = isRecord(v) ? itemKey(v, i) : `v:${JSON.stringify(v)}`;
    while (out.has(k)) k += '+';   // duplicates stay distinct
    out.set(k, { v, i });
  });
  return out;
}

function childOf(v: unknown, seg: string): unknown {
  if (Array.isArray(v)) return listEntries(v).get(seg)?.v;
  return isRecord(v) ? v[seg] : undefined;
}

/** The exact input paths that differ between two values. */
export function changedInputPaths(prev: unknown, next: unknown, prefix: InputPath = []): InputPath[] {
  if (sig(prev) === sig(next)) return [];
  const out: InputPath[] = [];
  if (isRecord(prev) && isRecord(next)) {
    for (const k of new Set([...Object.keys(prev), ...Object.keys(next)])) {
      out.push(...changedInputPaths(prev[k], next[k], [...prefix, k]));
    }
  } else if (Array.isArray(prev) && Array.isArray(next)) {
    const a = listEntries(prev);
    const b = listEntries(next);
    for (const k of new Set([...a.keys(), ...b.keys()])) {
      out.push(...changedInputPaths(a.get(k)?.v, b.get(k)?.v, [...prefix, k]));
    }
  }
  // A leaf, a primitive list, or a pure reorder: the whole value is the input.
  return out.length ? out : [prefix];
}

/** `target` with the input at `path` taken from `source`. Never mutates. */
function applyInputPath(target: unknown, source: unknown, path: InputPath): unknown {
  if (path.length === 0) return source;
  const [seg, ...rest] = path;
  if (Array.isArray(source)) {
    // Nothing on the server here to protect — take ours whole.
    if (!Array.isArray(target)) return source;
    const list = [...target];
    const at = listEntries(list).get(seg)?.i ?? -1;
    const item = listEntries(source).get(seg);
    if (!item) {
      // Removed here: the removal itself is the edit.
      if (at >= 0 && rest.length === 0) list.splice(at, 1);
      return list;
    }
    // Added here: at the position it has on this device.
    if (at < 0) list.splice(Math.min(item.i, list.length), 0, item.v);
    else list[at] = applyInputPath(list[at], item.v, rest);
    return list;
  }
  if (isRecord(source)) {
    if (!isRecord(target)) return source;
    const obj = { ...target };
    const v = applyInputPath(obj[seg], childOf(source, seg), rest);
    if (v === undefined) delete obj[seg];
    else obj[seg] = v;
    return obj;
  }
  // The container was cleared here — that clear is the edit.
  return source;
}

export function applyInputPaths(server: unknown, local: unknown, paths: Iterable<InputPath>): unknown {
  let out = server;
  for (const p of paths) out = applyInputPath(out, local, p);
  return out;
}

/** Records every input that differs between prev and next under `keys`. */
export function recordTouches(touched: TouchedInputs, prev: object, next: object, keys: Iterable<string>): void {
  const a = prev as Record<string, unknown>;
  const b = next as Record<string, unknown>;
  for (const k of keys) {
    for (const p of changedInputPaths(a[k], b[k])) {
      let m = touched.get(k);
      if (!m) touched.set(k, (m = new Map()));
      m.set(JSON.stringify(p), p);
    }
  }
}

/** The server copy with ONLY this device's touched inputs laid over it. */
export function composeTouched<T extends object>(server: T, local: T, touched: TouchedInputs): T {
  const out = { ...(server as Record<string, unknown>) };
  const mine = local as Record<string, unknown>;
  for (const [k, paths] of touched) out[k] = applyInputPaths(out[k], mine[k], paths.values());
  return out as T;
}

/**
 * Adopt: every field becomes the server's value, except the inputs touched
 * here, which keep this device's value. Returns `local` itself when nothing
 * changes, so the form does not re-render.
 */
export function adoptWithTouches<T extends object>(local: T, server: T, keys: Iterable<string>, touched: TouchedInputs): T {
  const src = server as Record<string, unknown>;
  const mine = local as Record<string, unknown>;
  let next: Record<string, unknown> | null = null;
  for (const k of keys) {
    const paths = touched.get(k);
    const want = paths ? applyInputPaths(src[k], mine[k], paths.values()) : src[k];
    if (sig(want) !== sig(mine[k])) {
      next ??= { ...mine };
      next[k] = want;
    }
  }
  return (next ?? local) as T;
}
