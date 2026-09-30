/**
 * Deciding which copy of a half-finished survey to open: the one saved on this
 * device, or the one on the server.
 *
 * Pure and framework-free on purpose. This is the decision that can silently
 * throw away an hour of a surveyor's work, so it is written somewhere it can
 * be enumerated and tested rather than buried in an effect.
 *
 * The three inputs:
 *
 *   localUpdatedAt     when this device last changed its draft
 *   localLastSyncedAt  when this device last PUSHED that draft to the server
 *   remoteUpdatedAt    when the server document last changed, by anyone
 *
 * The key comparison is remote-versus-lastSynced, NOT remote-versus-local.
 * Comparing raw timestamps would flag a conflict constantly: this device's own
 * push always makes the server newer than the local draft it came from. Only a
 * server change that happened AFTER this device last synced can have come from
 * somewhere else.
 */

export type DraftSource =
  /** Open the device's copy — it is the most recent. */
  | 'local'
  /** Open the server's copy — this device has nothing newer. */
  | 'remote'
  /** Both moved independently. Ask; never guess. */
  | 'conflict';

export interface DraftSourceInput {
  /** Device-clock ms of the local draft's last edit, or null when there is no local draft. */
  localUpdatedAt: number | null;
  /** Device-clock ms of this device's last confirmed push, or null if never. */
  localLastSyncedAt: number | null;
  /** Token this device wrote with its last confirmed push, or null if never. */
  localSyncToken: string | null;
  /** Token currently on the server document, or null if none was ever written. */
  remoteSyncToken: string | null;
}

/**
 * "Did anyone else write since this device last synced?" is answered by a
 * TOKEN, never by comparing timestamps. Each push writes a fresh random token
 * to the server and remembers it locally; if the server still holds that
 * token, nobody else has pushed since. Comparing the device clock against the
 * server clock would break on any phone whose clock is a few minutes off —
 * hiding another device's work, or inventing conflicts.
 *
 * The only timestamp comparison left is local-vs-local (draft edit vs this
 * device's last push): one clock, so safe.
 *
 * Reviewer actions never touch the token, so an approver requesting changes is
 * not mistaken for another device editing the answers.
 */
export function chooseDraftSource({
  localUpdatedAt,
  localLastSyncedAt,
  localSyncToken,
  remoteSyncToken,
}: DraftSourceInput): DraftSource {
  // Nothing on this device — whatever the server has is all there is.
  if (localUpdatedAt === null) return 'remote';

  // Never pushed from here: the local copy is the only place this work lives.
  // This is also every existing draft on the day the feature is switched on —
  // treating that as a conflict would prompt every engineer in the field.
  if (localSyncToken === null) return 'local';

  // Server still holds this device's token: nobody else has pushed since.
  if (remoteSyncToken === localSyncToken) return 'local';

  // Someone else pushed. Ask only if this device also has work it never sent.
  const localHasUnsynced = localUpdatedAt > (localLastSyncedAt ?? 0);
  return localHasUnsynced ? 'conflict' : 'remote';
}

/** Metadata owned by submission and review, never by an autosave. */
const NON_ANSWER_KEYS = [
  'status', 'reviewNotes', 'reviewedBy', 'reviewedByName', 'reviewedAt',
  'submittedBy', 'submittedByName', 'submittedAt', 'draftSyncToken',
] as const;

/**
 * Deep copy with every undefined removed. Firestore rejects undefined field
 * values (this project does not set ignoreUndefinedProperties), and that
 * rejection is client-side, so Firestore never retries it — one half-filled
 * entry would silently stop every autosave. Dates, nulls and arrays are kept;
 * array holes become null so indices never shift.
 */
export function stripUndefinedDeep<T>(value: T): T {
  if (value === null || value instanceof Date || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return value.map((v) => (v === undefined ? null : stripUndefinedDeep(v))) as unknown as T;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (v !== undefined) out[k] = stripUndefinedDeep(v);
  }
  return out as T;
}

/**
 * What an autosave may write: answers only, plus the fresh sync token. Status
 * is set by saveProgress itself; review and submission metadata belong to
 * those flows, and re-writing them from a local copy could put a stale value
 * back over a reviewer's newer one.
 */
export function buildAutosavePayload<T extends object>(
  data: T,
  token: string,
): Partial<T> & { draftSyncToken: string } {
  const copy: Record<string, unknown> = { ...(data as Record<string, unknown>) };
  for (const key of NON_ANSWER_KEYS) delete copy[key];
  return { ...stripUndefinedDeep(copy), draftSyncToken: token } as Partial<T> & { draftSyncToken: string };
}

/**
 * Firestore timestamps arrive as Date; drafts store epoch ms. Normalises to ms
 * so the comparison above never silently compares a Date with a number.
 */
export function toMillis(value: Date | number | null | undefined): number | null {
  if (value == null) return null;
  const ms = value instanceof Date ? value.getTime() : value;
  return Number.isFinite(ms) ? ms : null;
}

/**
 * A cheap value that changes whenever the survey's contents do, for feeding
 * DebouncedSaver.
 *
 * Derived from the data rather than maintained as a counter bumped at each
 * edit site. A counter is O(1), but a new edit path added later that forgot to
 * bump it would silently stop the survey syncing — a failure nobody would
 * notice until an engineer lost work. This cannot be forgotten.
 *
 * The caller holds it in a useMemo keyed on the survey object, so the walk
 * happens once per edit, not once per render — the same order of work the
 * existing 500ms IndexedDB draft save already does on every edit.
 *
 * A 32-bit FNV-1a hash. Not cryptographic and not trying to be: it only has to
 * change when the content changes, and a collision would at worst skip one
 * intermediate save, with the next edit correcting it.
 */
export function surveySignature(data: unknown): string {
  const json = JSON.stringify(data) ?? '';
  let hash = 0x811c9dc5;
  for (let i = 0; i < json.length; i++) {
    hash ^= json.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  // Length alongside the hash — two different payloads that collide are then
  // still distinguished unless they are also the same size.
  return `${json.length}:${(hash >>> 0).toString(36)}`;
}
