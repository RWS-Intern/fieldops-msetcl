import { useState } from 'react';
import { useApprovalQueue }         from '@/hooks/useApprovalQueue';
import { SiteTaskCard }             from '@/components/siteTasks/SiteTaskCard';
import { ReviewSiteTaskDrawer }     from '@/components/siteTasks/ReviewSiteTaskDrawer';
import { Skeleton }                 from '@/components/ui/skeleton';
import type { SiteTask } from '@/types';

export function ApprovalsPage() {
  const { queue, loading }              = useApprovalQueue();
  const [selectedTask, setSelectedTask] = useState<SiteTask | null>(null);

  return (
    <div className="flex flex-col gap-4 max-w-2xl mx-auto pb-24">
      <div className="flex items-center gap-2">
        <h2 className="text-xl font-bold text-gray-900">Approvals</h2>
        <span className="rounded-full bg-violet-100 text-violet-700 text-xs font-semibold px-2 py-0.5">
          {queue.length}
        </span>
      </div>

      {loading ? (
        <div className="flex flex-col gap-2">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-lg" />
          ))}
        </div>
      ) : queue.length === 0 ? (
        <div className="py-16 text-center">
          <p className="text-sm text-gray-400">Nothing awaiting your approval.</p>
          <p className="text-xs text-gray-300 mt-2">
            Tasks submitted for approval will appear here.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {queue.map((task) => (
            <SiteTaskCard
              key={task.id}
              task={task}
              onUpdate={() => setSelectedTask(task)}
              actionLabel="Review"
            />
          ))}
        </div>
      )}

      {selectedTask && (
        <ReviewSiteTaskDrawer
          task={selectedTask}
          open={!!selectedTask}
          onClose={() => setSelectedTask(null)}
        />
      )}
    </div>
  );
}
