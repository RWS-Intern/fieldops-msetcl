import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSurveyOversight } from '@/hooks/useSurveyOversight';
import { Button }   from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type { SurveyStatusFilter } from '@/hooks/useSurveyOversight';
import type { SurveyReport, WorkOrderStatus } from '@/types';

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_FILTERS: { key: SurveyStatusFilter; label: string }[] = [
  { key: 'all',               label: 'All' },
  { key: 'open',               label: 'Open' },
  { key: 'in_progress',        label: 'In Progress' },
  { key: 'pending_approval',   label: 'Pending Approval' },
  { key: 'changes_requested',  label: 'Changes Requested' },
  { key: 'approved',           label: 'Approved' },
];

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
//
// siteName/workOrderCode are denormalised directly onto SurveyReport (see the
// type comment) specifically so a list of many rows like this one never
// needs a per-row getDoc.

/**
 * Where this survey sits in its approval chain, for the row's stage pill.
 * Sourced from the document's OWN approvalStages[currentStageIndex] — its
 * denormalised stageLabel, so a survey renders with the wording it was created
 * under rather than this build's.
 *
 * Returns null once the chain is complete: the status badge already reads
 * "Approved" then, and a stage pill would be noise. Also null for a document
 * that predates the chain (empty array), which simply shows no pill.
 */
function currentStageSummary(survey: SurveyReport): { label: string; state: string } | null {
  const stages = survey.approvalStages;
  const index  = survey.currentStageIndex;
  if (stages.length === 0 || index < 0 || index >= stages.length) return null;

  const label = stages[index].stageLabel;
  // Derived from the DOCUMENT's status, not the stage entry's own — after an
  // engineer resubmits a sent-back survey the entry still reads
  // 'changes_requested' (they cannot rewrite the approval record) while the
  // document is back to pending_approval and genuinely awaiting this stage.
  const state =
    survey.status === 'changes_requested' ? 'changes requested' :
    survey.status === 'pending_approval'  ? 'pending' :
    'not yet submitted';

  return { label, state };
}

function SurveyOversightRow({ survey, onOpen }: { survey: SurveyReport; onOpen: () => void }) {
  const stage = currentStageSummary(survey);

  return (
    <div
      className="border rounded-lg p-3 flex flex-col gap-1.5 cursor-pointer hover:border-blue-300 hover:shadow-sm transition-all"
      onClick={onOpen}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-bold text-gray-900 font-mono leading-snug">{survey.siteCode}</p>
          {survey.siteName && (
            <p className="text-sm font-semibold text-gray-800 leading-snug">{survey.siteName}</p>
          )}
          {survey.workOrderCode && (
            <p className="text-xs text-gray-400 font-mono">{survey.workOrderCode}</p>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className={cn('text-xs font-medium px-2 py-0.5 rounded-full', STATUS_BADGE[survey.status])}>
            {STATUS_LABEL[survey.status]}
          </span>
          {/* Which of the three stages the survey is sitting at — the status
              badge alone can't distinguish "pending approval at stage 1" from
              "pending approval at stage 3". */}
          {stage && (
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600">
              {stage.label} — {stage.state}
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-gray-500">
        <span>Engineer: {survey.assignedToName ?? '—'}</span>
        {/* Names the stage rather than a bare "Approver", so it is clear WHICH
            reviewer this is — approverName tracks the live stage owner. */}
        <span>{stage ? stage.label : 'Approver'}: {survey.approverName ?? '—'}</span>
        {survey.submittedAt && <span>Submitted {formatDate(survey.submittedAt)}</span>}
        {survey.status === 'approved' && survey.reviewedAt && (
          <span>Approved {formatDate(survey.reviewedAt)}</span>
        )}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
//
// Admin-only oversight across every survey work order, any site, any status
// — the "who did it, who approved it" view for surveys that have already
// left the approver's own queue (which only ever shows pending_approval).
// Tapping a row reuses the existing approver review screen (SurveyPreview,
// read-only, with its History section) — no second viewer.

export function AdminSurveyOversightPage() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<SurveyStatusFilter>('all');
  const { surveys, loading, loadingMore, hasMore, loadMore } = useSurveyOversight(filter);

  return (
    <div className="flex flex-col gap-4 max-w-2xl mx-auto pb-24">
      <h2 className="text-xl font-bold text-gray-900">Surveys</h2>

      <div className="flex flex-wrap gap-2">
        {STATUS_FILTERS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => setFilter(key)}
            className={cn(
              'text-sm font-medium px-3 py-1.5 rounded-full border transition-colors',
              filter === key
                ? 'bg-brand-blue text-white border-brand-blue'
                : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300 hover:bg-gray-50',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex flex-col gap-2">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-lg" />
          ))}
        </div>
      ) : surveys.length === 0 ? (
        <div className="py-16 text-center">
          <p className="text-sm text-gray-400">No surveys match this filter.</p>
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-2">
            {surveys.map((survey) => (
              <SurveyOversightRow
                key={survey.id}
                survey={survey}
                onOpen={() => navigate(`/survey-record/${survey.workOrderId}`)}
              />
            ))}
          </div>

          {hasMore && (
            <Button
              type="button"
              variant="outline"
              onClick={loadMore}
              disabled={loadingMore}
              className="self-center"
            >
              {loadingMore ? 'Loading…' : 'Load more'}
            </Button>
          )}
        </>
      )}
    </div>
  );
}
