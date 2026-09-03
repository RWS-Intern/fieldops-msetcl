import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useAuthStore }     from '@/store/authStore';
import { useSurveyReport }  from '@/hooks/useSurveyReport';
import { useSurveyActions } from '@/hooks/useSurveyActions';
import { useSurveyUpdates } from '@/hooks/useSurveyUpdates';
import { useToast }         from '@/components/ui/toast';
import { Button }           from '@/components/ui/button';
import { Textarea }         from '@/components/ui/textarea';
import { Skeleton }         from '@/components/ui/skeleton';
import { SurveyPreview }    from '@/components/survey/SurveyPreview';
import { cn } from '@/lib/utils';
import type { SurveyUpdate, WorkOrderStatus } from '@/types';

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<WorkOrderStatus, string> = {
  open:              'Open',
  in_progress:       'In Progress',
  pending_approval:  'Pending Approval',
  changes_requested: 'Changes Requested',
  approved:          'Approved',
  closed:            'Closed',
};

const ACTION_LABEL: Record<SurveyUpdate['action'], string> = {
  submit:          'Submitted',
  approve:         'Approved',
  request_changes: 'Changes Requested',
};

// ─── Review actions — rendered on the record page itself AND passed into
// SurveyPreview's toolbar (via renderActions), so acting isn't reachable only
// from inside the preview. Each render site mounts its own instance with
// independent local state, which is fine — only one is ever visible at a time
// (the preview is a full-screen overlay).
//
// Approver review of a pending_approval SurveyReport. Read-only view of the
// engineer's survey — approvers never edit it. Online-only: no offline queue
// for approver actions (mirrors ReviewSiteTaskDrawer.tsx).

function ReviewActions({
  onApprove,
  onRequestChanges,
}: {
  onApprove: () => Promise<void>;
  onRequestChanges: (notes: string) => Promise<void>;
}) {
  const [requestingChanges, setRequestingChanges] = useState(false);
  const [reviewNotes, setReviewNotes]             = useState('');
  const [submitting, setSubmitting]               = useState(false);

  async function handleApprove() {
    setSubmitting(true);
    try {
      await onApprove();
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSend() {
    if (!reviewNotes.trim()) return;
    setSubmitting(true);
    try {
      await onRequestChanges(reviewNotes.trim());
    } finally {
      setSubmitting(false);
    }
  }

  if (requestingChanges) {
    return (
      <div className="flex flex-col gap-2 w-full sm:w-72">
        <Textarea
          value={reviewNotes}
          onChange={(e) => setReviewNotes(e.target.value)}
          placeholder="Describe what the engineer needs to fix or add…"
          rows={2}
          autoFocus
        />
        <div className="flex gap-2 justify-end">
          <Button
            type="button" variant="outline" size="sm"
            onClick={() => { setRequestingChanges(false); setReviewNotes(''); }}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            type="button" size="sm" className="bg-[#F97316] hover:bg-[#EA580C]"
            onClick={handleSend}
            disabled={submitting || !reviewNotes.trim()}
          >
            {submitting ? 'Sending…' : 'Send Back'}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-2">
      <Button type="button" variant="outline" size="sm" onClick={() => setRequestingChanges(true)} disabled={submitting}>
        Request Changes
      </Button>
      <Button type="button" size="sm" onClick={handleApprove} disabled={submitting}>
        {submitting ? 'Approving…' : 'Approve'}
      </Button>
    </div>
  );
}

// ─── History ──────────────────────────────────────────────────────────────────

function HistorySection({ updates, loading }: { updates: SurveyUpdate[]; loading: boolean }) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wide">History</h3>
      {loading ? (
        <Skeleton className="h-16 rounded-lg" />
      ) : updates.length === 0 ? (
        <p className="text-sm text-gray-400">No submissions yet.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {updates.map((u) => (
            <div key={u.id} className="flex flex-col gap-0.5 p-3 rounded-lg border border-gray-100 bg-white shadow-sm">
              <div className="flex items-center justify-between gap-2">
                <span className={cn(
                  'text-xs font-semibold px-2 py-0.5 rounded-full shrink-0',
                  u.action === 'approve' ? 'bg-green-50 text-green-700'
                    : u.action === 'request_changes' ? 'bg-orange-50 text-orange-700'
                    : 'bg-blue-50 text-brand-blue',
                )}>
                  {ACTION_LABEL[u.action]}
                </span>
                <span className="text-xs text-gray-400 shrink-0">{u.createdAt.toLocaleString()}</span>
              </div>
              <span className="text-xs text-gray-500">{u.actorName}</span>
              {u.reviewNotes && (
                <p className="text-xs text-gray-600 whitespace-pre-wrap mt-1">{u.reviewNotes}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function ApproverSurveyReviewPage() {
  const { workOrderId } = useParams<{ workOrderId: string }>();
  const navigate = useNavigate();
  const { currentUser } = useAuthStore();
  const { survey, loading, error }     = useSurveyReport(workOrderId);
  const { updates, loading: updatesLoading } = useSurveyUpdates(workOrderId);
  const { reviewSurvey }               = useSurveyActions();
  const { showToast, ToastComponent }  = useToast();
  // Lands on the record page (header, History, actions) rather than the full
  // preview — closing the preview then returns somewhere the user has
  // already seen, instead of straight back out of the page entirely.
  const [showPreview, setShowPreview]  = useState(false);

  async function handleApprove() {
    if (!survey || !workOrderId) return;
    try {
      await reviewSurvey(survey.id, {
        decision:    'approve',
        workOrderId,
        approverUid: survey.approverUid,
      });
      showToast('Survey approved', 'success');
      // Close the preview first — otherwise its full-screen overlay can
      // briefly render over whatever page navigate(-1) lands on.
      setShowPreview(false);
      navigate(-1);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to approve survey';
      showToast(msg, 'error');
    }
  }

  async function handleRequestChanges(notes: string) {
    if (!survey || !workOrderId) return;
    try {
      await reviewSurvey(survey.id, {
        decision:    'request_changes',
        reviewNotes: notes,
        workOrderId,
        approverUid: survey.approverUid,
      });
      showToast('Changes requested', 'success');
      // Close the preview first — otherwise its full-screen overlay can
      // briefly render over whatever page navigate(-1) lands on.
      setShowPreview(false);
      navigate(-1);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to request changes';
      showToast(msg, 'error');
    }
  }

  // ── Loading / error / not-found states ──────────────────────────────────────

  if (loading) {
    return <div className="p-6 text-center text-sm text-gray-400">Loading survey…</div>;
  }
  if (error) {
    return <div className="p-6 text-center text-sm text-brand-red">Failed to load survey: {error}</div>;
  }
  if (!survey) {
    return (
      <div className="p-6 text-center text-sm text-gray-400">
        Survey not found, or you don&apos;t have access to it.
      </div>
    );
  }

  // Plain primitive locals — not the nullable `survey` object itself — so
  // renderActions (a nested function declaration) doesn't depend on
  // TypeScript's narrowing surviving into it (it doesn't; see the identical
  // reasoning in SurveyWizardPage.tsx's handleSubmit).
  //
  // The viewer exclusion is not redundant with the approverUid test: an
  // approver demoted to viewer keeps approverUid == their uid on everything
  // that was already waiting on them, so without it a viewer could still
  // approve those. (The write would be refused by firestore.rules regardless —
  // this keeps the button from appearing in the first place.)
  const isViewer = currentUser?.role === 'viewer';
  const canAct = !!currentUser
    && !isViewer
    && survey.approverUid === currentUser.uid
    && survey.status === 'pending_approval';
  const surveyStatus = survey.status;
  // The heading falls back to siteCode when a survey predates siteName being
  // denormalised — when that happens, the sub-line below must not ALSO show
  // the bare siteCode, or the same code repeats twice in the header.
  const showSiteCodeInSubline = !!survey.siteName;

  function renderActions() {
    if (canAct) {
      return <ReviewActions onApprove={handleApprove} onRequestChanges={handleRequestChanges} />;
    }
    // A viewer sees the status, never "Not assigned to you" — nothing is ever
    // assigned to them, so that wording would imply an action they could have.
    if (isViewer || surveyStatus !== 'pending_approval') {
      return (
        <span className="text-xs font-medium text-gray-500 px-2">
          {STATUS_LABEL[surveyStatus]}
        </span>
      );
    }
    return (
      <span className="text-xs font-medium text-gray-500 px-2">
        Not assigned to you
      </span>
    );
  }

  return (
    <div className="flex flex-col gap-4 max-w-2xl mx-auto pb-24">
      {ToastComponent}

      <div className="flex items-start gap-2">
        <Button
          type="button" variant="outline" size="sm"
          onClick={() => navigate(-1)}
          aria-label="Back"
          className="shrink-0"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="min-w-0">
          {survey.workOrderCode && (
            <p className="text-xs text-gray-400 font-mono">{survey.workOrderCode}</p>
          )}
          <h2 className="text-xl font-bold text-gray-900 leading-snug">{survey.siteName || survey.siteCode}</h2>
          {(showSiteCodeInSubline || survey.assignedToName) && (
            <p className="text-xs text-gray-500 mt-0.5">
              {showSiteCodeInSubline && survey.siteCode}
              {showSiteCodeInSubline && survey.assignedToName && ' · '}
              {survey.assignedToName}
            </p>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {renderActions()}
      </div>

      {!showPreview && (
        <Button type="button" onClick={() => setShowPreview(true)}>
          View Survey
        </Button>
      )}

      <HistorySection updates={updates} loading={updatesLoading} />

      {showPreview && (
        <SurveyPreview
          survey={survey}
          siteName={survey.siteName}
          workOrderCode={survey.workOrderCode}
          readOnly
          onClose={() => setShowPreview(false)}
          renderActions={renderActions}
        />
      )}
    </div>
  );
}
