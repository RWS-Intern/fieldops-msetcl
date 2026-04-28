import { create } from 'zustand';
import type { Project } from '@/types';

interface ProjectState {
  projects: Project[];
  setProjects: (projects: Project[]) => void;
  lastUpdated: Date | null;
  setLastUpdated: (date: Date) => void;
}

export const useProjectStore = create<ProjectState>((set) => ({
  projects:     [],
  setProjects:  (projects) => set({ projects }),
  lastUpdated:  null,
  setLastUpdated: (date) => set({ lastUpdated: date }),
}));
