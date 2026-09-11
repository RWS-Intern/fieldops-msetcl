import { useEffect } from 'react';
import { SUPPLY_BOQ_MASTER, SERVICE_BOQ_MASTER } from '@/lib/boqMaster';
import {
  deriveSupplyQuantities,
  applyDerivedQuantities,
} from '@/lib/boqDerivation';
import { formatMetresAsKm } from '@/lib/units';
import { BOQ_CHECK_LABELS } from '@/lib/surveyLabels';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import type { SurveyStepProps } from './StepProps';
import type { BoqMasterItem } from '@/lib/boqMaster';
import type { SurveyBoqLine, SurveyReport } from '@/types';

// ─── Cable-length hint — 4 items in Km correspond to Section H cable runs ──────

const CABLE_HINT_BY_ITEM_KEY: Record<string, 'cat6' | 'power'> = {
  cat6Cable:                  'cat6',   // supply, sr 9
  powerSupplyCable:           'power',  // supply, sr 12
  cat6CableLayingTermination: 'cat6',   // service, sr 6
  powerCableLayingTermination: 'power', // service, sr 5
};

function cableRunTotalMetres(cableRuns: SurveyReport['cableRuns'], cableType: 'cat6' | 'power'): number {
  return cableRuns
    .filter((r) => r.cableType === cableType)
    .reduce((sum, r) => sum + (r.lengthM ?? 0), 0);
}

// ─── One BOQ section (Supply or Service) — stacked cards, matched by itemKey ───

function BoqSection({
  title, master, lines, onChangeLines, cableRuns, readOnly,
}: {
  title:         string;
  master:        readonly BoqMasterItem[];
  lines:         SurveyBoqLine[];
  onChangeLines: (lines: SurveyBoqLine[]) => void;
  cableRuns:     SurveyReport['cableRuns'];
  readOnly:      boolean;
}) {
  function updateLine(itemKey: string, patch: Partial<SurveyBoqLine>) {
    onChangeLines(lines.map((l) => (l.itemKey === itemKey ? { ...l, ...patch } : l)));
  }

  return (
    <div className="flex flex-col gap-2">
      <h4 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">{title}</h4>
      {master.map((item) => {
        // Matched by itemKey, never array position — createEmptyBoqLines()
        // seeds exactly one line per master item, but the master (not the
        // stored array's order) is always the source of truth for what to render.
        const line = lines.find((l) => l.itemKey === item.itemKey);
        if (!line) return null;

        const cableType  = CABLE_HINT_BY_ITEM_KEY[item.itemKey];
        const hintMetres = cableType ? cableRunTotalMetres(cableRuns, cableType) : null;
        // Narrow directly off hintMetres (not the separate showHint flag) so
        // TS can prove it's non-null at the formatMetresAsKm call site.
        const hintKmStr  = hintMetres !== null ? formatMetresAsKm(hintMetres) : null;
        const showHint   = hintMetres !== null && hintMetres > 0;

        // A not-applicable line without a reason is the one thing this toggle
        // exists to prevent, so it is surfaced inline as well as in the
        // step's validation summary.
        const missingReason = line.notApplicable && !line.remarks?.trim();

        return (
          <div key={item.itemKey} className="flex flex-col gap-2 p-3 rounded-lg border border-gray-100">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <span className="text-[10px] text-gray-400 font-mono">Sr. {item.sr}</span>
                <p className="text-sm font-medium text-gray-800 leading-snug">
                  {item.item}
                  {item.required
                    ? <span className="text-brand-red ml-0.5">*</span>
                    : <span className="ml-1.5 text-[10px] font-normal text-gray-400">Optional</span>}
                </p>
              </div>
              <span className="text-xs text-gray-400 shrink-0">{item.unit}</span>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col gap-1">
                <Label className="text-xs">Surveyed Qty</Label>
                <Input
                  type="number"
                  inputMode={item.unit === 'Km' ? 'decimal' : 'numeric'}
                  // Locked at 0 while marked not applicable — unticking the
                  // toggle makes it editable again without clearing it.
                  disabled={readOnly || line.notApplicable}
                  value={line.surveyedQty ?? ''}
                  onChange={(e) =>
                    updateLine(item.itemKey, {
                      surveyedQty: e.target.value === '' ? null : Math.max(0, Number(e.target.value)),
                      // Any manual edit takes the line out of auto control for
                      // good — recomputes must never overwrite it after this.
                      autoDerived: false,
                    })
                  }
                />
                {line.autoDerived && line.surveyedQty !== null && (
                  <span className="text-[10px] leading-snug text-brand-blue">
                    Auto-calculated — adjust if needed
                  </span>
                )}
              </div>
              <div className="flex flex-col gap-1">
                <Label className="text-xs">
                  Remarks
                  {line.notApplicable && <span className="text-brand-red ml-0.5">*</span>}
                </Label>
                <Input
                  disabled={readOnly}
                  value={line.remarks ?? ''}
                  placeholder={line.notApplicable ? 'Why is this not applicable?' : item.remarksHint}
                  className={missingReason ? 'border-brand-red focus-visible:ring-brand-red' : ''}
                  onChange={(e) => updateLine(item.itemKey, { remarks: e.target.value || null })}
                />
              </div>
            </div>

            {item.guidance && (
              <p className="text-xs leading-snug text-gray-500">{item.guidance}</p>
            )}

            {/* Not-applicable toggle — required items only. Item 13 is
                optional by design, so a blank there needs no justification. */}
            {item.required && (
              <label
                className={cn(
                  'flex items-center gap-2 w-fit',
                  readOnly ? 'cursor-not-allowed opacity-70' : 'cursor-pointer',
                )}
              >
                <input
                  type="checkbox"
                  checked={line.notApplicable}
                  disabled={readOnly}
                  onChange={(e) =>
                    updateLine(item.itemKey, e.target.checked
                      // A considered zero, stored distinctly from a blank.
                      ? { notApplicable: true, surveyedQty: 0, autoDerived: false }
                      // Deliberately keeps the quantity — the surveyor may have
                      // ticked this by mistake after entering a real number.
                      : { notApplicable: false })
                  }
                  className="h-4 w-4 shrink-0 rounded border-gray-300 text-brand-blue focus:ring-brand-blue"
                />
                <span className="text-xs text-gray-600">Not applicable at this site</span>
              </label>
            )}

            {missingReason && (
              <p className="text-xs text-brand-red">
                Enter a reason in Remarks — a not-applicable item still needs its &quot;why&quot; recorded.
              </p>
            )}

            {showHint && (
              <div className="flex items-center justify-between gap-2 px-2 py-1.5 rounded bg-blue-50 border border-blue-200">
                <span className="text-xs text-brand-blue">
                  Cable runs recorded: {hintMetres} m = {hintKmStr} km
                </span>
                {!readOnly && !line.notApplicable && (
                  <button
                    type="button"
                    onClick={() =>
                      updateLine(item.itemKey, {
                        surveyedQty: Number(hintKmStr),
                        remarks: `${hintMetres} m`,
                      })
                    }
                    className="text-xs font-medium text-brand-blue hover:underline shrink-0"
                  >
                    Use this
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Bill of Quantity — Section J. */
export function StepBoq({ survey, onChange, readOnly }: SurveyStepProps) {
  // Auto-derivation from Sections C/D. Runs on entry to this step and again
  // whenever its inputs change, so revisiting the BOQ after adding a bay picks
  // the new bay up. applyDerivedQuantities returns the SAME array reference
  // when nothing changed, so this settles after one pass instead of looping,
  // and it skips every line the surveyor has already taken control of.
  //
  // Service quantities are derived from `nextSupply`, not `survey.boqSupply`,
  // because they must mirror the supply line's FINAL value — including a
  // supply figure derived in this very pass.
  useEffect(() => {
    if (readOnly) return;

    // Service lines no longer auto-mirror their supply counterparts: every
    // service master item now carries autoDerived:false, so a recompute over
    // them was a guaranteed no-op. Only the supply side derives.
    const nextSupply = applyDerivedQuantities(survey.boqSupply, deriveSupplyQuantities(survey));
    if (nextSupply === survey.boqSupply) return;

    onChange({ boqSupply: nextSupply });
  }, [survey, onChange, readOnly]);

  return (
    <div className="flex flex-col gap-4">
      <h3 className="text-base font-semibold text-gray-900">Bill of Quantity</h3>

      <div className="p-3 rounded-lg bg-gray-50 border border-gray-100">
        <p className="text-xs text-gray-600">
          1 Km = 1000 m. Where surveyed quantity differs from the tender Annexure-I
          indicative figure, record the reason in Remarks. Items marked{' '}
          <span className="text-brand-red">*</span> need a quantity, or an explicit
          &quot;not applicable at this site&quot; with a reason — this BOQ, once
          jointly signed, governs supply at this site.
        </p>
      </div>

      <BoqSection
        title="Supply"
        master={SUPPLY_BOQ_MASTER}
        lines={survey.boqSupply}
        onChangeLines={(boqSupply) => onChange({ boqSupply })}
        cableRuns={survey.cableRuns}
        readOnly={readOnly}
      />

      <BoqSection
        title="Service"
        master={SERVICE_BOQ_MASTER}
        lines={survey.boqService}
        onChangeLines={(boqService) => onChange({ boqService })}
        cableRuns={survey.cableRuns}
        readOnly={readOnly}
      />

      <div className="flex flex-col gap-2 pt-2 border-t border-gray-100">
        <h4 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Confirmation</h4>
        {BOQ_CHECK_LABELS.map((item) => (
          <label
            key={item.key}
            className={cn(
              'flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors',
              survey.boqChecks[item.key] ? 'bg-blue-50 border-blue-200' : 'border-gray-200',
              readOnly && 'cursor-not-allowed opacity-70',
            )}
          >
            <input
              type="checkbox"
              checked={survey.boqChecks[item.key]}
              disabled={readOnly}
              onChange={(e) => onChange({ boqChecks: { ...survey.boqChecks, [item.key]: e.target.checked } })}
              className="mt-0.5 h-5 w-5 shrink-0 rounded border-gray-300 text-brand-blue focus:ring-brand-blue"
            />
            <span className="text-sm text-gray-700">{item.label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
