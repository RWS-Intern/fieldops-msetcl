import { AlertTriangle } from 'lucide-react';
import { findLegacyVoltageData } from '@/lib/legacyVoltage';
import type { SurveyReport } from '@/types';

/**
 * Shown on EVERY step of the wizard for a survey answered before 66/33kV was
 * split into two levels.
 *
 * Every step, not just the affected ones: a field expert may never open the
 * section that holds the orphaned answer in the same session, and the whole
 * point is that the gap must be impossible to miss.
 *
 * NOT dismissible. It disappears on its own the moment the last pre-split
 * answer is replaced — because it is derived from the survey data on every
 * render, not from a "seen" flag. That is deliberately stronger than a
 * dismiss-and-forget notice: reopening the survey tomorrow shows it again
 * until the data is genuinely fixed.
 *
 * Renders nothing for an unaffected survey, which is every survey but the two
 * already in progress.
 */
export function LegacyVoltageBanner({ survey }: { survey: SurveyReport }) {
  const hits = findLegacyVoltageData(survey);
  if (hits.length === 0) return null;

  return (
    <div className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3">
      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
      <div className="min-w-0">
        <p className="text-sm font-semibold text-amber-900">
          Some answers no longer have a field of their own
        </p>
        <p className="mt-1 text-xs text-amber-800">
          Parts of this form changed shape after the survey was started: 66kV and 33kV became
          separate voltage levels, the asset counts became a per-voltage-level grid, and the
          ACDB/DCDB section became a direct count instead of ten numbered slots. The old answers
          are still stored, but the form has no field for them any more — so those places will
          look unanswered. <strong>Before submitting</strong>, work through the list below and
          re-enter each one: pick the correct 66&nbsp;kV or 33&nbsp;kV value, split each old total
          across the levels it actually covers, and re-enter the ACDB/DCDB figures. Every old
          value is shown beside its field for reference.
        </p>

        <p className="mt-2 text-[11px] font-semibold uppercase tracking-wide text-amber-700">
          Still to re-enter ({hits.length})
        </p>
        <ul className="mt-0.5 flex flex-col gap-0.5">
          {hits.map((hit, i) => (
            <li key={`${hit.section}-${hit.label}-${i}`} className="text-xs text-amber-800">
              <span className="font-medium">{hit.section}</span> — {hit.label}
              {hit.value && <span className="text-amber-700"> (was {hit.value})</span>}
            </li>
          ))}
        </ul>

        <p className="mt-2 text-[11px] text-amber-700">
          This notice clears itself once every item above has been re-entered.
        </p>
      </div>
    </div>
  );
}
