import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAssignedWorkOrders } from '@/hooks/useAssignedWorkOrders';
import { listDrafts }            from '@/lib/surveyDraftStore';
import { useSurveySubmitQueue }  from '@/lib/surveySubmitQueue';
import { Skeleton }              from '@/components/ui/skeleton';
import { FilterPills }           from '@/components/ui/filter-pills';
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

/**
 * Status pills for the field engineer's own survey list.
 *
 * Deliberately NOT a copy of TasksPage's pill set. A WorkOrder has no
 * `pending` and no `blocked` status, so those two pills could only ever read
 * zero. Their real equivalents are `open` (a survey assigned but not started)
 * and, for a finished one, `approved` / `closed`.
 *
 * Every key here is a status the row badge can actually display, so a survey
 * badged "Approved" is always findable under the Approved pill — a pill set
 * that disagreed with the badges would be worse than no pills.
 */
type SurveyFilter = WorkOrderStatus | 'all';

const STATUS_PILLS: readonly { key: SurveyFilter; label: string }[] = [
  { key: 'all',               label: 'All'               },
  { key: 'open',              label: 'Open'              },
  { key: 'in_progress',       label: 'In Progress'       },
  { key: 'pending_approval',  label: 'Pending Approval'  },
  { key: 'changes_requested', label: 'Changes Requested' },
  { key: 'approved',          label: 'Approved'          },
  { key: 'closed',            label: 'Closed'            },
];

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
        {/* Substation name, matching AdminSurveyOversightPage's row so the
            field list and the oversight list read identically. Guarded: the
            field is '' on work orders written before it was denormalised, and
            an empty line would just push the row taller. */}
        {workOrder.siteName && (
          <p className="text-sm font-semibold text-gray-800 leading-snug truncate">
            {workOrder.siteName}
          </p>
        )}
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
  const [search,       setSearch]       = useState('');
  const [activeFilter, setActiveFilter] = useState<SurveyFilter>('all');

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

  // Counts are over the UNFILTERED list, so each pill always shows how many
  // surveys it would reveal rather than how many survive the current pill.
  const counts = useMemo(() => {
    const base = Object.fromEntries(
      STATUS_PILLS.map((p) => [p.key, 0]),
    ) as Record<SurveyFilter, number>;
    base.all = workOrders.length;
    workOrders.forEach((w) => { base[w.status] = (base[w.status] ?? 0) + 1; });
    return base;
  }, [workOrders]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return workOrders.filter((w) => {
      if (activeFilter !== 'all' && w.status !== activeFilter) return false;
      if (!q) return true;
      // Substation name first — it is what an engineer actually knows a site
      // by; the codes are there for anyone reading off a work order.
      return (
        w.siteName.toLowerCase().includes(q) ||
        w.siteCode.toLowerCase().includes(q) ||
        w.workOrderCode.toLowerCase().includes(q)
      );
    });
  }, [workOrders, activeFilter, search]);

  const hasQuery = !!search.trim() || activeFilter !== 'all';

  return (
    <div className="flex flex-col gap-4 max-w-2xl mx-auto pb-24">
      <div className="flex items-center gap-2">
        <h2 className="text-xl font-bold text-gray-900">Surveys</h2>
        <span className="rounded-full bg-brand-blue/10 text-brand-blue text-xs font-semibold px-2 py-0.5">
          {hasQuery ? `${visible.length}/${workOrders.length}` : workOrders.length}
        </span>
      </div>

      {/* Search + status pills — hidden while there is nothing to filter, so
          an engineer with no surveys sees the empty state, not empty controls. */}
      {!loading && workOrders.length > 0 && (
        <>
          <div className="relative">
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none"
              fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
            </svg>
            <input
              type="search"
              placeholder="Search by substation, site code, or WO number…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-lg border border-gray-200 bg-white pl-9 pr-4 py-2 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-blue/30 focus:border-brand-blue"
            />
          </div>

          <FilterPills
            pills={STATUS_PILLS}
            active={activeFilter}
            onChange={setActiveFilter}
            counts={counts}
            ariaLabel="Filter surveys by status"
          />
        </>
      )}

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
      ) : visible.length === 0 ? (
        <div className="py-16 text-center">
          <p className="text-sm text-gray-400">No surveys match your search or filter.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {visible.map((wo) => (
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
