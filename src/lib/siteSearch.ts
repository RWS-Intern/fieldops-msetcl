import type { Site } from '@/types';

/**
 * The single definition of "does this substation match what the user typed".
 *
 * Shared by the header's global SiteSearch and the survey-oversight search so
 * the two can never drift apart: typing the same thing in either place must
 * match the same sites by the same rule. Case-insensitive substring across
 * exactly three fields — site code, site name, city.
 *
 * `term` must already be lowercased and trimmed; use normaliseSearchTerm().
 */
export function matchesSiteSearch(site: Site, term: string): boolean {
  if (!term) return false;
  return (
    site.siteCode.toLowerCase().includes(term) ||
    site.siteName.toLowerCase().includes(term) ||
    site.city.toLowerCase().includes(term)
  );
}

/** Lowercase + trim, the form matchesSiteSearch expects. */
export function normaliseSearchTerm(raw: string): string {
  return raw.trim().toLowerCase();
}

/** Every site matching `term`, in the order the caller's array holds them. */
export function findMatchingSites(sites: readonly Site[], term: string): Site[] {
  if (!term) return [];
  return sites.filter((s) => matchesSiteSearch(s, term));
}
