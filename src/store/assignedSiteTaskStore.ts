import { create } from 'zustand';
import type { SiteTask } from '@/types';

interface AssignedSiteTaskState {
  assignedSiteTasks:    SiteTask[];
  setAssignedSiteTasks: (tasks: SiteTask[]) => void;
}

export const useAssignedSiteTaskStore = create<AssignedSiteTaskState>((set) => ({
  assignedSiteTasks:    [],
  setAssignedSiteTasks: (tasks) => set({ assignedSiteTasks: tasks }),
}));
