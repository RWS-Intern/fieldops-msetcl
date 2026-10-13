import type { SurveyReport } from '@/types';

/**
 * Merging survey photos across devices instead of letting the latest save
 * replace them.
 *
 * The rest of the survey is newest-wins, but for photos that silently throws
 * away evidence: two devices each adding a photo would end with only one. So
 * every photo list is a UNION of both sides, and a deletion is recorded as a
 * tombstone in `removedPhotoRefs` so the other device's union cannot
 * resurrect it. Tombstones only ever grow, which is what makes the merge
 * order-independent: merging A into B and B into A converge on the same set.
 *
 * Only uploaded (https) refs are tombstoned or synced. A `local://` ref means a
 * blob on THIS device only — it is never pushed (see stripLocalPhotoRefs) and a
 * union keeps the owning device's copy, so a pending photo survives adopting
 * another device's save.
 */

const LOCAL = 'local://';

/** Every photo reference in the survey, in document order. */
export function photoRefsIn(data: Pick<SurveyReport, 'feeders' | 'relays' | 'sitePhotos' | 'signOff'>): string[] {
  const refs: string[] = [];
  for (const f of data.feeders ?? []) refs.push(...(f.photos ?? []));
  for (const r of data.relays ?? []) refs.push(...(r.photos ?? []));
  for (const p of data.sitePhotos ?? []) refs.push(p.url);
  refs.push(...(data.signOff?.signedPagePhotos ?? []));
  return refs;
}

/**
 * Refs that were in `before` and are gone from `after` — i.e. the user deleted
 * them. local:// refs are excluded: they never reach another device, and they
 * also "disappear" legitimately when an upload swaps them for an https URL.
 */
export function removedRefs(before: string[], after: string[]): string[] {
  const kept = new Set(after);
  return before.filter((r) => !r.startsWith(LOCAL) && !kept.has(r));
}

function union(primary: string[], other: string[], dead: Set<string>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const r of [...primary, ...other]) {
    if (seen.has(r) || dead.has(r)) continue;
    seen.add(r);
    out.push(r);
  }
  return out;
}

/**
 * `primary` with every photo list merged against `other`.
 *
 * Non-photo fields come from `primary` untouched. Feeders and relays are
 * matched by uid; an entry present only in `other` is not added — that is a
 * structural change, and the survey's newest-wins rule covers it.
 */
export function mergePhotoFields(primary: SurveyReport, other: SurveyReport): SurveyReport {
  const tombstones = [...new Set([...(primary.removedPhotoRefs ?? []), ...(other.removedPhotoRefs ?? [])])];
  const dead = new Set(tombstones);

  const otherFeeders = new Map((other.feeders ?? []).map((f) => [f.uid, f]));
  const otherRelays  = new Map((other.relays ?? []).map((r) => [r.uid, r]));

  const sitePhotos: SurveyReport['sitePhotos'] = [];
  const seenSite = new Set<string>();
  for (const p of [...(primary.sitePhotos ?? []), ...(other.sitePhotos ?? [])]) {
    if (seenSite.has(p.url) || dead.has(p.url)) continue;
    seenSite.add(p.url);
    sitePhotos.push(p);
  }

  const sign = (a: string | null | undefined, b: string | null | undefined) =>
    (a && !dead.has(a) ? a : null) ?? (b && !dead.has(b) ? b : null);

  return {
    ...primary,
    feeders: (primary.feeders ?? []).map((f) => ({
      ...f,
      photos: union(f.photos ?? [], otherFeeders.get(f.uid)?.photos ?? [], dead),
    })),
    relays: (primary.relays ?? []).map((r) => ({
      ...r,
      photos: union(r.photos ?? [], otherRelays.get(r.uid)?.photos ?? [], dead),
    })),
    sitePhotos,
    signOff: {
      ...primary.signOff,
      signedPagePhotos: union(primary.signOff?.signedPagePhotos ?? [], other.signOff?.signedPagePhotos ?? [], dead),
      // Single values: keep primary's, fall back to other's rather than
      // letting a stripped (null) signature erase a pending one.
      surveyorSignatureImage: sign(primary.signOff?.surveyorSignatureImage, other.signOff?.surveyorSignatureImage),
      msetclSignatureImage:   sign(primary.signOff?.msetclSignatureImage, other.signOff?.msetclSignatureImage),
    },
    removedPhotoRefs: tombstones,
  };
}
