import { Button } from '@/components/ui/button';
import type { SurveyReport } from '@/types';

interface SurveyApprovalCardProps {
  survey: SurveyReport;
  onOpen: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────
//
// Survey counterpart to SiteTaskCard, for the unified Approvals list. Same
// card shell (colour stripe + footer button) so the two kinds sit naturally
// in one list, with a violet "Survey" badge so an approver can tell at a
// glance which kind of work a row is — a survey's approval flow (SE-PAC
// vetting, joint sign-off) is materially different from a site task's.
//
// siteName/workOrderCode are denormalised directly onto SurveyReport (see
// the type comment) — no per-row getDoc needed for a list like this one.

export function SurveyApprovalCard({ survey, onOpen }: SurveyApprovalCardProps) {
  return (
    <div
      className="flex rounded-lg border border-gray-100 bg-white shadow-sm overflow-hidden cursor-pointer hover:border-brand-blue transition-colors"
      onClick={onOpen}
    >
      <div className="w-1.5 shrink-0 bg-violet-500" />

      <div className="flex-1 p-3 min-w-0">
        <div className="flex items-start justify-between gap-2 mb-0.5">
          <span className="text-sm font-bold text-gray-900 font-mono leading-snug truncate">
            {survey.siteCode}
          </span>
          <span className="text-xs font-medium px-2 py-0.5 rounded-full shrink-0 bg-violet-100 text-violet-700">
            Survey
          </span>
        </div>

        <p className="text-xs text-gray-400 mt-0.5 leading-snug font-mono">
          {survey.workOrderCode || '—'}
        </p>

        <p className="text-sm font-semibold text-gray-800 mt-1 leading-snug">
          {survey.siteName || survey.siteCode}
        </p>

        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
          {survey.assignedToName && (
            <span className="text-xs text-gray-500">{survey.assignedToName}</span>
          )}
          {survey.submittedAt && (
            <span className="text-xs text-gray-400">
              Submitted{' '}
              {survey.submittedAt.toLocaleDateString('en-GB', {
                day: '2-digit', month: 'short', year: 'numeric',
              })}
            </span>
          )}
        </div>

        <div className="flex justify-end mt-2">
          <Button variant="outline" size="sm" className="h-7 text-xs px-3 shrink-0">
            Review
          </Button>
        </div>
      </div>
    </div>
  );
}
