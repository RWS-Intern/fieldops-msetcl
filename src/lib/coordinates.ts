// ─── GPS input parsing ─────────────────────────────────────────────────────────
//
// Accepts, in priority order:
//   1. A Google Maps URL with an "@<lat>,<lng>" viewport centre, e.g.
//      https://www.google.com/maps/@21.1458,79.0882,15z
//   2. A Google Maps URL with a "?q=<lat>,<lng>" query param.
//   3. A Google Maps URL with a "!3d<lat>!4d<lng>" place-pin segment.
//   4. A plain "<lat>, <lng>" pair (comma and/or whitespace separated).
// Shortened share links (maps.app.goo.gl/...) can't be expanded client-side
// without a network request, so they intentionally fall through to "no match".
//
// Shared by SiteDetailDrawer.tsx (admin Edit GPS) and StepSiteVisit.tsx
// (survey manual-override GPS entry) — one parsing implementation for both.

const NUM = String.raw`-?\d+(?:\.\d+)?`;
const MAPS_AT_RE    = new RegExp(`@(${NUM}),(${NUM})`);
const MAPS_Q_RE     = new RegExp(`[?&]q=(${NUM}),(${NUM})`);
const MAPS_3D4D_RE  = new RegExp(`!3d(${NUM})!4d(${NUM})`);
const PLAIN_PAIR_RE = new RegExp(`^\\s*(${NUM})\\s*[,\\s]\\s*(${NUM})\\s*$`);

export function parseCoordinatesInput(raw: string): { lat: number; lng: number } | null {
  const input = raw.trim();
  if (!input) return null;

  for (const re of [MAPS_AT_RE, MAPS_Q_RE, MAPS_3D4D_RE, PLAIN_PAIR_RE]) {
    const match = input.match(re);
    if (match) {
      return { lat: parseFloat(match[1]), lng: parseFloat(match[2]) };
    }
  }

  return null;
}

export function isValidLatLng(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) && Number.isFinite(lng) &&
    lat >= -90 && lat <= 90 &&
    lng >= -180 && lng <= 180
  );
}
