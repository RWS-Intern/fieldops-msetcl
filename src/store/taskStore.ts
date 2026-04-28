import { create } from 'zustand';
import type { Task } from '@/types';

interface TaskState {
  tasks: Task[];
  setTasks: (tasks: Task[]) => void;
  lastUpdated: Date | null;
  setLastUpdated: (date: Date) => void;
  isConnected: boolean;
  setIsConnected: (v: boolean) => void;
}

export const useTaskStore = create<TaskState>((set) => ({
  tasks: [],
  setTasks: (tasks) => set({ tasks }),
  lastUpdated: null,
  setLastUpdated: (date) => set({ lastUpdated: date }),
  isConnected: false,
  setIsConnected: (v) => set({ isConnected: v }),
}));
