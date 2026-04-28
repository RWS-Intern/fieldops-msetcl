import { useProjectStore } from '@/store/projectStore';
import type { ProjectStats } from '@/types';

/** Derives live project stats from the in-memory projectStore. No Firestore query. */
export function useRealtimeProjectStats(): ProjectStats {
  const projects = useProjectStore((s) => s.projects);

  return {
    all:         projects.length,
    pending:     projects.filter((p) => p.status === 'pending').length,
    in_progress: projects.filter((p) => p.status === 'in_progress').length,
    completed:   projects.filter((p) => p.status === 'completed').length,
    blocked:     projects.filter((p) => p.status === 'blocked').length,
  };
}
