/**
 * Exhaustive per-input safety test for cross-device autosave.
 *
 * Enumerates EVERY answer leaf in a fully populated survey (every feeder,
 * relay, transformer, capacitor bank, cable run, BOQ line, checklist, ACDB/DCDB
 * and sign-off field) and, for each one individually, checks the three ways a
 * typed value could be lost:
 *
 *   1. ROUND-TRIP — saved to Firestore and read back through mapSurveyReport,
 *      the value is unchanged.
 *   2. NO WIPE    — the field is edited on this device, then a save from
 *      another device arrives: the edit survives.
 *   3. SENT       — editing the field makes the delta save include it.
 *
 * No sampling: a single failing path is reported by name.
 */
import { buildPopulatedSurvey } from './ssrSurveyWalk';
import { buildAutosavePayload } from '@/lib/surveyDraftSync';
import { stripLocalPhotoRefs } from '@/lib/surveySubmitQueue';
import { mapSurveyReport } from '@/hooks/useSurveyReport';
import {
  signFields, changedFields, adoptRemoteFields, shieldFilledAnswers, planAutosave,
  recordTouches, composeTouched, adoptWithTouches, type TouchedInputs,
} from '@/lib/surveyDelta';
import type { SurveyReport } from '@/types';

type Obj = Record<string, unknown>;

/** What Firestore does to a written value: Dates come back as Timestamps. */
function throughFirestore(v: unknown): unknown {
  if (v instanceof Date) { const d = v; return { toDate: () => d }; }
  if (Array.isArray(v)) return v.map(throughFirestore);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v as Obj).map(([k, x]) => [k, throughFirestore(x)]));
  return v;
}

const payloadOf = (s: SurveyReport) =>
  buildAutosavePayload(stripLocalPhotoRefs(s), 'tok') as Obj;

/** Every path to a leaf (primitive, null or Date), e.g. ["feeders",0,"diStatusPoints"]. */
function leafPaths(v: unknown, path: (string | number)[] = []): (string | number)[][] {
  if (v === null || v instanceof Date || typeof v !== 'object') return [path];
  if (Array.isArray(v)) return v.flatMap((x, i) => leafPaths(x, [...path, i]));
  return Object.entries(v as Obj).flatMap(([k, x]) => leafPaths(x, [...path, k]));
}

function getAt(o: unknown, path: (string | number)[]): unknown {
  return path.reduce<unknown>((acc, k) => (acc == null ? acc : (acc as Obj)[k as string]), o);
}

/** Deep copy with one leaf replaced. */
function setAt<T>(o: T, path: (string | number)[], value: unknown): T {
  if (path.length === 0) return value as T;
  const [head, ...rest] = path;
  const copy: Obj | unknown[] = Array.isArray(o) ? [...o] : { ...(o as Obj) };
  (copy as Obj)[head as string] = setAt((o as Obj)[head as string], rest, value);
  return copy as T;
}

/** A different value of the same kind — what a user typing a new answer produces. */
function editedValue(old: unknown, n: number): unknown {
  if (old instanceof Date) return new Date(old.getTime() + 86_400_000 * (n + 1));
  if (typeof old === 'number') return old + 1000 + n;
  if (typeof old === 'boolean') return !old;
  if (typeof old === 'string') return `${old}-edited-${n}`;
  return `answer-${n}`;   // null / unanswered
}

const same = (a: unknown, b: unknown) =>
  JSON.stringify(a instanceof Date ? a.getTime() : a) === JSON.stringify(b instanceof Date ? b.getTime() : b);

export function runAllInputsTests(): number {
  console.log('\n── 9. Every input, one by one ───────────────────────────');

  const base = buildPopulatedSurvey();
  const basePayload = payloadOf(base);
  // What the app really compares against: the SERVER copy as read back through
  // mapSurveyReport (different key order, nulls where the UI has nothing).
  const serverOf = (sv: SurveyReport) => mapSurveyReport('x', throughFirestore(payloadOf(sv)) as Obj);
  const known = signFields(payloadOf(serverOf(base)));

  // Leaves under answer fields only (the payload already excludes metadata).
  const paths = Object.keys(basePayload)
    .filter((k) => k !== 'draftSyncToken')
    .flatMap((k) => leafPaths(basePayload[k], [k]));

  const failures: string[] = [];

  // 0. No false "changed": an UNEDITED local copy must match the server copy
  // field for field, or stale copies re-send whole sections and overwrite.
  // 0c. LOGIN ON ANOTHER DEVICE: it opens the survey holding an old copy (its
  // offline cache), types nothing, and its autosave fires. In EVERY status it
  // must write nothing — the open/changes_requested path used to send the
  // whole old survey here and wipe the other device's work.
  for (const status of ['open', 'in_progress', 'changes_requested', 'pending_approval', 'approved']) {
    const oldCopy = serverOf(base);   // what the device loaded
    const plan = planAutosave(payloadOf(oldCopy), signFields(payloadOf(oldCopy)), status);
    if (plan.kind !== 'skip') {
      failures.push(`LOGIN WIPE (status ${status}): an unedited device would write ${Object.keys(plan.fields).join(', ')}`);
    }
  }

  const falseDiffs = Object.keys(changedFields(basePayload, known)).filter((k) => k !== 'draftSyncToken');
  // 0b. Same, for data shaped the way the UI builds it: every object's keys
  // in a different order and every empty (null) field simply absent — which is
  // how a feeder created on the phone differs from the server's copy.
  const uiShaped = (v: unknown): unknown => {
    if (v === null || v instanceof Date || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map(uiShaped);
    const out: Obj = {};
    for (const k of Object.keys(v as Obj).reverse()) {
      const x = (v as Obj)[k];
      if (x !== null) out[k] = uiShaped(x);
    }
    return out;
  };
  const uiDiffs = Object.keys(changedFields(uiShaped(basePayload) as Obj, known)).filter((k) => k !== 'draftSyncToken');
  if (uiDiffs.length) {
    failures.push('FALSE CHANGE for UI-shaped data (key order / empty fields): ' + uiDiffs.join(', '));
  }

  if (falseDiffs.length) {
    failures.push('FALSE CHANGE on unedited sections (would overwrite fresh data): ' + falseDiffs.join(', '));
  }
  const sections = new Map<string, number>();
  // List-item identities (uid / itemKey / url) are not inputs — nobody types
  // them — and changing one makes a different item, so they are not used as
  // the "input operated on" in the per-input checks below.
  const isIdentity = (pa: (string | number)[]) => ['uid', 'itemKey', 'url'].includes(String(pa[pa.length - 1]));
  const inputPaths = paths.filter((pa) => !isIdentity(pa));
  const answerKeys = Object.keys(basePayload).filter((k) => k !== 'draftSyncToken');
  let perInputChecked = 0;

  paths.forEach((path, i) => {
    const name = path.join('.');
    const top = path[0] as string;
    sections.set(top, (sections.get(top) ?? 0) + 1);

    const newValue = editedValue(getAt(basePayload, path), i);
    const edited = setAt(base, path, newValue);
    const editedPayload = payloadOf(edited);

    // Skip leaves the payload builder deliberately drops (local:// photo refs).
    if (getAt(editedPayload, path) === undefined && newValue !== undefined) return;

    // 1. Round-trip
    const back = mapSurveyReport('x', throughFirestore(editedPayload) as Obj) as unknown as Obj;
    if (!same(getAt(back, path), newValue)) {
      failures.push(`ROUND-TRIP ${name}: sent ${JSON.stringify(newValue)}, read back ${JSON.stringify(getAt(back, path))}`);
    }

    // 2. No wipe — another device saved a DIFFERENT field meanwhile.
    const otherTop = top === 'surveyorName' ? 'difficultRunsNotes' : 'surveyorName';
    const remote = serverOf({ ...base, [otherTop]: `remote-${i}` } as SurveyReport);
    const adopted = adoptRemoteFields(
      edited as unknown as Obj, remote as unknown as Obj,
      signFields(payloadOf(edited)), signFields(payloadOf(remote)), known,
    );
    if (!same(getAt(adopted, path), newValue)) {
      failures.push(`WIPED ${name}: typed ${JSON.stringify(newValue)}, became ${JSON.stringify(getAt(adopted, path))}`);
    }

    // 2b. No wipe — even when the other device's save touches the SAME section.
    const remoteSame = serverOf(base);   // identical content, server key order
    const adoptedSame = adoptRemoteFields(
      edited as unknown as Obj, remoteSame as unknown as Obj,
      signFields(payloadOf(edited)), signFields(payloadOf(remoteSame)), known,
    );
    if (!same(getAt(adoptedSame, path), newValue)) {
      failures.push(`WIPED (same section) ${name}`);
    }

    // 4. SHIELD — a second device logs in holding an OLD copy where this input
    // was still empty. Whatever it pushes must keep the filled answer.
    // Identity fields (uid, itemKey, sr, url, caption) and photo lists are not
    // answers — photos have their own merge (section 7) — so they are skipped.
    const idLeaf = ['uid', 'itemKey', 'sr', 'url', 'caption'].includes(String(path[path.length - 1]))
      || path.includes('photos') || path.includes('signedPagePhotos');
    if (!idLeaf) {
    const filled = serverOf(edited) as unknown as SurveyReport;
    const staleCopy = setAt(base, path, null);
    const pushed = shieldFilledAnswers(staleCopy, filled, staleCopy);
    const kept = getAt(payloadOf(pushed), path);
    if (newValue !== null && !same(kept, getAt(payloadOf(filled), path))) {
      failures.push(`SHIELD FAILED ${name}: stale device would blank ${JSON.stringify(newValue)} → ${JSON.stringify(kept)}`);
    }
    }

    // 5. On the open / changes_requested path too, only the edited section is
    // sent — never the rest of the survey.
    for (const status of ['open', 'changes_requested']) {
      const plan = planAutosave(editedPayload, known, status);
      const sent = plan.kind === 'skip' ? [] : Object.keys(plan.fields).filter((k) => k !== 'draftSyncToken');
      if (sent.length !== 1 || sent[0] !== top) {
        failures.push(`FULL WRITE (${status}) ${name}: would send [${sent.join(', ')}] instead of just ${top}`);
      }
    }

    // 6–9. PER-INPUT — only inputs operated on HERE are ever sent or kept.
    if (!isIdentity(path)) {
      perInputChecked++;
      // The input operated on instead: the nearest other input in the SAME
      // section when there is one (the hardest case), else any other input.
      const j = inputPaths.findIndex((pa) => pa.join('.') === name);
      const near = inputPaths.filter((pa, k) => k !== j && pa[0] === top);
      const other = near.length ? near[0] : inputPaths[(j + 1) % inputPaths.length];
      const otherName = other.join('.');
      const oldAt = getAt(basePayload, path);

      // A: another device answered THIS input; this device, on an old copy,
      // operates on a different one. This input must keep the server's answer.
      const freshValue = editedValue(oldAt, i + 7000);
      const serverA = serverOf(setAt(base, path, freshValue));
      const localA = setAt(base, other, editedValue(getAt(basePayload, other), i + 9000));
      const touchedA: TouchedInputs = new Map();
      recordTouches(touchedA, base, localA, [other[0] as string]);
      const sentA = payloadOf(composeTouched(serverA, localA, touchedA));
      if (!same(getAt(sentA, path), getAt(payloadOf(serverA), path))) {
        failures.push(`UNTOUCHED OVERWRITTEN ${name}: editing ${otherName} would send ${JSON.stringify(getAt(sentA, path))} over ${JSON.stringify(freshValue)}`);
      }
      if (!same(getAt(sentA, other), getAt(payloadOf(localA), other))) {
        failures.push(`TOUCHED NOT SENT ${otherName}`);
      }
      const shownA = payloadOf(adoptWithTouches(localA, serverA, answerKeys, touchedA));
      if (!same(getAt(shownA, path), getAt(payloadOf(serverA), path))) {
        failures.push(`UNTOUCHED NOT ADOPTED ${name}: screen keeps the stale value`);
      }
      if (!same(getAt(shownA, other), getAt(payloadOf(localA), other))) {
        failures.push(`TOUCHED ADOPTED OVER ${otherName}: the user's typing was replaced`);
      }

      // B: THIS input is operated on here while another device answers a
      // different one. Both answers must survive the save and the screen.
      const localB = edited;
      const serverB = serverOf(setAt(base, other, editedValue(getAt(basePayload, other), i + 11000)));
      const touchedB: TouchedInputs = new Map();
      recordTouches(touchedB, base, localB, [top]);
      const sentB = payloadOf(composeTouched(serverB, localB, touchedB));
      if (!same(getAt(sentB, path), newValue)) failures.push(`TOUCHED NOT SENT ${name}`);
      if (!same(getAt(sentB, other), getAt(payloadOf(serverB), other))) {
        failures.push(`OTHER DEVICE WIPED ${otherName}: editing ${name} would overwrite it`);
      }
      const shownB = payloadOf(adoptWithTouches(localB, serverB, answerKeys, touchedB));
      if (!same(getAt(shownB, path), newValue) || !same(getAt(shownB, other), getAt(payloadOf(serverB), other))) {
        failures.push(`ADOPT MIXUP ${name} / ${otherName}`);
      }
      // And nothing outside the touched section is part of the write at all.
      const planB = planAutosave(sentB, signFields(payloadOf(serverB)), 'in_progress', new Set(touchedB.keys()));
      const writtenB = planB.kind === 'skip' ? [] : Object.keys(planB.fields).filter((k) => k !== 'draftSyncToken');
      if (writtenB.some((k) => k !== top)) failures.push(`UNTOUCHED SECTION WRITTEN with ${name}: ${writtenB.join(', ')}`);
    }

    // 3. Sent
    const delta = changedFields(editedPayload, known, ['draftSyncToken']);
    if (!(top in delta)) failures.push(`NOT SENT ${name}: edit would never reach the server`);
  });

  for (const [section, count] of [...sections].sort()) console.log(`  ${String(count).padStart(4)}  ${section}`);
  console.log(`  ${paths.length} inputs checked individually, 6 checks each, plus login-on-another-device in 5 statuses`);
  console.log(`  ${perInputChecked} inputs checked for per-input ownership (${paths.length - perInputChecked} list ids are not inputs), 9 checks each`);

  if (failures.length === 0) {
    console.log('  ok   every input round-trips, survives remote saves, is sent when edited, and is shielded from stale devices');
  } else {
    console.log(`  FAIL ${failures.length} problem(s):`);
    failures.slice(0, 60).forEach((f) => console.log('       ' + f));
  }
  return failures.length;
}
