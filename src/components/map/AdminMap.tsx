import { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { useTaskStore } from '@/store/taskStore';
import { useAppConfig } from '@/hooks/useAppConfig';
import type { TaskStatus } from '@/types';

// ─── Constants ────────────────────────────────────────────────────────────────

const TOKEN = import.meta.env.VITE_MAPBOX_TOKEN as string | undefined;

/** Dot colours for each task status on the map */
const PIN_COLOURS: Record<TaskStatus, string> = {
  pending:     '#6B7280',
  in_progress: '#F59E0B',
  completed:   '#16A34A',
  blocked:     '#E63946',
};

/** Active background colour for each filter button */
const FILTER_COLOURS: Record<TaskStatus | 'all', string> = {
  all:         '#0077B6',
  pending:     '#9CA3AF',
  in_progress: '#F4A261',
  completed:   '#2A9D8F',
  blocked:     '#E63946',
};

const FILTER_LABELS: Record<TaskStatus | 'all', string> = {
  all:         'All',
  pending:     'Pending',
  in_progress: 'In Progress',
  completed:   'Completed',
  blocked:     'Blocked',
};

const FILTER_OPTIONS: (TaskStatus | 'all')[] = [
  'all', 'pending', 'in_progress', 'completed', 'blocked',
];

const SOURCE_ID           = 'tasks-source';
const LAYER_CLUSTERS      = 'clusters';
const LAYER_CLUSTER_COUNT = 'cluster-count';
const LAYER_UNCLUSTERED   = 'unclustered-point';

// ─── Popup HTML (built from GeoJSON feature properties) ───────────────────────

function buildPopupHTML(props: Record<string, unknown>): string {
  const status      = (props['status'] as string) ?? '';
  const colour      = PIN_COLOURS[status as TaskStatus] ?? '#6B7280';
  const statusLabel = status.replace('_', ' ');
  const siteCode    = props['siteCode'] as string | undefined;
  return `
    <div style="font-family:Inter,sans-serif;min-width:180px;padding:4px 0">
      <p style="font-size:10px;color:#9CA3AF;margin:0 0 2px">${props['taskNum'] ?? ''}</p>
      <p style="font-size:13px;font-weight:600;color:#111827;margin:0 0 6px;line-height:1.3">
        ${props['title'] ?? ''}
      </p>
      <div style="display:flex;align-items:center;gap:6px">
        <span style="
          font-size:11px;font-weight:500;
          background:${colour};color:white;
          padding:2px 7px;border-radius:99px;
          text-transform:capitalize
        ">${statusLabel}</span>
        <span style="font-size:11px;color:#6B7280">${props['assignedToName'] ?? ''}</span>
      </div>
      ${siteCode
        ? `<p style="font-size:11px;color:#6B7280;margin:4px 0 0">Site: ${siteCode}</p>`
        : ''}
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
  // Tracks whether the GeoJSON source + layers have been added to the map.
  // Avoids duplicate addSource/addLayer calls if this effect re-fires.
  const sourceAddedRef = useRef<boolean>(false);

  // mapReady flips to true inside map.on('load') — bridges Effect 1 → Effect 2.
  const [mapReady, setMapReady]         = useState(false);
  const [mapError, setMapError]         = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<TaskStatus | 'all'>('all');

  const { tasks }                          = useTaskStore();
  const { config, loading: configLoading } = useAppConfig();

  // ── Effect 1: Map initialisation ─────────────────────────────────────────
  // Runs ONCE after appConfig is loaded. Sets mapReady=true on the 'load'
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

  // ── Effect 2: Add GeoJSON source + layers (once, when map is ready) ───────
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
      clusterMaxZoom: 14,   // stop clustering beyond zoom 14
      clusterRadius:  40,   // pixels within which points are merged
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
          '#0077B6',       // 1 – 9
          10, '#0096C7',   // 10 – 29
          30, '#00B4D8',   // 30+
        ],
        'circle-radius': [
          'step', ['get', 'point_count'],
          18,        // 1 – 9
          10, 22,    // 10 – 29
          30, 28,    // 30+
        ],
        'circle-stroke-width': 2,
        'circle-stroke-color': '#ffffff',
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

    // ── Individual (unclustered) point ────────────────────────────────────
    map.addLayer({
      id:     LAYER_UNCLUSTERED,
      type:   'circle',
      source: SOURCE_ID,
      filter: ['!', ['has', 'point_count']],
      paint:  {
        'circle-color': [
          'match', ['get', 'status'],
          'pending',     PIN_COLOURS.pending,
          'in_progress', PIN_COLOURS.in_progress,
          'completed',   PIN_COLOURS.completed,
          'blocked',     PIN_COLOURS.blocked,
          /* default */  '#6B7280',
        ],
        'circle-radius':       8,
        'circle-stroke-width': 2,
        'circle-stroke-color': '#ffffff',
      },
    });

    // ── Click cluster → zoom in to expand ────────────────────────────────
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

    // ── Click individual point → popup ────────────────────────────────────
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
    map.on('mouseenter', LAYER_CLUSTERS,      () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', LAYER_CLUSTERS,      () => { map.getCanvas().style.cursor = ''; });
    map.on('mouseenter', LAYER_UNCLUSTERED,   () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', LAYER_UNCLUSTERED,   () => { map.getCanvas().style.cursor = ''; });

    sourceAddedRef.current = true;
  }, [mapReady]);

  // ── Effect 3: Push updated GeoJSON to the source ──────────────────────────
  // Fires whenever tasks stream in from Firestore, the filter changes, or
  // the map first becomes ready. Calls source.setData() — no layers touched.
  useEffect(() => {
    if (!mapReady || !sourceAddedRef.current) return;
    const map = mapRef.current;
    if (!map) return;

    const source = map.getSource(SOURCE_ID) as mapboxgl.GeoJSONSource | undefined;
    if (!source) return;

    // Apply status filter; only include tasks with a valid GPS fix
    const visible = tasks.filter((t) => {
      if (!t.location?.lat || !t.location?.lng) return false;
      return activeFilter === 'all' || t.status === activeFilter;
    });

    const geojson: GeoJSON.FeatureCollection = {
      type:     'FeatureCollection',
      features: visible.map((t) => ({
        type:     'Feature',
        geometry: {
          type:        'Point',
          coordinates: [t.location!.lng, t.location!.lat],
        },
        properties: {
          taskId:         t.id,
          taskNum:        t.taskNum,
          title:          t.title,
          status:         t.status,
          assignedToName: t.assignedToName,
          siteCode:       t.siteCode ?? '',
        },
      })),
    };

    source.setData(geojson);

    // Auto-fit bounds to show all visible pins
    if (visible.length > 0) {
      const bounds = new mapboxgl.LngLatBounds();
      visible.forEach((t) => bounds.extend([t.location!.lng, t.location!.lat]));
      map.fitBounds(bounds, { padding: 80, maxZoom: 14, duration: 500 });
    }
  }, [tasks, mapReady, activeFilter]);

  // ── Derived counts ────────────────────────────────────────────────────────
  const totalForFilter =
    activeFilter === 'all'
      ? tasks.length
      : tasks.filter((t) => t.status === activeFilter).length;

  const pinnedForFilter =
    activeFilter === 'all'
      ? tasks.filter((t) => t.location?.lat && t.location?.lng).length
      : tasks.filter(
          (t) => t.status === activeFilter && t.location?.lat && t.location?.lng
        ).length;

  // ── Error state ───────────────────────────────────────────────────────────
  if (mapError) {
    return (
      <div
        className={`flex items-center justify-center rounded-xl bg-gray-100 text-gray-500 text-sm p-6 ${className}`}
      >
        {mapError}
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div>
      {/* ── Filter buttons ─────────────────────────────────────────────── */}
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
                isActive
                  ? { backgroundColor: colour, borderColor: colour }
                  : {}
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

      {/* ── Map canvas ─────────────────────────────────────────────────── */}
      <div
        className={`relative rounded-xl overflow-hidden shadow-sm border border-gray-200 ${className}`}
      >
        <div ref={containerRef} className="w-full h-full" />
      </div>

      {/* ── Count line / empty state ────────────────────────────────────── */}
      {pinnedForFilter === 0 ? (
        <p className="mt-2 text-xs text-gray-400">
          No tasks with GPS location for this filter.
        </p>
      ) : (
        <p className="mt-2 text-xs text-gray-400">
          Showing {pinnedForFilter} of {totalForFilter} task
          {totalForFilter !== 1 ? 's' : ''} on map
        </p>
      )}
    </div>
  );
}
