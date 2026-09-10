import { useState, useMemo, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search, RotateCcw, Upload, UserPlus, ChevronDown } from 'lucide-react';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '@/firebase/config';
import { useSiteStore } from '@/store/siteStore';
import { useAuthStore } from '@/store/authStore';
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
  canRestore,
  onRestore,
}: {
  site:       Site;
  /** False for a read-only viewer — Restore is not rendered. */
  canRestore: boolean;
  onRestore:  () => void;
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
          {canRestore && (
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
          )}
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
  const navigate               = useNavigate();
  const { sites, lastUpdated } = useSiteStore();
  const { showToast }          = useToast();
  const { currentUser }        = useAuthStore();

  // A viewer gets this whole screen — the grouped list, the filters, the
  // archived view and the site detail drawer — with every mutating control
  // (New Site, Bulk Upload, Bulk Assign, Restore) simply not rendered.
  const canManageSites = currentUser?.role === 'admin';

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
            status:              data['status']              ?? 'active',
            taskCount:           data['taskCount']           ?? 0,
            completedTaskCount:  data['completedTaskCount']  ?? 0,
            inProgressTaskCount: data['inProgressTaskCount'] ?? 0,
            blockedTaskCount:    data['blockedTaskCount']    ?? 0,
            createdBy:           data['createdBy']           ?? '',
            createdAt:           data['createdAt']?.toDate?.()  ?? new Date(),
            archived:            true,
            archivedAt:         data['archivedAt']?.toDate?.() ?? null,
            sapCode:             data['sapCode']             ?? null,
            zone:                data['zone']                ?? null,
            voltageClass:        data['voltageClass']        ?? null,
            totalBays:           data['totalBays']            ?? null,
            numPowerTransformers: data['numPowerTransformers'] ?? null,
            workOrderCounters:   data['workOrderCounters']    ?? {},
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
    <div className="flex-1 w-full overflow-y-auto px-3 pb-24 pt-4 sm:px-4 sm:pt-5 lg:px-8 lg:py-8">

      <div className="mb-5 rounded-[24px] border border-slate-200/80 bg-white/70 p-4 shadow-sm backdrop-blur-sm sm:mb-6 sm:p-6 lg:mb-8 lg:rounded-[28px] lg:p-7">
        <div className="flex flex-col gap-4 sm:gap-5">
      {/* Heading + action buttons */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-[2rem] font-bold tracking-tight text-gray-900 sm:text-3xl">
            {showArchived ? 'Archived Sites' : 'Sites'}
          </h2>
          <span className="rounded-full bg-brand-blue/10 px-3 py-1 text-sm font-semibold text-brand-blue">
            {currentlyLoading ? '…' : showArchived ? archivedSites.length : totalFiltered}
          </span>
        </div>
        {!showArchived && canManageSites && (
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center sm:gap-3">
            <Button
              variant="outline"
              size="sm"
              className="h-11 w-full justify-center gap-2 rounded-2xl px-4 text-sm sm:h-10 sm:w-auto sm:rounded-xl"
              onClick={() => setShowBulkUpload(true)}
            >
              <Upload className="h-4 w-4" />
              Bulk Upload
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-11 w-full justify-center gap-2 rounded-2xl px-4 text-sm sm:h-10 sm:w-auto sm:rounded-xl"
              onClick={() => setShowBulkAssign(true)}
            >
              <UserPlus className="h-4 w-4" />
              Bulk Assign
            </Button>
            <button
              onClick={() => setShowCreate(true)}
              className="col-span-2 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-brand-blue px-5 text-sm font-semibold text-white shadow transition-all hover:bg-brand-navy active:scale-95 sm:h-10 sm:w-auto sm:rounded-full"
            >
              <Plus className="h-4 w-4" />
              New Site
            </button>
          </div>
        )}
      </div>

      {/* Filter bar — hidden in archived view */}
      {!showArchived && !isLoading && (
        <div className="space-y-4">
          {/* Row 1: Project dropdown + City dropdown + Search */}
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:flex xl:min-w-fit xl:flex-row">
              <select
                value={selectedProject}
                onChange={(e) => { setSelectedProject(e.target.value); setSelectedCity(''); }}
                className="h-11 w-full rounded-2xl border border-gray-200 bg-white px-4 text-sm text-gray-700 shadow-sm focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/30 sm:rounded-xl xl:min-w-[220px]"
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
                className="h-11 w-full rounded-2xl border border-gray-200 bg-white px-4 text-sm text-gray-700 shadow-sm focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/30 sm:rounded-xl xl:min-w-[180px]"
              >
                <option value="">All Cities</option>
                {uniqueCities.map((city) => (
                  <option key={city} value={city}>{city}</option>
                ))}
              </select>
            </div>

            <div className="relative w-full xl:flex-1">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name, code, city…"
                className="h-11 rounded-2xl border-gray-200 bg-white pl-11 pr-4 text-sm shadow-sm sm:rounded-xl"
              />
            </div>
          </div>

          {/* Row 2: Status filter pills */}
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
            {STATUS_FILTERS.map(({ key, label }) => {
              const isActive = activeFilter === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setActiveFilter((prev) => (prev === key ? 'all' : key))}
                  className={cn(
                    'inline-flex items-center justify-center rounded-full border px-4 py-2 text-sm font-medium transition-colors',
                    isActive
                      ? STATUS_PILL_COLOURS[key]
                      : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300 hover:bg-gray-50'
                  )}
                >
                  {label}
                  <span className={cn('ml-1.5', isActive ? 'opacity-75' : 'text-gray-400')}>
                    {counts[key]}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Show archived toggle */}
      <div className="flex justify-start pt-1 sm:justify-end">
        <button
          type="button"
          onClick={() => {
            const next = !showArchived;
            setShowArchived(next);
            if (next) loadArchivedSites();
            else setArchivedSites([]);
          }}
          className={cn(
            'inline-flex w-full items-center justify-center rounded-full border px-4 py-2 text-sm font-medium transition-colors sm:w-auto',
            showArchived
              ? 'bg-gray-500 text-white border-gray-500'
              : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300 hover:bg-gray-50'
          )}
        >
          {showArchived ? 'Hide Archived' : 'Show Archived'}
        </button>
      </div>
    </div>
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
                canRestore={canManageSites}
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
          {sites.length === 0 && canManageSites && (
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
        <div className="w-full space-y-4 sm:space-y-6">
          {grouped.map((proj) => (
            <section
              key={proj.projectId}
              className="w-full rounded-[26px] border border-slate-200/80 bg-white/60 p-3 shadow-sm backdrop-blur-sm sm:rounded-3xl sm:p-5"
            >

              {/* Project header — only when no project filter is active */}
              {!selectedProject && (
                <button
                  type="button"
                  onClick={() => toggleProject(proj.projectId)}
                  className="group flex w-full flex-wrap items-center gap-x-2 gap-y-2 border-b border-slate-200/80 pb-3 text-left"
                >
                  <ChevronDown
                    className={cn(
                      'h-4 w-4 text-gray-400 shrink-0 transition-transform duration-150',
                      !expandedProjects.has(proj.projectId) && '-rotate-90'
                    )}
                  />
                  <span className="min-w-0 flex-1 text-base font-bold leading-snug text-gray-900 sm:text-lg">
                    {proj.projectName}
                  </span>
                  {proj.projectCode && (
                    <span className="text-xs font-mono font-semibold text-brand-blue bg-blue-50 rounded px-1.5 py-0.5 shrink-0">
                      {proj.projectCode}
                    </span>
                  )}
                  <span className="basis-full pl-6 text-xs text-gray-400 sm:ml-auto sm:basis-auto sm:pl-0">
                    {proj.cities.reduce((sum, c) => sum + c.sites.length, 0)} sites
                  </span>
                </button>
              )}

              {/* City groups — shown when project expanded (or project filter active) */}
              {(selectedProject || expandedProjects.has(proj.projectId)) && (
                <div className={cn('flex w-full flex-col gap-3 sm:gap-4', !selectedProject && 'mt-4')}>
                  {proj.cities.map(({ city, sites: citySites }) => {
                    const cityKey      = `${proj.projectId}::${city}`;
                    const cityExpanded = expandedCities.has(cityKey);

                    return (
                      <div
                        key={cityKey}
                        className="w-full rounded-[22px] border border-slate-200 bg-slate-50/80 p-3 shadow-sm sm:rounded-2xl sm:p-4"
                      >
                        <div className="flex flex-col gap-3 sm:gap-4 xl:grid xl:grid-cols-[220px_minmax(0,1fr)] xl:items-start">
                          {/* City header */}
                          <button
                            type="button"
                            onClick={() => toggleCity(proj.projectId, city)}
                            className="flex w-full flex-wrap items-center gap-2 py-1 text-left xl:self-start"
                          >
                            <ChevronDown
                              className={cn(
                                'h-3.5 w-3.5 text-gray-400 shrink-0 transition-transform duration-150',
                                !cityExpanded && '-rotate-90'
                              )}
                            />
                            <div className="min-w-0 flex-1 pl-0.5">
                              <span className="block text-xs font-semibold text-gray-500 uppercase tracking-[0.18em]">
                                City
                              </span>
                              <span className="mt-1 block text-base font-semibold text-slate-800 sm:text-lg">
                                {city}
                              </span>
                            </div>
                            <span className="ml-5 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs text-gray-500 sm:ml-0">
                              {citySites.length} site{citySites.length !== 1 ? 's' : ''}
                            </span>
                          </button>

                          {/* Site cards */}
                          {cityExpanded && (
                            <div
                              className={cn(
                                'mt-1 grid w-full gap-3 sm:gap-4',
                                citySites.length === 1
                                  ? 'grid-cols-1'
                                  : citySites.length === 2
                                  ? 'grid-cols-1 md:grid-cols-2'
                                  : 'grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4'
                              )}
                            >
                              {citySites.map((site) => (
                                <SiteCard
                                  key={site.id}
                                  site={site}
                                  onView={() => {
                                    setSelectedSite(site);
                                    setShowDetail(true);
                                  }}
                                  onViewLifecycle={() => navigate(`/sites/${site.id}`)}
                                />
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          ))}
        </div>
      )}

      {/* ── Modals — every one of these writes, so admin only ── */}

      {canManageSites && (
        <>
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
        </>
      )}

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
