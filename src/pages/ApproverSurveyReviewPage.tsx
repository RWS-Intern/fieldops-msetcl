import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, Paperclip, X } from 'lucide-react';
import { useAuthStore }     from '@/store/authStore';
import { useSurveyReport }  from '@/hooks/useSurveyReport';
import { useSurveyActions } from '@/hooks/useSurveyActions';
import { useSurveyUpdates } from '@/hooks/useSurveyUpdates';
import { useToast }         from '@/components/ui/toast';
import { Button }           from '@/components/ui/button';
import { Textarea }         from '@/components/ui/textarea';
import { Skeleton }         from '@/components/ui/skeleton';
import { SurveyPreview }    from '@/components/survey/SurveyPreview';
import { uploadToCloudinary } from '@/utils/uploadToCloudinary';
import { findApprovalStage } from '@/lib/approvalStages';
import { cn } from '@/lib/utils';
import type {
  SurveyUpdate, WorkOrderStatus, ApprovalStageResult, ReviewDirection,
} from '@/types';

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
  agree:           'Agreed With Flag',
  disagree:        'Disagreed With Flag',
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

// ─── Stage indicator ──────────────────────────────────────────────────────────
//
// Compact pill row, same visual grammar as the wizard's step pills: filled
// brand-blue = acting now, green = cleared, amber = sent back, grey = not yet
// reached.
//
// Display state is derived from the document's position and status, NOT read
// straight off each entry's `status`. After an engineer resubmits a sent-back
// survey the flagging stage's entry still reads 'changes_requested' (the
// engineer cannot rewrite the approval record — firestore.rules pins it), but
// the document is back to 'pending_approval' and that stage genuinely owns it
// again. Deriving here is what makes the pill say "awaiting review" at that
// point instead of showing a stale "sent back".

type StageDisplayState = 'approved' | 'current' | 'sent_back' | 'pending';

function stageDisplayState(
  index: number,
  currentStageIndex: number,
  docStatus: WorkOrderStatus,
  entryStatus: ApprovalStageResult['status'],
): StageDisplayState {
  if (index < currentStageIndex) return 'approved';
  if (index > currentStageIndex) return 'pending';
  // The live stage: waiting on the engineer, or waiting on this reviewer.
  if (docStatus === 'changes_requested') return 'sent_back';
  if (docStatus === 'approved') return entryStatus === 'approved' ? 'approved' : 'pending';
  return 'current';
}

const STAGE_PILL_CLASS: Record<StageDisplayState, string> = {
  approved:  'bg-green-50 text-green-700',
  current:   'bg-brand-blue text-white',
  sent_back: 'bg-orange-50 text-orange-700',
  pending:   'bg-gray-100 text-gray-400',
};

function StageIndicator({
  stages, currentStageIndex, docStatus,
}: {
  stages:            ApprovalStageResult[];
  currentStageIndex: number;
  docStatus:         WorkOrderStatus;
}) {
  if (stages.length === 0) return null;
  const complete = currentStageIndex >= stages.length;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap gap-1.5">
        {stages.map((stage, i) => {
          const state = complete
            ? 'approved'
            : stageDisplayState(i, currentStageIndex, docStatus, stage.status);
          return (
            <span
              key={stage.stageKey}
              className={cn(
                'text-[10px] px-2 py-0.5 rounded-full font-medium',
                STAGE_PILL_CLASS[state],
              )}
              title={stage.ownerName ?? 'No owner assigned'}
            >
              {i + 1}. {stage.stageLabel}
            </span>
          );
        })}
      </div>
      <p className="text-xs text-gray-500">
        {complete
          ? 'All approval stages cleared.'
          : `${stages[currentStageIndex]?.stageLabel ?? 'Current stage'} — ${
              stages[currentStageIndex]?.ownerName ?? 'no owner assigned'
            }`}
      </p>
    </div>
  );
}

// ─── Attachment control ───────────────────────────────────────────────────────
//
// Optional at every stage. Uploads immediately on selection and holds the
// resulting https URL, so the approve/request-changes write has a plain string
// ready. Deliberately NOT the local:// deferred-upload path the wizard uses for
// photos: that exists so a field engineer can capture evidence with no signal
// and have it drained later, whereas approver actions are online-only (no
// offline queue — see useSurveyActions) and nothing would ever drain a
// local:// reference written from here.

function AttachmentControl({
  fileName, uploading, error, disabled, onSelect, onClear,
}: {
  fileName:  string | null;
  uploading: boolean;
  error:     string | null;
  disabled:  boolean;
  onSelect:  (file: File) => void;
  onClear:   () => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-medium text-gray-600">
        Attachment <span className="font-normal text-gray-400">(optional)</span>
      </label>
      {fileName ? (
        <div className="flex items-center gap-2 rounded-md border border-gray-200 bg-gray-50 px-2.5 py-1.5">
          <Paperclip className="h-3.5 w-3.5 shrink-0 text-gray-400" />
          <span className="min-w-0 flex-1 truncate text-xs text-gray-700">{fileName}</span>
          {!disabled && (
            <button
              type="button"
              onClick={onClear}
              className="shrink-0 text-gray-400 hover:text-brand-red"
              aria-label="Remove attachment"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      ) : (
        <input
          type="file"
          disabled={disabled || uploading}
          onChange={(e) => {
            const file = e.target.files?.[0];
            // Reset the input so re-picking the same file still fires onChange.
            e.target.value = '';
            if (file) onSelect(file);
          }}
          className="block w-full text-xs text-gray-600 file:mr-2 file:rounded-md file:border file:border-gray-200 file:bg-white file:px-2.5 file:py-1.5 file:text-xs file:font-medium file:text-gray-700 hover:file:bg-gray-50 disabled:opacity-50"
        />
      )}
      {uploading && <p className="text-xs text-brand-blue">Uploading…</p>}
      {error && <p className="text-xs text-brand-red">{error}</p>}
    </div>
  );
}

/**
 * Shown only while the chain is travelling BACKWARD — i.e. a stage above this
 * reviewer rejected the survey and the flag is cascading down for each lower
 * stage to agree or disagree with.
 *
 * It carries the flagging stage's own reviewNotes verbatim: a reviewer asked
 * to agree or disagree with an objection cannot make that call without seeing
 * what was actually objected to.
 */
function EscalationBanner({ stages, liveIndex }: { stages: ApprovalStageResult[]; liveIndex: number }) {
  // The nearest stage ABOVE this one that has flagged the survey — the
  // objection being passed down. Searching upward (rather than assuming
  // liveIndex + 1) is what keeps this correct after several cascade steps.
  const origin = stages
    .slice(liveIndex + 1)
    .find((stage) => stage.status === 'changes_requested');

  return (
    <div className="flex items-start gap-3 rounded-lg border border-violet-200 bg-violet-50 p-3">
      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-violet-600" />
      <div className="min-w-0">
        <p className="text-sm font-semibold text-violet-900">
          Escalation review — you are not reviewing the survey itself
        </p>
        <p className="mt-0.5 text-xs text-violet-800">
          {origin
            ? `${origin.stageLabel} rejected this survey. You are being asked whether you agree with that objection.`
            : 'A stage above you rejected this survey. You are being asked whether you agree with that objection.'}
          {' '}Agreeing passes it further down; disagreeing sends it back up for them to reconsider.
          The field engineer sees nothing until this resolves at Approver Level 1.
        </p>
        {origin?.reviewNotes && (
          <div className="mt-2 rounded border border-violet-200 bg-white px-2 py-1.5">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-violet-500">
              {origin.stageLabel} wrote
            </p>
            <p className="mt-0.5 whitespace-pre-wrap text-xs text-gray-700">{origin.reviewNotes}</p>
          </div>
        )}
      </div>
    </div>
  );
}

function ReviewActions({
  direction,
  onApprove,
  onRequestChanges,
}: {
  /** Selects the labels AND which decision each button sends. */
  direction: ReviewDirection;
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

  // Backward = an escalation review. The same two code paths are reused
  // (request_changes and approve), but their MEANING is different and the
  // labels must say so: a reviewer agreeing with a flag from above is not
  // "requesting changes" on the survey, and one disagreeing is not
  // "approving" it outright.
  const isEscalation = direction === 'backward';
  const flagLabel    = isEscalation ? 'Agree' : 'Request Changes';
  const flagSendLabel = isEscalation ? 'Agree & Pass Down' : 'Send Back';
  const clearLabel   = isEscalation ? 'Disagree, approve as-is' : 'Approve';
  const clearBusy    = isEscalation ? 'Sending back up…' : 'Approving…';

  if (requestingChanges) {
    return (
      <div className="flex flex-col gap-2 w-full sm:w-72">
        <Textarea
          value={reviewNotes}
          onChange={(e) => setReviewNotes(e.target.value)}
          placeholder={isEscalation
            ? 'Why do you agree with the objection above?'
            : 'Describe what the engineer needs to fix or add…'}
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
            {submitting ? 'Sending…' : flagSendLabel}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-2">
      <Button type="button" variant="outline" size="sm" onClick={() => setRequestingChanges(true)} disabled={submitting}>
        {flagLabel}
      </Button>
      <Button type="button" size="sm" onClick={handleApprove} disabled={submitting}>
        {submitting ? clearBusy : clearLabel}
      </Button>
    </div>
  );
}

// ─── History ──────────────────────────────────────────────────────────────────

/**
 * Stage label for one history entry. Prefers the survey's OWN denormalised
 * label at that index, so the History reads with the same wording as the stage
 * indicator above it and as the document was created under. Falls back to this
 * build's label for the recorded stageKey, then to nothing — entries written
 * before the chain existed have no stage and simply show no pill.
 */
function historyStageLabel(
  update: SurveyUpdate,
  stages: ApprovalStageResult[],
): string | null {
  if (typeof update.stageIndex === 'number' && stages[update.stageIndex]) {
    return stages[update.stageIndex].stageLabel;
  }
  if (update.stageKey) return findApprovalStage(update.stageKey)?.label ?? null;
  return null;
}

function HistorySection({ updates, loading, stages }: {
  updates: SurveyUpdate[];
  loading: boolean;
  /** The survey's chain, for resolving each entry's stage label. */
  stages:  ApprovalStageResult[];
}) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wide">History</h3>
      {loading ? (
        <Skeleton className="h-16 rounded-lg" />
      ) : updates.length === 0 ? (
        <p className="text-sm text-gray-400">No submissions yet.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {updates.map((u) => {
            const stageLabel = historyStageLabel(u, stages);
            return (
              <div key={u.id} className="flex flex-col gap-0.5 p-3 rounded-lg border border-gray-100 bg-white shadow-sm">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                    <span className={cn(
                      'text-xs font-semibold px-2 py-0.5 rounded-full shrink-0',
                      u.action === 'approve' ? 'bg-green-50 text-green-700'
                        : u.action === 'request_changes' ? 'bg-orange-50 text-orange-700'
                        : 'bg-blue-50 text-brand-blue',
                    )}>
                      {ACTION_LABEL[u.action]}
                    </span>
                    {/* Which round of the chain this action belonged to —
                        shown for submissions too, so a resubmission reads as
                        answering the stage that sent it back. */}
                    {stageLabel && (
                      <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600">
                        {stageLabel}
                      </span>
                    )}
                  </div>
                  <span className="text-xs text-gray-400 shrink-0">{u.createdAt.toLocaleString()}</span>
                </div>
                <span className="text-xs text-gray-500">{u.actorName}</span>
                {u.reviewNotes && (
                  <p className="text-xs text-gray-600 whitespace-pre-wrap mt-1">{u.reviewNotes}</p>
                )}
                {u.attachmentUrl && (
                  <a
                    href={u.attachmentUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 inline-flex w-fit items-center gap-1 text-xs text-brand-blue hover:underline"
                  >
                    <Paperclip className="h-3 w-3 shrink-0" />
                    Attachment
                  </a>
                )}
              </div>
            );
          })}
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

  // ── Optional stage attachment ────────────────────────────────────────────
  // Held at page level, not inside ReviewActions: that component is mounted
  // twice (record page + preview toolbar) with independent state, and the
  // attachment has to be the same whichever one the reviewer acts from.
  const [attachmentUrl,  setAttachmentUrl]  = useState<string | null>(null);
  const [attachmentName, setAttachmentName] = useState<string | null>(null);
  const [uploading,      setUploading]      = useState(false);
  const [uploadError,    setUploadError]    = useState<string | null>(null);

  async function handleSelectAttachment(file: File) {
    setUploading(true);
    setUploadError(null);
    try {
      // resource_type 'auto' — this may be a PDF, spreadsheet or image, and
      // Cloudinary's image endpoint rejects non-images outright.
      const { url } = await uploadToCloudinary(file, {
        resourceType: 'auto',
        taskNum:      survey?.workOrderCode || undefined,
      });
      setAttachmentUrl(url);
      setAttachmentName(file.name);
    } catch (err) {
      console.error('[ApproverSurveyReviewPage] attachment upload failed:', err);
      setUploadError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  function clearAttachment() {
    setAttachmentUrl(null);
    setAttachmentName(null);
    setUploadError(null);
  }

  async function handleApprove() {
    if (!survey || !workOrderId) return;
    try {
      const escalating = survey.reviewDirection === 'backward';
      await reviewSurvey(survey.id, {
        // Same code path, different meaning: during an escalation review this
        // button DISAGREES with the flag above rather than approving the
        // survey. reviewSurvey validates the pairing against the direction.
        decision:    escalating ? 'disagree' : 'approve',
        workOrderId,
        approverUid: survey.approverUid,
        // The LIVE array and index — reviewSurvey replaces only the acting
        // entry. Rebuilding the chain is rejected by firestore.rules.
        approvalStages:    survey.approvalStages,
        currentStageIndex: survey.currentStageIndex,
        reviewDirection:   survey.reviewDirection,
        attachmentUrl,
      });
      const wasFinal = survey.currentStageIndex >= survey.approvalStages.length - 1;
      showToast(
        escalating
          ? `Sent back up to ${
              survey.approvalStages[survey.currentStageIndex + 1]?.ownerName ?? 'the stage above'
            } to reconsider`
          : wasFinal
          ? 'Survey fully approved — all stages cleared'
          : `${survey.approvalStages[survey.currentStageIndex]?.stageLabel ?? 'Stage'} approved — sent to ${
              survey.approvalStages[survey.currentStageIndex + 1]?.ownerName ?? 'the next approver'
            }`,
        'success',
      );
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
      const escalating = survey.reviewDirection === 'backward';
      const atLevelOne = survey.currentStageIndex === 0;
      await reviewSurvey(survey.id, {
        decision:    escalating ? 'agree' : 'request_changes',
        reviewNotes: notes,
        workOrderId,
        approverUid: survey.approverUid,
        approvalStages:    survey.approvalStages,
        currentStageIndex: survey.currentStageIndex,
        reviewDirection:   survey.reviewDirection,
        attachmentUrl,
      });
      // Says where it actually went. Only Level 1 reaches the field; anything
      // above it starts (or continues) the cascade downward, and a
      // resubmission always restarts the whole chain at Level 1.
      showToast(
        atLevelOne
          ? 'Sent back to the engineer — resubmission restarts the chain at Approver Level 1'
          : `Passed down to ${
              survey.approvalStages[survey.currentStageIndex - 1]?.ownerName ?? 'the stage below'
            } to review — the engineer is not notified yet`,
        'success',
      );
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
  // Captured out here: renderActions is a function declaration, so TypeScript's
  // null-narrowing on `survey` does not reach inside it.
  const reviewDirection: ReviewDirection = survey.reviewDirection;
  const isEscalationReview = reviewDirection === 'backward' && survey.status === 'pending_approval';

  function renderActions() {
    if (canAct) {
      return <ReviewActions direction={reviewDirection} onApprove={handleApprove} onRequestChanges={handleRequestChanges} />;
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

      {/* Where this survey sits in the approval chain — above the preview. */}
      <StageIndicator
        stages={survey.approvalStages}
        currentStageIndex={survey.currentStageIndex}
        docStatus={survey.status}
      />

      {/* Only while the flag is cascading down — carries the objection's own
          notes so whoever must agree or disagree can actually read it. */}
      {isEscalationReview && (
        <EscalationBanner
          stages={survey.approvalStages}
          liveIndex={survey.currentStageIndex}
        />
      )}

      {/* Optional at every stage. Only offered to whoever can actually act. */}
      {canAct && (
        <AttachmentControl
          fileName={attachmentName}
          uploading={uploading}
          error={uploadError}
          disabled={false}
          onSelect={handleSelectAttachment}
          onClear={clearAttachment}
        />
      )}

      <div className="flex flex-wrap items-center gap-2">
        {renderActions()}
      </div>

      {!showPreview && (
        <Button type="button" onClick={() => setShowPreview(true)}>
          View Survey
        </Button>
      )}

      <HistorySection updates={updates} loading={updatesLoading} stages={survey.approvalStages} />

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
