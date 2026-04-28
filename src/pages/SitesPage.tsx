import { useState, useMemo } from 'react';
import { Plus, Search, RotateCcw } from 'lucide-react';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '@/firebase/config';
import { useSiteStore } from '@/store/siteStore';
import { archiveSite } from '@/hooks/useSiteActions';
import { useToast } from '@/components/ui/toast';
import { SiteCard } from '@/components/sites/SiteCard';
import { SiteDetailDrawer } from '@/components/sites/SiteDetailDrawer';
import { CreateSiteModal } from '@/components/sites/CreateSiteModal';
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

const PAGE_SIZE = 50;

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

// ─── Page ─────────────────────────────────────────────────────────────────────

export function SitesPage() {
  const { sites, lastUpdated } = useSiteStore();
  const { showToast }          = useToast();

  const [activeFilter, setActiveFilter]       = useState<SiteStatus | 'all'>('all');
  const [search,       setSearch]             = useState('');
  const [page,         setPage]               = useState(1);
  const [showCreate,   setShowCreate]         = useState(false);
  const [selectedSite, setSelectedSite]       = useState<Site | null>(null);
  const [showDetail,   setShowDetail]         = useState(false);

  // Archived view state
  const [showArchived,     setShowArchived]     = useState(false);
  const [archivedSites,    setArchivedSites]    = useState<Site[]>([]);
  const [loadingArchived,  setLoadingArchived]  = useState(false);

  const isLoading = !lastUpdated && sites.length === 0;

  // ── Filtering ───────────────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    let result = sites;

    if (activeFilter !== 'all') {
      result = result.filter((s) => s.status === activeFilter);
    }

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

    return result;
  }, [sites, activeFilter, search]);

  const paginated   = filtered.slice(0, page * PAGE_SIZE);
  const hasMore     = paginated.length < filtered.length;

  // ── Stats for filter pills ──────────────────────────────────────────────────

  const counts = useMemo(() => ({
    all:       sites.length,
    active:    sites.filter((s) => s.status === 'active').length,
    completed: sites.filter((s) => s.status === 'completed').length,
    on_hold:   sites.filter((s) => s.status === 'on_hold').length,
  }), [sites]);

  // ── Archived ────────────────────────────────────────────────────────────────

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
  const displaySites     = showArchived ? archivedSites   : paginated;

  return (
    <div className="flex flex-col gap-4 max-w-2xl mx-auto pb-4">
      {/* Heading + count badge + New Site button */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-xl font-bold text-gray-900">
            {showArchived ? 'Archived Sites' : 'Sites'}
          </h2>
          <span className="rounded-full bg-brand-blue/10 text-brand-blue text-xs font-semibold px-2 py-0.5">
            {currentlyLoading ? '…' : displaySites.length}
          </span>
        </div>
        {!showArchived && (
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 rounded-full bg-brand-blue px-3 py-1.5 text-xs font-semibold text-white shadow hover:bg-brand-navy active:scale-95 transition-all"
          >
            <Plus className="h-3.5 w-3.5" />
            New Site
          </button>
        )}
      </div>

      {/* Filter pills + search — hidden in archived view */}
      {!showArchived && !isLoading && (
        <>
          {/* Status filter pills */}
          <div className="flex gap-1.5 flex-wrap">
            {STATUS_FILTERS.map(({ key, label }) => {
              const isActive = activeFilter === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => {
                    setActiveFilter((prev) => (prev === key ? 'all' : key));
                    setPage(1);
                  }}
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

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400 pointer-events-none" />
            <Input
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              placeholder="Search by name, code, city or project…"
              className="pl-8 text-sm h-9"
            />
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

      {/* Site list */}
      {currentlyLoading ? (
        <SiteSkeletons />
      ) : displaySites.length === 0 ? (
        <div className="py-16 text-center">
          <p className="text-sm text-gray-400">
            {showArchived
              ? 'No archived sites found.'
              : search
              ? 'No sites match your search.'
              : sites.length === 0
              ? 'No sites yet.'
              : 'No sites match this filter.'}
          </p>
          {!showArchived && sites.length === 0 && (
            <button
              type="button"
              onClick={() => setShowCreate(true)}
              className="mt-3 text-sm font-medium text-brand-blue hover:underline"
            >
              + New Site
            </button>
          )}
        </div>
      ) : showArchived ? (
        <div className="flex flex-col gap-2">
          {displaySites.map((site) => (
            <ArchivedSiteCard
              key={site.id}
              site={site}
              onRestore={() => handleRestore(site.id)}
            />
          ))}
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-2">
            {displaySites.map((site) => (
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

          {/* Load More */}
          {hasMore && (
            <div className="flex justify-center pt-2">
              <Button
                variant="outline"
                size="sm"
                className="text-xs"
                onClick={() => setPage((p) => p + 1)}
              >
                Load more ({filtered.length - paginated.length} remaining)
              </Button>
            </div>
          )}
        </>
      )}

      {/* Create Site modal */}
      <CreateSiteModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
      />

      {/* Site detail drawer */}
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
