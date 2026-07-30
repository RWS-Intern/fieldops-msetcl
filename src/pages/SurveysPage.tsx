import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAssignedWorkOrders } from '@/hooks/useAssignedWorkOrders';
import { listDrafts }            from '@/lib/surveyDraftStore';
import { useSurveySubmitQueue }  from '@/lib/surveySubmitQueue';
import { Skeleton }              from '@/components/ui/skeleton';
import type { WorkOrder, WorkOrderStatus } from '@/types';

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_BADGE: Record<WorkOrderStatus, string> = {
  open:              'bg-gray-100 text-gray-600',
  in_progress:       'bg-amber-50 text-amber-700',
  pending_approval:  'bg-violet-50 text-violet-700',
  changes_requested: 'bg-orange-50 text-orange-700',
  approved:          'bg-green-50 text-green-700',
  closed:            'bg-gray-200 text-gray-600',
};

const STATUS_LABEL: Record<WorkOrderStatus, string> = {
  open:              'Open',
  in_progress:       'In Progress',
  pending_approval:  'Pending Approval',
  changes_requested: 'Changes Requested',
  approved:          'Approved',
  closed:            'Closed',
};

// ─── Row ──────────────────────────────────────────────────────────────────────

function WorkOrderRow({
  workOrder,
  hasDraft,
  onOpen,
}: {
  workOrder: WorkOrder;
  hasDraft:  boolean;
  onOpen:    () => void;
}) {
  return (
    <div
      className="flex rounded-lg border border-gray-100 bg-white shadow-sm overflow-hidden cursor-pointer hover:border-brand-blue transition-colors"
      onClick={onOpen}
    >
      <div className="flex-1 p-3 min-w-0">
        <div className="flex items-start justify-between gap-2 mb-0.5">
          <span className="text-sm font-bold text-gray-900 font-mono leading-snug truncate">
            {workOrder.siteCode}
          </span>
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full shrink-0 ${STATUS_BADGE[workOrder.status]}`}>
            {STATUS_LABEL[workOrder.status]}
          </span>
        </div>
        <p className="text-xs text-gray-400 font-mono">{workOrder.workOrderCode}</p>
        {hasDraft && (
          <p className="text-xs text-brand-blue mt-1">Draft saved locally</p>
        )}
      </div>
      <div className="flex items-center pr-3 shrink-0">
        <button
          onClick={(e) => { e.stopPropagation(); onOpen(); }}
          className="text-xs border border-gray-300 rounded px-3 py-1 hover:border-blue-400 hover:text-blue-600 transition-colors"
        >
          Open
        </button>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function SurveysPage() {
  const navigate = useNavigate();
  const { workOrders, loading } = useAssignedWorkOrders();
  const { queueCount } = useSurveySubmitQueue();
  const [draftIds, setDraftIds] = useState<Set<string>>(new Set());

  // Local drafts — re-listed whenever the offline submit queue changes
  // (queueCount ticks on enqueue/dequeue), not just once on mount. Without
  // this, a draft that SurveyQueueProcessor deletes after a successful
  // background drain leaves this page showing "Draft saved locally" for a
  // draft that no longer exists, since that deletion happens while this page
  // may already be sitting mounted (the user never navigated away).
  useEffect(() => {
    listDrafts()
      .then((drafts) => setDraftIds(new Set(drafts.map((d) => d.workOrderId))))
      .catch(() => setDraftIds(new Set()));
  }, [queueCount]);

  return (
    <div className="flex flex-col gap-4 max-w-2xl mx-auto pb-24">
      <div className="flex items-center gap-2">
        <h2 className="text-xl font-bold text-gray-900">Surveys</h2>
        <span className="rounded-full bg-brand-blue/10 text-brand-blue text-xs font-semibold px-2 py-0.5">
          {workOrders.length}
        </span>
      </div>

      {loading ? (
        <div className="flex flex-col gap-2">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-lg" />
          ))}
        </div>
      ) : workOrders.length === 0 ? (
        <div className="py-16 text-center">
          <p className="text-sm text-gray-400">No surveys assigned yet.</p>
          <p className="text-xs text-gray-300 mt-2">
            Your assigned survey work orders will appear here.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {workOrders.map((wo) => (
            <WorkOrderRow
              key={wo.id}
              workOrder={wo}
              hasDraft={draftIds.has(wo.id)}
              onOpen={() => navigate(`/survey/${wo.id}`)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
