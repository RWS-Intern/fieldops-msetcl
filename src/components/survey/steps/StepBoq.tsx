import { useEffect } from 'react';
import { SUPPLY_BOQ_MASTER, SERVICE_BOQ_MASTER } from '@/lib/boqMaster';
import {
  deriveSupplyQuantities,
  applyDerivedQuantities,
} from '@/lib/boqDerivation';
import { BOQ_CHECK_LABELS } from '@/lib/surveyLabels';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import type { SurveyStepProps } from './StepProps';
import type { BoqMasterItem } from '@/lib/boqMaster';
import type { SurveyBoqLine, SurveyReport } from '@/types';

// ─── Cable-length hint — sourced from the Cable Runs step, in METRES ──────────
// No km conversion anywhere: the master's unit for these lines is 'm' (Phase 1
// decision), so the recorded run total is already the figure to enter.

const CABLE_HINT_BY_ITEM_KEY: Record<string, 'cat6' | 'power'> = {
  cat6Cable:                   'cat6',   // supply
  powerSupplyCable:            'power',  // supply
  cat6CableLayingTermination:  'cat6',   // service
  powerCableLayingTermination: 'power',  // service
};

function cableRunTotalMetres(cableRuns: SurveyReport['cableRuns'], cableType: 'cat6' | 'power'): number {
  return cableRuns
    .filter((r) => r.cableType === cableType)
    .reduce((sum, r) => sum + (r.lengthM ?? 0), 0);
}

/** Blank clears to null, never 0 — an unanswered column is not a considered zero. */
function toQty(raw: string): number | null {
  return raw === '' ? null : Math.max(0, Number(raw));
}

// ─── One BOQ section (Supply or Service) — stacked cards, matched by itemKey ───

function BoqSection({
  title, subtitle, master, lines, onChangeLines, cableRuns, readOnly,
}: {
  title:         string;
  subtitle:      string;
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
      <div>
        <h4 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">{title}</h4>
        <p className="text-xs text-gray-400">{subtitle}</p>
      </div>

      {master.map((item) => {
        // Matched by itemKey, never array position — createEmptyBoqLines()
        // seeds exactly one line per master item, but the master (not the
        // stored array's order) is always the source of truth for what to render.
        const line = lines.find((l) => l.itemKey === item.itemKey);
        if (!line) return null;

        const cableType  = CABLE_HINT_BY_ITEM_KEY[item.itemKey];
        const hintMetres = cableType ? cableRunTotalMetres(cableRuns, cableType) : null;
        const showHint   = hintMetres !== null && hintMetres > 0;

        // A not-applicable line without a reason is the one thing this toggle
        // exists to prevent, so it is surfaced inline as well as in the
        // step's validation summary.
        const missingReason = line.notApplicable && !line.remarks?.trim();

        // Metres can legitimately be fractional; counts cannot.
        const qtyInputMode = item.unit === 'm' ? 'decimal' : 'numeric';

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

            {/* The official table's two quantity columns. Service/ITC items
                carry hasExistingUsable:false — "already on site" is
                meaningless for an installation activity — so those render
                the supply column alone rather than a dead input. */}
            <div className={cn('grid gap-2', item.hasExistingUsable ? 'grid-cols-2' : 'grid-cols-1')}>
              {item.hasExistingUsable && (
                <div className="flex flex-col gap-1">
                  <Label className="text-xs">Existing Usable (at site)</Label>
                  <Input
                    type="number"
                    inputMode={qtyInputMode}
                    // Never disabled by notApplicable: what is already
                    // installed is the surveyor's own observation, and it
                    // stays true whether or not we supply more. Never
                    // auto-derived either.
                    disabled={readOnly}
                    value={line.existingUsable ?? ''}
                    onChange={(e) => updateLine(item.itemKey, { existingUsable: toQty(e.target.value) })}
                  />
                </div>
              )}

              <div className="flex flex-col gap-1">
                <Label className="text-xs">Required to Supply</Label>
                <Input
                  type="number"
                  inputMode={qtyInputMode}
                  // Locked at 0 while marked not applicable — unticking the
                  // toggle makes it editable again without clearing it.
                  disabled={readOnly || line.notApplicable}
                  value={line.requiredToSupply ?? ''}
                  onChange={(e) =>
                    updateLine(item.itemKey, {
                      requiredToSupply: toQty(e.target.value),
                      // Any manual edit takes the line out of auto control for
                      // good — recomputes must never overwrite it after this.
                      autoDerived: false,
                    })
                  }
                />
                {line.autoDerived && line.requiredToSupply !== null && (
                  <span className="text-[10px] leading-snug text-brand-blue">
                    Auto-calculated — adjust if needed
                  </span>
                )}
              </div>
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

            {item.guidance && (
              <p className="text-xs leading-snug text-gray-500">{item.guidance}</p>
            )}

            {/* Not-applicable toggle — required items only. An optional line's
                blank needs no justification (none are optional today, but the
                master, not this component, decides that). */}
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
                      // existingUsable is deliberately left alone — zeroing it
                      // would assert an observation nobody made.
                      ? { notApplicable: true, requiredToSupply: 0, autoDerived: false }
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
                  Cable runs recorded: {hintMetres} m
                </span>
                {!readOnly && !line.notApplicable && (
                  <button
                    type="button"
                    // Sets the supply column only, and takes the line out of
                    // auto control like any other manual entry. Remarks are
                    // NOT touched: the old version wrote the metre figure
                    // there because the field itself was in km, and doing that
                    // now would overwrite whatever the surveyor had written.
                    onClick={() =>
                      updateLine(item.itemKey, {
                        requiredToSupply: hintMetres,
                        autoDerived: false,
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

/** Bill of Quantity — the official two-column table plus the service lines. */
export function StepBoq({ survey, onChange, readOnly }: SurveyStepProps) {
  // Auto-derivation of the four derived supply lines: MFM / CMR / F-RTU summed
  // from the Feeder List, and the tap-position transducer counted from
  // Transformer Details. Runs on entry to this step and again whenever its
  // inputs change, so revisiting the BOQ after adding a feeder or transformer
  // picks it up.
  //
  // applyDerivedQuantities returns the SAME array reference when nothing
  // changed, so this settles after one pass instead of looping, and it skips
  // every line the surveyor has already taken control of.
  //
  // Service lines do NOT auto-mirror their supply counterparts: every service
  // master item carries autoDerived:false, so a recompute over them is a
  // guaranteed no-op. Both of their columns are direct entry.
  useEffect(() => {
    if (readOnly) return;

    const nextSupply = applyDerivedQuantities(survey.boqSupply, deriveSupplyQuantities(survey));
    if (nextSupply === survey.boqSupply) return;

    onChange({ boqSupply: nextSupply });
  }, [survey, onChange, readOnly]);

  return (
    <div className="flex flex-col gap-4">
      <h3 className="text-base font-semibold text-gray-900">Bill of Quantity</h3>

      <div className="p-3 rounded-lg bg-gray-50 border border-gray-100">
        <p className="text-xs text-gray-600">
          Record what is already installed and usable at the site, and what we must supply.
          Cable lines are in metres. Where a quantity differs from the tender Annexure-I
          indicative figure, record the reason in Remarks. Items marked{' '}
          <span className="text-brand-red">*</span> need a required-to-supply quantity, or an
          explicit &quot;not applicable at this site&quot; with a reason — this BOQ, once
          jointly signed, governs supply at this site.
        </p>
      </div>

      <BoqSection
        title="Supply"
        subtitle="Both columns apply — existing usable, and required to supply."
        master={SUPPLY_BOQ_MASTER}
        lines={survey.boqSupply}
        onChangeLines={(boqSupply) => onChange({ boqSupply })}
        cableRuns={survey.cableRuns}
        readOnly={readOnly}
      />

      <BoqSection
        title="Service"
        subtitle="Installation, testing & commissioning — required quantity only."
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
