import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Pencil } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button }   from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast }            from '@/components/ui/toast';
import { useSiteWorkOrders }   from '@/hooks/useSiteWorkOrders';
import { useSurveyReviewInfo } from '@/hooks/useSurveyReviewInfo';
import { useFieldEngineers }   from '@/hooks/useFieldEngineers';
import { useApprovers }        from '@/hooks/useApprovers';
import { useWorkOrderActions } from '@/hooks/useWorkOrderActions';
import { cn } from '@/lib/utils';
import type { WorkOrder, WorkOrderStage, WorkOrderStatus } from '@/types';

// ─── Constants ────────────────────────────────────────────────────────────────

const STAGE_LABEL: Record<WorkOrderStage, string> = {
  survey:        'Survey',
  repair:        'Repair',
  commissioning: 'Commissioning',
  amc:           'AMC',
};

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

function formatDate(d: Date): string {
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ─── Row ──────────────────────────────────────────────────────────────────────

function WorkOrderHistoryRow({
  workOrder,
  onOpen,
  onReassign,
}: {
  workOrder:  WorkOrder;
  onOpen:     () => void;
  onReassign: () => void;
}) {
  // One-time getDoc, not a listener — this is historical display data on an
  // already-reviewed (or not-yet-reviewed) record, not something the drawer
  // needs to react to live while it's open.
  const { info } = useSurveyReviewInfo(workOrder.id);
  const isOrphaned = workOrder.approverUid == null;

  return (
    <div className="border rounded-lg p-3 flex flex-col gap-2">
      <div
        className="flex items-start justify-between gap-2 cursor-pointer"
        onClick={onOpen}
      >
        <div className="min-w-0">
          <p className="text-sm font-bold text-gray-900 font-mono leading-snug">{workOrder.workOrderCode}</p>
          <p className="text-xs text-gray-400">{STAGE_LABEL[workOrder.stage]}</p>
        </div>
        <span className={cn('text-xs font-medium px-2 py-0.5 rounded-full shrink-0', STATUS_BADGE[workOrder.status])}>
          {STATUS_LABEL[workOrder.status]}
        </span>
      </div>

      <div className="flex flex-col gap-0.5 text-xs text-gray-600">
        <span>
          Engineer:{' '}
          {workOrder.assignedToName ?? <span className="italic text-gray-400">Unassigned</span>}
        </span>
        <span>
          Approver:{' '}
          {workOrder.approverName ?? <span className="italic text-gray-400">None</span>}
        </span>
        {workOrder.status === 'approved' && info?.reviewedAt && (
          <span>
            Approved by {info.reviewedByName ?? '—'} on {formatDate(info.reviewedAt)}
          </span>
        )}
      </div>

      {isOrphaned && (
        <div className="flex items-start gap-2 p-2 rounded bg-amber-50 border border-amber-200">
          <AlertTriangle className="h-3.5 w-3.5 text-amber-600 shrink-0 mt-0.5" />
          <span className="text-xs text-amber-800">
            No approver assigned — this survey cannot be reviewed until one is set.
          </span>
        </div>
      )}

      <div className="flex justify-end">
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs gap-1.5"
          onClick={(e) => { e.stopPropagation(); onReassign(); }}
        >
          <Pencil className="h-3 w-3" />
          Reassign
        </Button>
      </div>
    </div>
  );
}

// ─── Reassign dialog ──────────────────────────────────────────────────────────
//
// Approver is required here too — allowing "None" from this dialog would let
// an admin re-orphan a work order, undoing the whole point of this task.
// Engineer may still be cleared back to "Unassigned" — that's a normal state
// (a work order can exist before anyone's been assigned to do it).

function ReassignDialog({
  workOrder,
  open,
  onClose,
}: {
  workOrder: WorkOrder | null;
  open:      boolean;
  onClose:   () => void;
}) {
  const { engineers, loading: engLoading }  = useFieldEngineers();
  const { approvers, loading: apprLoading } = useApprovers();
  const { reassignWorkOrder, setWorkOrderApprover } = useWorkOrderActions();
  const { showToast } = useToast();

  const [engineerId, setEngineerId] = useState('');
  const [approverId, setApproverId] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !workOrder) return;
    setEngineerId(workOrder.assignedTo  ?? '');
    setApproverId(workOrder.approverUid ?? '');
  }, [open, workOrder]);

  async function handleSave() {
    if (!workOrder || !approverId) return;
    setSaving(true);
    try {
      const engineer = engineers.find((e) => e.uid === engineerId);
      const approver = approvers.find((a) => a.uid === approverId);

      if (engineerId !== (workOrder.assignedTo ?? '')) {
        await reassignWorkOrder(workOrder.id, workOrder.id, {
          assignedTo:     engineer?.uid         ?? null,
          assignedToName: engineer?.displayName ?? null,
        });
      }
      if (approverId !== (workOrder.approverUid ?? '')) {
        await setWorkOrderApprover(workOrder.id, workOrder.id, {
          approverUid:  approver?.uid         ?? null,
          approverName: approver?.displayName ?? null,
        });
      }
      showToast('Work order updated', 'success');
      onClose();
    } catch (err) {
      console.error('[ReassignDialog] update failed:', err);
      showToast('Failed to update work order', 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v && !saving) onClose(); }}>
      <DialogContent className="max-w-sm" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>Reassign Work Order</DialogTitle>
          {workOrder && <p className="text-xs text-gray-400 font-mono">{workOrder.workOrderCode}</p>}
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-gray-600">Field Engineer</label>
            {engLoading ? (
              <Skeleton className="h-9 rounded-md" />
            ) : (
              <Select value={engineerId || 'unassigned'} onValueChange={(v) => setEngineerId(v === 'unassigned' ? '' : v)}>
                <SelectTrigger disabled={saving}>
                  <SelectValue placeholder="Select engineer…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unassigned">Unassigned</SelectItem>
                  {engineers.map((e) => (
                    <SelectItem key={e.uid} value={e.uid}>
                      {e.displayName}
                      {e.engineerCode ? ` (${e.engineerCode})` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-gray-600">
              Approver <span className="text-brand-red">*</span>
            </label>
            {apprLoading ? (
              <Skeleton className="h-9 rounded-md" />
            ) : (
              <Select value={approverId} onValueChange={setApproverId}>
                <SelectTrigger disabled={saving}>
                  <SelectValue placeholder="Select approver…" />
                </SelectTrigger>
                <SelectContent>
                  {approvers.map((a) => (
                    <SelectItem key={a.uid} value={a.uid}>
                      {a.displayName}
                      {a.engineerCode ? ` (${a.engineerCode})` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {!approverId && (
              <p className="text-xs text-amber-600">
                A survey with no approver cannot be reviewed by anyone.
              </p>
            )}
          </div>

          <div className="flex gap-2 justify-end pt-1 border-t border-gray-100">
            <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button type="button" size="sm" onClick={handleSave} disabled={saving || !approverId}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Section ──────────────────────────────────────────────────────────────────

interface SiteWorkOrdersSectionProps {
  siteId:   string;
  /** Closes the parent site detail sheet before navigating to the review screen. */
  onNavigateAway?: () => void;
}

/**
 * Per-site work order history — "which surveys happened at this substation,
 * done by whom, approved by whom." Reassignment here is the fix path for a
 * work order created with no approver (see the orphan warning on each row).
 */
export function SiteWorkOrdersSection({ siteId, onNavigateAway }: SiteWorkOrdersSectionProps) {
  const navigate = useNavigate();
  const { workOrders, loading } = useSiteWorkOrders(siteId);
  const [reassignTarget, setReassignTarget] = useState<WorkOrder | null>(null);

  function openReview(workOrder: WorkOrder) {
    onNavigateAway?.();
    navigate(`/approvals/survey/${workOrder.id}`);
  }

  return (
    <div>
      <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
        Work Orders
      </h4>
      {loading ? (
        <div className="flex flex-col gap-2">
          {[...Array(2)].map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-lg" />
          ))}
        </div>
      ) : workOrders.length === 0 ? (
        <p className="text-xs text-gray-400 text-center py-4">
          No work orders created yet for this site.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {workOrders.map((wo) => (
            <WorkOrderHistoryRow
              key={wo.id}
              workOrder={wo}
              onOpen={() => openReview(wo)}
              onReassign={() => setReassignTarget(wo)}
            />
          ))}
        </div>
      )}

      <ReassignDialog
        workOrder={reassignTarget}
        open={!!reassignTarget}
        onClose={() => setReassignTarget(null)}
      />
    </div>
  );
}
