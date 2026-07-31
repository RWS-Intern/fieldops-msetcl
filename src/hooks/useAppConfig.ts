import { useState, useEffect } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/firebase/config';
import type { AppConfig } from '@/types';

// ─── Module-level cache ───────────────────────────────────────────────────────
let _cached: AppConfig | null = null;
let _cacheTime = 0;
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

const DEFAULT_CONFIG: AppConfig = {
  orgName:          'Rite Water Solutions',
  taskNumPrefix:    'RS',
  taskNumCounter:   0,
  mapDefaultLat:    20.5937,
  mapDefaultLng:    78.9629,
  mapDefaultZoom:   5,
};

// ─── Hook ─────────────────────────────────────────────────────────────────────

interface UseAppConfigResult {
  config: AppConfig;
  loading: boolean;
}

export function useAppConfig(): UseAppConfigResult {
  const [config, setConfig]   = useState<AppConfig>(_cached ?? DEFAULT_CONFIG);
  const [loading, setLoading] = useState(_cached === null);

  useEffect(() => {
    if (_cached !== null && Date.now() - _cacheTime < CACHE_TTL) {
      setConfig(_cached);
      setLoading(false);
      return;
    }

    async function load() {
      try {
        const snap = await getDoc(doc(db, 'appConfig', 'global'));
        if (snap.exists()) {
          const data = { ...DEFAULT_CONFIG, ...(snap.data() as AppConfig) };
          _cached    = data;
          _cacheTime = Date.now();
          setConfig(data);
        }
      } catch (err) {
        console.error('useAppConfig error:', err);
      } finally {
        setLoading(false);
      }
    }

    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { config, loading };
}
