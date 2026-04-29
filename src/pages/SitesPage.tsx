import { useState, useMemo, useEffect, useRef } from 'react';
import { Plus, Search, RotateCcw, Upload, UserPlus, ChevronDown } from 'lucide-react';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '@/firebase/config';
import { useSiteStore } from '@/store/siteStore';
import { archiveSite } from '@/hooks/useSiteActions';
import { useToast } from '@/components/ui/toast';
import { SiteCard } from '@/components/sites/SiteCard';
import { SiteDetailDrawer } from '@/components/sites/SiteDetailDrawer';
import { CreateSiteModal } from '@/components/sites/CreateSiteModal';
import { BulkUploadSitesModal }       from '@/components/sites/BulkUploadSitesModal';
import { BulkUploadAssignmentsModal } from '@/components/sites/BulkUploadAssignmentsModal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { Site, SiteStatus } from '@/types';

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_FILTERS: { key: SiteStatus | 'all'; label: string }[] = [
  { key: 'all',       label: 'All'       },
  { key: 'active',    label: 'Active'    },
  { key: 'completed', label: 'Completed' },
  { key: 'on_hold',   label: 'On Hold'   },
];

const STATUS_PILL_COLOURS: Record<SiteStatus | 'all', string> = {
  all:       'bg-brand-blue text-white border-brand-blue',
  active:    'bg-brand-blue text-white border-brand-blue',
  completed: 'bg-green-600 text-white border-green-600',
  on_hold:   'bg-gray-500 text-white border-gray-500',
};

// ─── Skeletons ────────────────────────────────────────────────────────────────

function SiteSkeletons() {
  return (
    <div className="flex flex-col gap-2">
      {[...Array(3)].map((_, i) => (
        <Skeleton key={i} className="h-28 rounded-lg" />
      ))}
    </div>
  );
}

// ─── Archived Site Card ───────────────────────────────────────────────────────

function ArchivedSiteCard({
  site,
  onRestore,
}: {
  site:      Site;
  onRestore: () => void;
}) {
  return (
    <Card className="overflow-hidden border-0 shadow-sm opacity-75">
      <div className="flex">
        <div className="w-1 shrink-0 bg-gray-300" />
        <div className="flex-1 p-3 min-w-0">
          <div className="flex items-start justify-between gap-2 mb-1">
            <div className="min-w-0 flex items-center gap-2">
              <span className="text-xs font-mono text-gray-400">{site.siteCode}</span>
              {site.projectCode && (
                <span className="text-xs font-mono font-semibold text-brand-blue bg-blue-50 rounded px-1.5 py-0.5">
                  {site.projectCode}
                </span>
              )}
            </div>
            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 shrink-0">
              Archived
            </span>
          </div>
          <h3 className="text-sm font-semibold text-gray-600 leading-snug line-clamp-1">
            {site.siteName}
          </h3>
          <p className="text-xs text-gray-400 mt-0.5">{site.projectName}</p>
          <p className="text-xs text-gray-400 mt-0.5">
            {site.city}{site.state ? `, ${site.state}` : ''}
          </p>
          <div className="flex justify-end mt-2">
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1.5"
              onClick={onRestore}
            >
              <RotateCcw className="h-3 w-3" />
              Restore
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}

// ─── Grouped data type ────────────────────────────────────────────────────────

interface CityGroup {
  city:  string;
  sites: Site[];
}

interface ProjectGroup {
  projectId:   string;
  projectName: string;
  projectCode: string;
  cities:      CityGroup[];
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function SitesPage() {
  const { sites, lastUpdated } = useSiteStore();
  const { showToast }          = useToast();

  // ── Filter state ─────────────────────────────────────────────────────────────
  const [activeFilter,     setActiveFilter]     = useState<SiteStatus | 'all'>('all');
  const [search,           setSearch]           = useState('');
  const [selectedProject,  setSelectedProject]  = useState('');   // '' = all
  const [selectedCity,     setSelectedCity]     = useState('');   // '' = all

  // ── Expand/collapse state ─────────────────────────────────────────────────────
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  const [expandedCities,   setExpandedCities]   = useState<Set<string>>(new Set());
  const initialExpandRef = useRef(false);

  // ── Modal / drawer state ──────────────────────────────────────────────────────
  const [showCreate,      setShowCreate]      = useState(false);
  const [showBulkUpload,  setShowBulkUpload]  = useState(false);
  const [showBulkAssign,  setShowBulkAssign]  = useState(false);
  const [selectedSite,    setSelectedSite]    = useState<Site | null>(null);
  const [showDetail,      setShowDetail]      = useState(false);

  // ── Archived view ─────────────────────────────────────────────────────────────
  const [showArchived,    setShowArchived]    = useState(false);
  const [archivedSites,   setArchivedSites]   = useState<Site[]>([]);
  const [loadingArchived, setLoadingArchived] = useState(false);

  const isLoading = !lastUpdated && sites.length === 0;

  // ── Auto-expand all sections on initial data load ─────────────────────────────
  useEffect(() => {
    if (sites.length === 0 || initialExpandRef.current) return;
    initialExpandRef.current = true;
    setExpandedProjects(new Set(sites.map((s) => s.projectId).filter(Boolean)));
    setExpandedCities(new Set(
      sites
        .filter((s) => s.projectId && s.city)
        .map((s) => `${s.projectId}::${s.city}`)
    ));
  }, [sites.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Dropdown options ──────────────────────────────────────────────────────────

  const uniqueProjects = useMemo(() => {
    const map = new Map<string, { id: string; name: string; code: string }>();
    for (const s of sites) {
      if (s.projectId && !map.has(s.projectId)) {
        map.set(s.projectId, { id: s.projectId, name: s.projectName || '—', code: s.projectCode || '' });
      }
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [sites]);

  const uniqueCities = useMemo(() => {
    const set = new Set<string>();
    for (const s of sites) { if (s.city) set.add(s.city); }
    return Array.from(set).sort();
  }, [sites]);

  // ── Status pill counts (respect project/city/search filters, not status) ──────

  const countsBase = useMemo(() => {
    let base = sites;
    if (selectedProject) base = base.filter((s) => s.projectId === selectedProject);
    if (selectedCity)    base = base.filter((s) => s.city === selectedCity);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      base = base.filter(
        (s) =>
          s.siteName.toLowerCase().includes(q) ||
          s.siteCode.toLowerCase().includes(q) ||
          s.city.toLowerCase().includes(q) ||
          s.projectName.toLowerCase().includes(q) ||
          (s.projectCode && s.projectCode.toLowerCase().includes(q))
      );
    }
    return base;
  }, [sites, selectedProject, selectedCity, search]);

  const counts = useMemo(() => ({
    all:       countsBase.length,
    active:    countsBase.filter((s) => s.status === 'active').length,
    completed: countsBase.filter((s) => s.status === 'completed').length,
    on_hold:   countsBase.filter((s) => s.status === 'on_hold').length,
  }), [countsBase]);

  // ── Grouped data ──────────────────────────────────────────────────────────────

  const grouped = useMemo<ProjectGroup[]>(() => {
    // Apply all filters
    let result = sites;
    if (activeFilter !== 'all')  result = result.filter((s) => s.status === activeFilter);
    if (selectedProject)         result = result.filter((s) => s.projectId === selectedProject);
    if (selectedCity)            result = result.filter((s) => s.city === selectedCity);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter(
        (s) =>
          s.siteName.toLowerCase().includes(q) ||
          s.siteCode.toLowerCase().includes(q) ||
          s.city.toLowerCase().includes(q) ||
          s.projectName.toLowerCase().includes(q) ||
          (s.projectCode && s.projectCode.toLowerCase().includes(q))
      );
    }

    // Group: projectId → city → sites
    const projectMap = new Map<string, {
      projectId:   string;
      projectName: string;
      projectCode: string;
      cityMap:     Map<string, Site[]>;
    }>();

    for (const site of result) {
      const pid = site.projectId || '__none__';
      if (!projectMap.has(pid)) {
        projectMap.set(pid, {
          projectId:   pid,
          projectName: site.projectName || 'Unassigned',
          projectCode: site.projectCode || '',
          cityMap:     new Map(),
        });
      }
      const proj    = projectMap.get(pid)!;
      const cityKey = site.city || 'Unknown';
      if (!proj.cityMap.has(cityKey)) proj.cityMap.set(cityKey, []);
      proj.cityMap.get(cityKey)!.push(site);
    }

    // Convert to sorted arrays
    return Array.from(projectMap.values())
      .sort((a, b) => a.projectName.localeCompare(b.projectName))
      .map((proj) => ({
        projectId:   proj.projectId,
        projectName: proj.projectName,
        projectCode: proj.projectCode,
        cities: Array.from(proj.cityMap.entries())
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([city, citySites]) => ({
            city,
            sites: citySites.slice().sort((a, b) => a.siteCode.localeCompare(b.siteCode)),
          })),
      }));
  }, [sites, activeFilter, selectedProject, selectedCity, search]);

  const totalFiltered = useMemo(
    () => grouped.reduce((sum, p) => sum + p.cities.reduce((s2, c) => s2 + c.sites.length, 0), 0),
    [grouped]
  );

  // ── Expand / collapse toggles ─────────────────────────────────────────────────

  function toggleProject(projectId: string) {
    setExpandedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) next.delete(projectId); else next.add(projectId);
      return next;
    });
  }

  function toggleCity(projectId: string, city: string) {
    const key = `${projectId}::${city}`;
    setExpandedCities((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  // ── Archived helpers ──────────────────────────────────────────────────────────

  async function loadArchivedSites() {
    setLoadingArchived(true);
    try {
      const snap = await getDocs(
        query(collection(db, 'sites'), where('archived', '==', true))
      );
      const loaded: Site[] = snap.docs
        .map((d) => {
          const data = d.data();
          return {
            id:                 d.id,
            siteCode:           data['siteCode']           ?? '',
            siteName:           data['siteName']           ?? '',
            city:               data['city']               ?? '',
            state:              data['state']              ?? '',
            address:            data['address']            ?? '',
            projectId:          data['projectId']          ?? '',
            projectName:        data['projectName']        ?? '',
            projectCode:        data['projectCode']        ?? '',
            location:           data['location']
              ? { lat: data['location'].latitude, lng: data['location'].longitude }
              : null,
            status:             data['status']             ?? 'active',
            taskCount:          data['taskCount']          ?? 0,
            completedTaskCount: data['completedTaskCount'] ?? 0,
            createdBy:          data['createdBy']          ?? '',
            createdAt:          data['createdAt']?.toDate?.()  ?? new Date(),
            archived:           true,
            archivedAt:         data['archivedAt']?.toDate?.() ?? null,
          } as Site;
        })
        .sort((a, b) => (b.archivedAt?.getTime() ?? 0) - (a.archivedAt?.getTime() ?? 0));
      setArchivedSites(loaded);
    } catch {
      setArchivedSites([]);
    } finally {
      setLoadingArchived(false);
    }
  }

  async function handleRestore(siteId: string) {
    try {
      await archiveSite(siteId, false);
      setArchivedSites((prev) => prev.filter((s) => s.id !== siteId));
      showToast('Site restored', 'success');
    } catch {
      showToast('Failed to restore site', 'error');
    }
  }

  const currentlyLoading = showArchived ? loadingArchived : isLoading;

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-4 max-w-2xl mx-auto pb-4 overflow-x-hidden w-full">

      {/* Heading + action buttons */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-xl sm:text-2xl font-bold text-gray-900">
            {showArchived ? 'Archived Sites' : 'Sites'}
          </h2>
          <span className="rounded-full bg-brand-blue/10 text-brand-blue text-xs font-semibold px-2 py-0.5">
            {currentlyLoading ? '…' : showArchived ? archivedSites.length : totalFiltered}
          </span>
        </div>
        {!showArchived && (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs gap-1.5"
              onClick={() => setShowBulkUpload(true)}
            >
              <Upload className="h-3.5 w-3.5" />
              Bulk Upload
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs gap-1.5"
              onClick={() => setShowBulkAssign(true)}
            >
              <UserPlus className="h-3.5 w-3.5" />
              Bulk Assign
            </Button>
            <button
              onClick={() => setShowCreate(true)}
              className="flex items-center gap-1.5 rounded-full bg-brand-blue px-3 py-1.5 text-xs font-semibold text-white shadow hover:bg-brand-navy active:scale-95 transition-all"
            >
              <Plus className="h-3.5 w-3.5" />
              New Site
            </button>
          </div>
        )}
      </div>

      {/* Filter bar — hidden in archived view */}
      {!showArchived && !isLoading && (
        <>
          {/* Row 1: Project dropdown + City dropdown + Search */}
          <div className="flex flex-col sm:flex-row gap-2">
            <select
              value={selectedProject}
              onChange={(e) => { setSelectedProject(e.target.value); setSelectedCity(''); }}
              className="rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-brand-blue/30 focus:border-brand-blue w-full sm:flex-1 sm:min-w-0 sm:max-w-[180px]"
            >
              <option value="">All Projects</option>
              {uniqueProjects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code ? `${p.code} — ${p.name}` : p.name}
                </option>
              ))}
            </select>

            <select
              value={selectedCity}
              onChange={(e) => setSelectedCity(e.target.value)}
              className="rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-brand-blue/30 focus:border-brand-blue w-full sm:flex-1 sm:min-w-0 sm:max-w-[140px]"
            >
              <option value="">All Cities</option>
              {uniqueCities.map((city) => (
                <option key={city} value={city}>{city}</option>
              ))}
            </select>

            <div className="relative w-full sm:flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400 pointer-events-none" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name, code, city…"
                className="pl-8 text-sm h-9"
              />
            </div>
          </div>

          {/* Row 2: Status filter pills */}
          <div className="flex gap-1 flex-wrap">
            {STATUS_FILTERS.map(({ key, label }) => {
              const isActive = activeFilter === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setActiveFilter((prev) => (prev === key ? 'all' : key))}
                  className={cn(
                    'px-3 py-1 rounded-full text-xs font-medium border transition-colors',
                    isActive
                      ? STATUS_PILL_COLOURS[key]
                      : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300 hover:bg-gray-50'
                  )}
                >
                  {label}
                  <span className={cn('ml-1', isActive ? 'opacity-75' : 'text-gray-400')}>
                    {counts[key]}
                  </span>
                </button>
              );
            })}
          </div>
        </>
      )}

      {/* Show archived toggle */}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => {
            const next = !showArchived;
            setShowArchived(next);
            if (next) loadArchivedSites();
            else setArchivedSites([]);
          }}
          className={cn(
            'px-2.5 py-1 rounded-full text-xs font-medium border transition-colors',
            showArchived
              ? 'bg-gray-500 text-white border-gray-500'
              : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300 hover:bg-gray-50'
          )}
        >
          {showArchived ? 'Hide Archived' : 'Show Archived'}
        </button>
      </div>

      {/* ── Content ── */}
      {currentlyLoading ? (
        <SiteSkeletons />

      ) : showArchived ? (
        /* Archived flat list */
        archivedSites.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-sm text-gray-400">No archived sites found.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {archivedSites.map((site) => (
              <ArchivedSiteCard
                key={site.id}
                site={site}
                onRestore={() => handleRestore(site.id)}
              />
            ))}
          </div>
        )

      ) : grouped.length === 0 ? (
        /* Empty state */
        <div className="py-16 text-center">
          <p className="text-sm text-gray-400">
            {sites.length === 0
              ? 'No sites yet.'
              : search || selectedProject || selectedCity || activeFilter !== 'all'
              ? 'No sites match your filters.'
              : 'No sites to display.'}
          </p>
          {sites.length === 0 && (
            <button
              type="button"
              onClick={() => setShowCreate(true)}
              className="mt-3 text-sm font-medium text-brand-blue hover:underline"
            >
              + New Site
            </button>
          )}
        </div>

      ) : (
        /* ── Grouped view ── */
        <div className="flex flex-col gap-4">
          {grouped.map((proj) => (
            <div key={proj.projectId}>

              {/* Project header — only when no project filter is active */}
              {!selectedProject && (
                <button
                  type="button"
                  onClick={() => toggleProject(proj.projectId)}
                  className="w-full flex items-center gap-2 py-1.5 text-left group"
                >
                  <ChevronDown
                    className={cn(
                      'h-4 w-4 text-gray-400 shrink-0 transition-transform duration-150',
                      !expandedProjects.has(proj.projectId) && '-rotate-90'
                    )}
                  />
                  <span className="text-sm font-bold text-gray-900 leading-snug truncate min-w-0">
                    {proj.projectName}
                  </span>
                  {proj.projectCode && (
                    <span className="text-xs font-mono font-semibold text-brand-blue bg-blue-50 rounded px-1.5 py-0.5 shrink-0">
                      {proj.projectCode}
                    </span>
                  )}
                  <span className="ml-auto text-xs text-gray-400 shrink-0">
                    {proj.cities.reduce((sum, c) => sum + c.sites.length, 0)} sites
                  </span>
                </button>
              )}

              {/* City groups — shown when project expanded (or project filter active) */}
              {(selectedProject || expandedProjects.has(proj.projectId)) && (
                <div className={cn('flex flex-col gap-2', !selectedProject && 'mt-1 ml-5')}>
                  {proj.cities.map(({ city, sites: citySites }) => {
                    const cityKey      = `${proj.projectId}::${city}`;
                    const cityExpanded = expandedCities.has(cityKey);

                    return (
                      <div key={cityKey}>
                        {/* City header */}
                        <button
                          type="button"
                          onClick={() => toggleCity(proj.projectId, city)}
                          className="w-full flex items-center gap-2 py-1 text-left"
                        >
                          <ChevronDown
                            className={cn(
                              'h-3.5 w-3.5 text-gray-400 shrink-0 transition-transform duration-150',
                              !cityExpanded && '-rotate-90'
                            )}
                          />
                          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide truncate min-w-0 flex-1">
                            {city}
                          </span>
                          <span className="text-xs text-gray-400 shrink-0">
                            · {citySites.length} site{citySites.length !== 1 ? 's' : ''}
                          </span>
                        </button>

                        {/* Site cards */}
                        {cityExpanded && (
                          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 mt-1.5">
                            {citySites.map((site) => (
                              <SiteCard
                                key={site.id}
                                site={site}
                                onView={() => {
                                  setSelectedSite(site);
                                  setShowDetail(true);
                                }}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── Modals ── */}

      <CreateSiteModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
      />

      <BulkUploadSitesModal
        open={showBulkUpload}
        onClose={() => setShowBulkUpload(false)}
        onSuccess={(count) => {
          setShowBulkUpload(false);
          showToast(`${count} site${count !== 1 ? 's' : ''} created successfully`, 'success');
        }}
      />

      <BulkUploadAssignmentsModal
        open={showBulkAssign}
        onClose={() => setShowBulkAssign(false)}
        onSuccess={(count) => {
          setShowBulkAssign(false);
          showToast(`${count} engineer${count !== 1 ? 's' : ''} assigned`, 'success');
        }}
      />

      {selectedSite && (
        <SiteDetailDrawer
          site={selectedSite}
          open={showDetail}
          onClose={() => {
            setShowDetail(false);
            setTimeout(() => setSelectedSite(null), 350);
          }}
        />
      )}
    </div>
  );
}
