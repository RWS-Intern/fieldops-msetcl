import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, X } from 'lucide-react';
import { useSiteStore } from '@/store/siteStore';
import { findMatchingSites, normaliseSearchTerm } from '@/lib/siteSearch';
import { cn } from '@/lib/utils';
import type { Site } from '@/types';

const MAX_RESULTS  = 8;
const DEBOUNCE_MS  = 200;

/**
 * Global substation search — jumps straight to a site's Lifecycle page from
 * anywhere in the app.
 *
 * CLIENT-SIDE filter over siteStore, deliberately: that store is already
 * loaded and kept live for every admin/viewer session (SitesListener in
 * Layout), and SitesPage filters the same array the same way. A server query
 * would add a round trip per keystroke and a composite index, for a corpus
 * this size. See the note in the report about when that trade flips.
 *
 * Consequence worth knowing: siteStore holds only NON-archived sites, so an
 * archived substation will not appear here. Its Lifecycle page still loads
 * fine by direct URL — the page reads the site document itself.
 */
export function SiteSearch({
  autoFocus = false,
  onNavigated,
}: {
  autoFocus?: boolean;
  /** Called after a result is chosen — lets the mobile overlay close itself. */
  onNavigated?: () => void;
}) {
  const navigate = useNavigate();
  const { sites } = useSiteStore();

  const [input, setInput]     = useState('');
  const [term, setTerm]       = useState('');   // debounced
  const [open, setOpen]       = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  // ── Debounce ───────────────────────────────────────────────────────────
  // Both setState calls run from the timer, not synchronously in the effect
  // body, so this is a real debounce rather than a cascading render. The
  // highlight resets here because that is exactly when the result set can
  // change — no separate effect needed to keep it in step.
  useEffect(() => {
    const t = setTimeout(() => {
      setTerm(normaliseSearchTerm(input));
      setActiveIndex(0);
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [input]);

  // ── Filter ─────────────────────────────────────────────────────────────
  // matchesSiteSearch is the shared definition (src/lib/siteSearch.ts), also
  // used by the survey-oversight search — typing the same thing in either
  // place must match the same sites by the same rule.
  const results = useMemo<Site[]>(
    () => findMatchingSites(sites, term).slice(0, MAX_RESULTS),
    [sites, term],
  );

  // ── Close on outside click ─────────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  // Derived, not synced: results can shrink after the highlight was set, and
  // clamping here is always correct without another effect.
  const safeIndex = results.length > 0 ? Math.min(activeIndex, results.length - 1) : 0;

  function choose(site: Site) {
    setOpen(false);
    setInput('');
    setTerm('');
    navigate(`/sites/${site.id}`);
    onNavigated?.();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape')       { setOpen(false); return; }
    if (results.length === 0)     return;
    if (e.key === 'ArrowDown')    { e.preventDefault(); setActiveIndex((i) => (i + 1) % results.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIndex((i) => (i - 1 + results.length) % results.length); }
    else if (e.key === 'Enter')   { e.preventDefault(); choose(results[safeIndex]); }
  }

  const showDropdown = open && term.length > 0;

  return (
    <div ref={containerRef} className="relative w-full">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
      <input
        type="search"
        value={input}
        autoFocus={autoFocus}
        onChange={(e) => { setInput(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder="Search substations…"
        aria-label="Search substations by code, name or city"
        className="h-9 w-full rounded-lg border border-gray-200 bg-gray-50 pl-8 pr-8 text-sm placeholder:text-gray-400 focus:border-brand-blue focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-blue/20"
      />
      {input && (
        <button
          type="button"
          onClick={() => { setInput(''); setTerm(''); }}
          aria-label="Clear search"
          className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}

      {showDropdown && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg">
          {results.length === 0 ? (
            <p className="px-3 py-3 text-xs text-gray-400">
              No substation matches “{input.trim()}”.
            </p>
          ) : (
            <ul className="max-h-72 overflow-y-auto py-1">
              {results.map((site, i) => (
                <li key={site.id}>
                  <button
                    type="button"
                    onMouseEnter={() => setActiveIndex(i)}
                    onClick={() => choose(site)}
                    className={cn(
                      'flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left transition-colors',
                      i === safeIndex ? 'bg-blue-50' : 'hover:bg-gray-50',
                    )}
                  >
                    <span className="flex w-full items-center gap-2">
                      <span className="font-mono text-xs text-gray-400">{site.siteCode}</span>
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-gray-900">
                        {site.siteName}
                      </span>
                    </span>
                    {site.city && (
                      <span className="text-xs text-gray-400">
                        {site.city}{site.state ? `, ${site.state}` : ''}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
