import { useState, useEffect } from 'react';
import { Clock } from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button }             from '@/components/ui/button';
import { Textarea }           from '@/components/ui/textarea';
import { useToast }           from '@/components/ui/toast';
import { useSiteTaskActions } from '@/hooks/useSiteTaskActions';
import { ReadOnlyTaskBody }   from '@/components/siteTasks/UpdateSiteTaskDrawer';
import type { SiteTask } from '@/types';

// ─── Props ────────────────────────────────────────────────────────────────────

interface ReviewSiteTaskDrawerProps {
  task:    SiteTask;
  open:    boolean;
  onClose: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────
//
// Approver review of a pending_approval SiteTask. Read-only view of the
// engineer's answers/photos — approvers never edit them. Online-only:
// no offline queue for approver actions.

export function ReviewSiteTaskDrawer({
  task,
  open,
  onClose,
}: ReviewSiteTaskDrawerProps) {
  const { reviewSiteTask }             = useSiteTaskActions();
  const { showToast, ToastComponent }  = useToast();

  const [requestingChanges, setRequestingChanges] = useState(false);
  const [reviewNotes,       setReviewNotes]       = useState('');
  const [submitting,        setSubmitting]        = useState(false);

  useEffect(() => {
    if (!open) return;
    setRequestingChanges(false);
    setReviewNotes('');
    setSubmitting(false);
  }, [open, task.id]);

  async function handleApprove() {
    setSubmitting(true);
    try {
      await reviewSiteTask(task.id, {
        decision:       'approve',
        siteId:         task.siteId,
        siteCode:       task.siteCode,
        taskCode:       task.taskCode,
        taskLabel:      task.taskLabel,
        previousStatus: task.status,
        approverUid:    task.approverUid,
      });
      showToast('Task approved', 'success');
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to approve task';
      showToast(msg, 'error');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRequestChanges() {
    if (!reviewNotes.trim()) {
      showToast('Please describe what needs to change', 'error');
      return;
    }
    setSubmitting(true);
    try {
      await reviewSiteTask(task.id, {
        decision:       'request_changes',
        reviewNotes:    reviewNotes.trim(),
        siteId:         task.siteId,
        siteCode:       task.siteCode,
        taskCode:       task.taskCode,
        taskLabel:      task.taskLabel,
        previousStatus: task.status,
        approverUid:    task.approverUid,
      });
      showToast('Changes requested', 'success');
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to request changes';
      showToast(msg, 'error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      {ToastComponent}
      <Sheet open={open} onOpenChange={(o) => { if (!o && !submitting) onClose(); }}>
        <SheetContent side="bottom" className="flex flex-col" aria-describedby={undefined}>
          <SheetHeader className="mb-0">
            <p className="text-xs text-gray-400 font-mono">{task.taskCode}</p>
            <SheetTitle className="leading-snug pr-8">{task.taskLabel}</SheetTitle>
            <p className="text-xs text-gray-500 mt-0.5">
              {task.siteCode} · {task.city}
              {task.assignedToName && <> · Submitted by {task.assignedToName}</>}
            </p>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto mt-4">
            <ReadOnlyTaskBody
              task={task}
              banner={
                <div className="flex items-start gap-3 p-3 bg-violet-50 border border-violet-200 rounded-lg">
                  <Clock className="h-5 w-5 text-violet-600 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-violet-800">Pending Your Approval</p>
                    <p className="text-xs text-violet-600 mt-0.5">
                      Review the checklist and photos below, then approve or send back for changes.
                    </p>
                  </div>
                </div>
              }
            />
          </div>

          {/* Actions */}
          <div className="px-5 pb-6 pt-2 border-t border-gray-100 flex flex-col gap-3">
            {requestingChanges && (
              <div>
                <p className="text-sm font-semibold text-gray-700 mb-1">
                  Review Notes <span className="text-brand-red">*</span>
                </p>
                <Textarea
                  value={reviewNotes}
                  onChange={(e) => setReviewNotes(e.target.value)}
                  placeholder="Describe what the engineer needs to fix or add…"
                  rows={3}
                  autoFocus
                />
              </div>
            )}

            <div className="flex gap-2">
              {requestingChanges ? (
                <>
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={() => setRequestingChanges(false)}
                    disabled={submitting}
                  >
                    Cancel
                  </Button>
                  <Button
                    className="flex-1 bg-[#F97316] hover:bg-[#EA580C]"
                    onClick={handleRequestChanges}
                    disabled={submitting}
                  >
                    {submitting ? 'Sending…' : 'Send Back'}
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={() => setRequestingChanges(true)}
                    disabled={submitting}
                  >
                    Request Changes
                  </Button>
                  <Button
                    className="flex-1"
                    onClick={handleApprove}
                    disabled={submitting}
                  >
                    {submitting ? 'Approving…' : 'Approve'}
                  </Button>
                </>
              )}
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
