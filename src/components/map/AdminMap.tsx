import { useEffect, useRef, useState, useMemo } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { useSiteStore } from '@/store/siteStore';
import { useAppConfig } from '@/hooks/useAppConfig';
import type { Site } from '@/types';

// ─── Types ────────────────────────────────────────────────────────────────────

type AggregateStatus = 'pending' | 'in_progress' | 'completed' | 'blocked';

// ─── Constants ────────────────────────────────────────────────────────────────

const TOKEN = import.meta.env.VITE_MAPBOX_TOKEN as string | undefined;

/** Colours for each aggregate-status value on the unclustered pin layer. */
const STATUS_COLOURS: Record<AggregateStatus, string> = {
  pending:     '#9CA3AF',
  in_progress: '#F4A261',
  completed:   '#2A9D8F',
  blocked:     '#E63946',
};

/** Active background colour for each status filter pill. */
const FILTER_COLOURS: Record<AggregateStatus | 'all', string> = {
  all:         '#0077B6',
  pending:     '#9CA3AF',
  in_progress: '#F4A261',
  completed:   '#2A9D8F',
  blocked:     '#E63946',
};

const FILTER_LABELS: Record<AggregateStatus | 'all', string> = {
  all:         'All',
  pending:     'Pending',
  in_progress: 'In Progress',
  completed:   'Completed',
  blocked:     'Blocked',
};

const FILTER_OPTIONS: (AggregateStatus | 'all')[] = [
  'all', 'pending', 'in_progress', 'completed', 'blocked',
];

const SOURCE_ID           = 'sites';
const LAYER_CLUSTERS      = 'clusters';
const LAYER_CLUSTER_COUNT = 'cluster-count';
const LAYER_UNCLUSTERED   = 'unclustered-site';

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/**
 * Derive the aggregate task status for a site from its denormalised task
 * counters. Uses the atomic counters written by submitSiteTaskUpdate.
 * ?? 0 guards against legacy documents that pre-date the new fields.
 */
function getSiteAggregateStatus(site: Site): AggregateStatus {
  if (site.taskCount === 0)                                          return 'pending';
  if ((site.blockedTaskCount ?? 0) > 0)                             return 'blocked';
  if (site.completedTaskCount === site.taskCount)                    return 'completed';
  if ((site.inProgressTaskCount ?? 0) > 0 || site.completedTaskCount > 0) return 'in_progress';
  return 'pending';
}

function buildPopupHTML(props: Record<string, unknown>): string {
  const aggStatus      = (props['aggregateStatus'] as AggregateStatus) ?? 'pending';
  const colour         = STATUS_COLOURS[aggStatus] ?? STATUS_COLOURS.pending;
  const statusLabel    = aggStatus.replace('_', ' ');
  const completedCount = Number(props['completedTaskCount'] ?? 0);
  const taskCount      = Number(props['taskCount'] ?? 0);
  const completionPct  = Number(props['completionPct'] ?? 0);
  const projectCode    = props['projectCode'] as string | undefined;

  return `
    <div style="
      font-family: Inter, Arial, sans-serif;
      min-width: 200px;
      padding: 4px 0;
    ">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:2px">
        <span style="
          font-size: 12px;
          font-weight: 700;
          color: #023E6B;
          font-family: monospace;
        ">${props['siteCode'] ?? ''}</span>
        ${projectCode
          ? `<span style="font-size:11px;color:#6B7280">[${projectCode}]</span>`
          : ''}
      </div>
      <p style="
        font-size: 13px;
        font-weight: 600;
        color: #111827;
        margin: 0 0 2px;
        line-height: 1.3;
      ">${props['siteName'] ?? ''}</p>
      <p style="
        font-size: 11px;
        color: #6B7280;
        margin: 0 0 8px;
      ">${props['projectName'] ?? ''} · ${props['city'] ?? ''}</p>
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
        <span style="
          display: inline-block;
          width: 8px; height: 8px;
          border-radius: 50%;
          background: ${colour};
          flex-shrink: 0;
        "></span>
        <span style="
          font-size: 12px;
          color: #374151;
          text-transform: capitalize;
        ">${statusLabel}</span>
      </div>
      <p style="font-size:11px;color:#6B7280;margin:0">
        ${completedCount} of ${taskCount} task${taskCount !== 1 ? 's' : ''} completed
        (${completionPct}%)
      </p>
    </div>
  `;
}

// ─── Component ────────────────────────────────────────────────────────────────

interface AdminMapProps {
  /** Tailwind classes applied to the map canvas container (e.g. "h-64") */
  className?: string;
}

export function AdminMap({ className = '' }: AdminMapProps) {
  const containerRef   = useRef<HTMLDivElement>(null);
  const mapRef         = useRef<mapboxgl.Map | null>(null);
  // Guards against duplicate addSource/addLayer calls if Effect 2 re-fires.
  const sourceAddedRef = useRef<boolean>(false);

  // mapReady bridges Effect 1 → Effect 2.
  const [mapReady,  setMapReady]  = useState(false);
  const [mapError,  setMapError]  = useState<string | null>(null);

  // ── Filter state ────────────────────────────────────────────────────────────
  const [activeFilter,    setActiveFilter]    = useState<AggregateStatus | 'all'>('all');
  const [activeProjectId, setActiveProjectId] = useState<string>('all');
  const [activeCity,      setActiveCity]      = useState<string>('all');

  const { sites }                          = useSiteStore();
  const { config, loading: configLoading } = useAppConfig();

  // ── Derived dropdown options (non-archived sites only) ──────────────────────
  const uniqueProjects = useMemo(() => {
    const seen = new Map<string, string>(); // projectId → projectName
    sites
      .filter((s) => !s.archived)
      .forEach((s) => {
        if (s.projectId && !seen.has(s.projectId)) {
          seen.set(s.projectId, s.projectName);
        }
      });
    return Array.from(seen.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [sites]);

  const uniqueCities = useMemo(() => {
    const seen = new Set<string>();
    sites.filter((s) => !s.archived).forEach((s) => {
      if (s.city) seen.add(s.city);
    });
    return Array.from(seen).sort();
  }, [sites]);

  // ── Effect 1: Map initialisation ────────────────────────────────────────────
  // Runs once after appConfig is loaded. Sets mapReady=true on the 'load'
  // event so Effect 2 can safely add the GeoJSON source and layers.
  useEffect(() => {
    if (configLoading || mapRef.current || !containerRef.current) return;

    if (!TOKEN) {
      setMapError('Mapbox token not configured (VITE_MAPBOX_TOKEN missing)');
      return;
    }

    mapboxgl.accessToken = TOKEN;

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style:     'mapbox://styles/mapbox/light-v11',
      center:    [config.mapDefaultLng, config.mapDefaultLat],
      zoom:      config.mapDefaultZoom,
    });

    map.addControl(new mapboxgl.NavigationControl(), 'top-right');
    map.addControl(new mapboxgl.FullscreenControl(),  'top-right');

    map.on('load', () => setMapReady(true));

    mapRef.current = map;

    return () => {
      sourceAddedRef.current = false;
      map.remove();
      mapRef.current = null;
      setMapReady(false);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configLoading]);

  // ── Effect 2: Add GeoJSON source + layers (once, when map is ready) ─────────
  // Adds the clustering source, three layers, click handlers, and cursor
  // changes. Runs only once because sourceAddedRef guards against re-entry.
  useEffect(() => {
    if (!mapReady) return;
    const map = mapRef.current;
    if (!map || sourceAddedRef.current) return;

    // ── GeoJSON source with Mapbox clustering ─────────────────────────────
    map.addSource(SOURCE_ID, {
      type:           'geojson',
      data:           { type: 'FeatureCollection', features: [] },
      cluster:        true,
      clusterMaxZoom: 14,
      clusterRadius:  50,
    });

    // ── Cluster circle ────────────────────────────────────────────────────
    map.addLayer({
      id:     LAYER_CLUSTERS,
      type:   'circle',
      source: SOURCE_ID,
      filter: ['has', 'point_count'],
      paint:  {
        'circle-color': [
          'step', ['get', 'point_count'],
          '#0077B6',       // 1–9
          10, '#0096C7',   // 10–29
          30, '#00B4D8',   // 30+
        ],
        'circle-radius': [
          'step', ['get', 'point_count'],
          20,        // 1–9
          10, 25,    // 10–29
          30, 30,    // 30+
        ],
        'circle-stroke-width': 2,
        'circle-stroke-color': '#ffffff',
        'circle-opacity':      0.9,
      },
    });

    // ── Cluster count label ───────────────────────────────────────────────
    map.addLayer({
      id:     LAYER_CLUSTER_COUNT,
      type:   'symbol',
      source: SOURCE_ID,
      filter: ['has', 'point_count'],
      layout: {
        'text-field': '{point_count_abbreviated}',
        'text-font':  ['DIN Offc Pro Medium', 'Arial Unicode MS Bold'],
        'text-size':  13,
      },
      paint: { 'text-color': '#ffffff' },
    });

    // ── Unclustered site pin — coloured by aggregateStatus ────────────────
    map.addLayer({
      id:     LAYER_UNCLUSTERED,
      type:   'circle',
      source: SOURCE_ID,
      filter: ['!', ['has', 'point_count']],
      paint:  {
        'circle-color': [
          'match', ['get', 'aggregateStatus'],
          'pending',     STATUS_COLOURS.pending,
          'in_progress', STATUS_COLOURS.in_progress,
          'completed',   STATUS_COLOURS.completed,
          'blocked',     STATUS_COLOURS.blocked,
          /* default */  STATUS_COLOURS.pending,
        ],
        'circle-radius':       10,
        'circle-stroke-width': 2,
        'circle-stroke-color': '#ffffff',
      },
    });

    // ── Click cluster → zoom to expand ────────────────────────────────────
    map.on('click', LAYER_CLUSTERS, (e) => {
      const features = map.queryRenderedFeatures(e.point, { layers: [LAYER_CLUSTERS] });
      if (!features.length) return;

      const clusterId = features[0].properties?.['cluster_id'] as number;
      const source    = map.getSource(SOURCE_ID) as mapboxgl.GeoJSONSource;
      const coords    = (features[0].geometry as GeoJSON.Point).coordinates as [number, number];

      source.getClusterExpansionZoom(clusterId, (err, zoom) => {
        if (err) return;
        map.easeTo({ center: coords, zoom: zoom ?? 12 });
      });
    });

    // ── Click site pin → popup ────────────────────────────────────────────
    map.on('click', LAYER_UNCLUSTERED, (e) => {
      if (!e.features?.length) return;
      const feature = e.features[0];
      const props   = feature.properties as Record<string, unknown>;
      const coords  = (feature.geometry as GeoJSON.Point).coordinates as [number, number];

      new mapboxgl.Popup({ offset: 12, closeButton: false })
        .setLngLat(coords)
        .setHTML(buildPopupHTML(props))
        .addTo(map);
    });

    // ── Cursor: pointer on hover ──────────────────────────────────────────
    map.on('mouseenter', LAYER_CLUSTERS,    () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', LAYER_CLUSTERS,    () => { map.getCanvas().style.cursor = ''; });
    map.on('mouseenter', LAYER_UNCLUSTERED, () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', LAYER_UNCLUSTERED, () => { map.getCanvas().style.cursor = ''; });

    sourceAddedRef.current = true;
  }, [mapReady]);

  // ── Effect 3: Push updated GeoJSON to the source ────────────────────────────
  // Fires whenever sites load/update from Firestore, any filter changes, or
  // the map first becomes ready. Calls source.setData() — no layers touched.
  useEffect(() => {
    if (!mapReady || !sourceAddedRef.current) return;
    const map = mapRef.current;
    if (!map) return;

    const source = map.getSource(SOURCE_ID) as mapboxgl.GeoJSONSource | undefined;
    if (!source) return;

    // Apply all three filters; exclude archived sites
    const filteredSites = sites.filter((s) => {
      if (s.archived) return false;
      const aggStatus    = getSiteAggregateStatus(s);
      const statusMatch  = activeFilter === 'all' || aggStatus === activeFilter;
      const projectMatch = activeProjectId === 'all' || s.projectId === activeProjectId;
      const cityMatch    = activeCity === 'all' || s.city === activeCity;
      return statusMatch && projectMatch && cityMatch;
    });

    // Only sites with a valid GPS fix appear as map pins
    const visible = filteredSites.filter(
      (s) => s.location?.lat && s.location?.lng
    );

    const geojson: GeoJSON.FeatureCollection = {
      type:     'FeatureCollection',
      features: visible.map((s) => ({
        type:     'Feature',
        geometry: {
          type:        'Point',
          coordinates: [s.location!.lng, s.location!.lat],
        },
        properties: {
          siteId:             s.id,
          siteCode:           s.siteCode,
          siteName:           s.siteName,
          city:               s.city,
          projectId:          s.projectId,
          projectName:        s.projectName,
          projectCode:        s.projectCode,
          status:             s.status,
          aggregateStatus:    getSiteAggregateStatus(s),
          taskCount:          s.taskCount,
          completedTaskCount: s.completedTaskCount,
          completionPct:
            s.taskCount > 0
              ? Math.round((s.completedTaskCount / s.taskCount) * 100)
              : 0,
        },
      })),
    };

    source.setData(geojson);

    // Auto-fit bounds to show all visible pins
    if (visible.length > 0) {
      const bounds = new mapboxgl.LngLatBounds();
      visible.forEach((s) => bounds.extend([s.location!.lng, s.location!.lat]));
      map.fitBounds(bounds, { padding: 60, maxZoom: 14, duration: 500 });
    }
  }, [sites, mapReady, activeFilter, activeProjectId, activeCity]);

  // ── Derived counts for the counter line (Part 9) ─────────────────────────────
  // Recompute outside the effect so the UI updates synchronously with filters.
  const filteredForCount = sites.filter((s) => {
    if (s.archived) return false;
    const aggStatus    = getSiteAggregateStatus(s);
    const statusMatch  = activeFilter === 'all' || aggStatus === activeFilter;
    const projectMatch = activeProjectId === 'all' || s.projectId === activeProjectId;
    const cityMatch    = activeCity === 'all' || s.city === activeCity;
    return statusMatch && projectMatch && cityMatch;
  });

  const totalForFilter  = filteredForCount.length;
  const pinnedForFilter = filteredForCount.filter(
    (s) => s.location?.lat && s.location?.lng
  ).length;
  const noGpsCount = totalForFilter - pinnedForFilter;

  // ── Error state ───────────────────────────────────────────────────────────────
  if (mapError) {
    return (
      <div
        className={`flex items-center justify-center rounded-xl bg-gray-100 text-gray-500 text-sm p-6 ${className}`}
      >
        {mapError}
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div>
      {/* ── Status filter pills ─────────────────────────────────────────── */}
      <div className="flex gap-2 mb-3 flex-wrap">
        {FILTER_OPTIONS.map((f) => {
          const isActive = activeFilter === f;
          const colour   = FILTER_COLOURS[f];
          return (
            <button
              key={f}
              type="button"
              onClick={() => setActiveFilter(f)}
              style={
                isActive ? { backgroundColor: colour, borderColor: colour } : {}
              }
              className={[
                'px-2 py-1 rounded-full text-xs font-medium border transition-colors',
                isActive
                  ? 'text-white'
                  : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300 hover:bg-gray-50',
              ].join(' ')}
            >
              {FILTER_LABELS[f]}
            </button>
          );
        })}
      </div>

      {/* ── Project + City filter dropdowns ────────────────────────────── */}
      {(uniqueProjects.length > 1 || uniqueCities.length > 1) && (
        <div className="flex gap-2 mb-3 flex-wrap">
          {uniqueProjects.length > 1 && (
            <select
              value={activeProjectId}
              onChange={(e) => setActiveProjectId(e.target.value)}
              className="px-2.5 py-1 rounded-lg text-xs border border-gray-200 bg-white text-gray-600 focus:outline-none focus:ring-1 focus:ring-brand-blue/40 focus:border-brand-blue cursor-pointer"
            >
              <option value="all">All Projects</option>
              {uniqueProjects.map(({ id, name }) => (
                <option key={id} value={id}>{name}</option>
              ))}
            </select>
          )}
          {uniqueCities.length > 1 && (
            <select
              value={activeCity}
              onChange={(e) => setActiveCity(e.target.value)}
              className="px-2.5 py-1 rounded-lg text-xs border border-gray-200 bg-white text-gray-600 focus:outline-none focus:ring-1 focus:ring-brand-blue/40 focus:border-brand-blue cursor-pointer"
            >
              <option value="all">All Cities</option>
              {uniqueCities.map((city) => (
                <option key={city} value={city}>{city}</option>
              ))}
            </select>
          )}
        </div>
      )}

      {/* ── Map canvas ──────────────────────────────────────────────────── */}
      <div
        className={`relative rounded-xl overflow-hidden shadow-sm border border-gray-200 ${className}`}
      >
        <div ref={containerRef} className="w-full h-full" />
      </div>

      {/* ── Counter line (Part 9) ────────────────────────────────────────── */}
      <p className="mt-2 text-xs text-gray-400">
        {totalForFilter === 0
          ? 'No sites match the current filters.'
          : pinnedForFilter === 0
          ? `${totalForFilter} site${totalForFilter !== 1 ? 's' : ''} match — none have GPS coordinates yet.`
          : (
            <>
              Showing{' '}
              <span className="font-medium text-gray-600">{pinnedForFilter}</span>
              {' '}of{' '}
              <span className="font-medium text-gray-600">{totalForFilter}</span>
              {' '}site{totalForFilter !== 1 ? 's' : ''} on map
              {noGpsCount > 0 && (
                <> ({noGpsCount} have no GPS location yet)</>
              )}
            </>
          )
        }
      </p>
    </div>
  );
}
