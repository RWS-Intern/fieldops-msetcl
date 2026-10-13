import { createPortal } from 'react-dom';
import { ArrowLeft, X } from 'lucide-react';
import { BoqTable } from '@/components/survey/SurveyPreview';
import { SUPPLY_BOQ_MASTER } from '@/lib/boqMaster';
import { Button } from '@/components/ui/button';
import type { SurveyReport } from '@/types';

/**
 * The Bill of Quantity as a full-screen page, for reviewing it apart from the
 * rest of the survey.
 *
 * Presented exactly as SurveyPreview is — a portal to document.body, fixed
 * inset-0, with the same sticky toolbar — so "View BOQ" and "View Survey"
 * behave identically rather than one opening a page and the other an inline
 * card. Portalling matters for more than layering: an inline card would sit
 * inside the record page's scroll container and inherit its width.
 *
 * Reuses SurveyPreview's BoqTable rather than re-rendering the table here.
 * That matters beyond tidiness: this becomes a jointly-signed BOQ submitted
 * for government vetting, and two renderings of the same numbers could drift
 * — an approver would then be signing off something that reads differently
 * depending on which screen they opened.
 *
 * Read-only. Any review ACTION belongs to the caller, passed in through
 * `renderActions`, exactly as SurveyPreview handles its own toolbar.
 */
export function BoqReviewPanel({
  survey,
  onClose,
  renderActions,
}: {
  survey:         SurveyReport;
  onClose:        () => void;
  /** Review controls for the BOQ, rendered in the toolbar. */
  renderActions?: () => React.ReactNode;
}) {
  const content = (
    <div className="survey-print-root fixed inset-0 z-[9999] overflow-y-auto overflow-x-hidden bg-brand-background">
      {/* Toolbar — mirrors SurveyPreview's, including Save as PDF, so the two
          screens offer the same affordances in the same places. */}
      <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-gray-200 bg-white px-4 py-3 print:hidden">
        <div className="flex min-w-0 items-center gap-2">
          {/* Back rather than just the X on the right: this is a full page, so
              the way out belongs where a page's way out is — top left. */}
          <button
            type="button"
            onClick={onClose}
            aria-label="Back to survey record"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-gray-200 text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-700"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <h2 className="truncate text-base font-bold text-gray-900">Bill of Quantity</h2>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {renderActions?.()}
          <Button type="button" variant="outline" size="sm" onClick={() => window.print()}>
            Save as PDF
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onClose}
            aria-label="Close BOQ"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="survey-print-content mx-auto flex max-w-3xl flex-col gap-4 p-4 print:max-w-none print:p-0 print:text-black">
        {/* Same identity block SurveyPreview leads with, so a printed BOQ page
            stands on its own as a document. */}
        <div className="flex flex-col gap-0.5">
          {survey.workOrderCode && (
            <p className="font-mono text-xs text-gray-400">{survey.workOrderCode}</p>
          )}
          <h1 className="text-xl font-bold text-gray-900">
            {survey.siteName || survey.siteCode}
          </h1>
          <p className="text-xs text-gray-500">{survey.siteCode}</p>
          <p className="text-[10px] text-gray-400">
            Generated from FieldOps on {new Date().toLocaleString()}
          </p>
        </div>

        {/* Supply only — the Service BOQ was removed from the form in the
            supervisor's first round of edits, so the survey carries no service
            lines to show. SurveyPreview renders exactly this one table too.

            Wrapped in its own horizontal scroller: on a narrow window the
            table is wider than the column, and without this it widened the
            whole overlay and took the toolbar with it. print:overflow-visible
            so Save as PDF still emits the full table rather than a clipped one. */}
        <div className="overflow-x-auto print:overflow-visible">
          <BoqTable title="Supply" master={SUPPLY_BOQ_MASTER} lines={survey.boqSupply} />
        </div>
      </div>
    </div>
  );

  return createPortal(content, document.body);
}
