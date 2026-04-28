import { create } from 'zustand';
import type { Site } from '@/types';

interface SiteState {
  sites: Site[];
  setSites: (sites: Site[]) => void;
  lastUpdated: Date | null;
  setLastUpdated: (date: Date) => void;
}

export const useSiteStore = create<SiteState>((set) => ({
  sites:          [],
  setSites:       (sites) => set({ sites }),
  lastUpdated:    null,
  setLastUpdated: (date) => set({ lastUpdated: date }),
}));
