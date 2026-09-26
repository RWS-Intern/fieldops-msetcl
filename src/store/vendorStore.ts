import { create } from 'zustand';
import type { Vendor } from '@/types';

/**
 * Session-wide vendor list, populated by the single VendorsListener mounted
 * in Layout. Mirrors userStore / siteStore — every consumer (Settings, the
 * Add User dropdown, the Engineers list, Reports) reads from here rather
 * than opening its own listener.
 */
interface VendorState {
  vendors:    Vendor[];
  loading:    boolean;
  setVendors: (vendors: Vendor[]) => void;
  setLoading: (v: boolean)        => void;
}

export const useVendorStore = create<VendorState>((set) => ({
  vendors:    [],
  loading:    true,
  setVendors: (vendors) => set({ vendors }),
  setLoading: (v)       => set({ loading: v }),
}));
