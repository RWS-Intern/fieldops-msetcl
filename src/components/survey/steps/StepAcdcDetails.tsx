import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { MCB_POLE_TYPE_LABELS } from '@/lib/surveyLabels';
import type { SurveyStepProps } from './StepProps';
import type {
  AcdcMcbBoardDetail, McbPoleType, McbSlot, SurveyAcdcMcbDetails,
} from '@/types';

/**
 * Fallback for a board a stale local draft predates. Same reasoning as
 * StepInfrastructure's EMPTY_AC_DC — the restore path normalises now, but the
 * component should not depend on its caller having done so.
 */
const EMPTY_BOARD: AcdcMcbBoardDetail = {
  spareMcbCount:   null,
  spareMcbPole:    null,
  spareMcbRating:  null,
  spareMcbRemarks: null,
  mcbUtilisedForNetworkPanel: null,
  utilisedMcbPole:    null,
  utilisedMcbRating:  null,
  utilisedMcbRemarks: null,
};

/** Column template shared by the board tables' heading and their two rows. */
const BOARD_GRID_COLS =
  'grid grid-cols-[9rem_minmax(6rem,1fr)_minmax(5rem,1fr)_minmax(7rem,1.4fr)] items-center gap-2';

function PoleSelect({
  value, onChange, readOnly, label,
}: {
  value:    McbPoleType | null;
  onChange: (v: McbPoleType) => void;
  readOnly: boolean;
  label:    string;
}) {
  return (
    <Select disabled={readOnly} value={value ?? undefined} onValueChange={(v) => onChange(v as McbPoleType)}>
      <SelectTrigger className="h-9" aria-label={label}>
        <SelectValue placeholder="Select…" />
      </SelectTrigger>
      <SelectContent>
        {(Object.keys(MCB_POLE_TYPE_LABELS) as McbPoleType[]).map((t) => (
          <SelectItem key={t} value={t}>{MCB_POLE_TYPE_LABELS[t]}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * One board's MCB detail — two rows under three shared columns, matching the
 * source document's own table 12 layout.
 *
 * The two rows are deliberately independent: the document gives each its own
 * pole type, rating and remarks, and whether the "utilised" MCB is one of the
 * spares counted above is not something one filled example can settle. Nothing
 * here links them.
 */
function BoardTable({
  title, subtitle, detail, onChange, readOnly,
}: {
  title:    string;
  subtitle: string;
  detail:   AcdcMcbBoardDetail;
  onChange: (patch: Partial<AcdcMcbBoardDetail>) => void;
  readOnly: boolean;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div>
        <h4 className="text-sm font-semibold uppercase tracking-wide text-gray-500">{title}</h4>
        <p className="text-xs text-gray-400">{subtitle}</p>
      </div>

      {/* Scrolls rather than wrapping — four columns of real inputs will not
          fit a phone, and the row/column alignment is the whole point of the
          layout. Same container pattern as the asset-count grid. */}
      <div className="overflow-x-auto">
        <div className="min-w-[30rem] flex flex-col gap-1.5 rounded-lg border border-gray-100 p-2">
          <div className={BOARD_GRID_COLS}>
            <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400" />
            <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">
              Single / Double Pole
            </span>
            <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">
              Rating (A)
            </span>
            <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">
              Remarks
            </span>
          </div>

          {/* Row 1 — the spare count. The "Nos." answer is the row's own
              first cell, so it sits under the row label rather than in one of
              the three shared columns. */}
          <div className={BOARD_GRID_COLS}>
            <div className="flex flex-col gap-0.5">
              <span className="text-xs font-medium text-gray-600">Spare MCBs (Nos.)</span>
              <Input
                className="h-9"
                type="number"
                inputMode="numeric"
                disabled={readOnly}
                aria-label="Number of spare MCBs"
                value={detail.spareMcbCount ?? ''}
                onChange={(e) => onChange({
                  spareMcbCount: e.target.value === '' ? null : Math.max(0, Number(e.target.value)),
                })}
              />
            </div>
            <PoleSelect
              label="Spare MCB pole type"
              value={detail.spareMcbPole}
              onChange={(v) => onChange({ spareMcbPole: v })}
              readOnly={readOnly}
            />
            <Input
              className="h-9"
              disabled={readOnly}
              aria-label="Spare MCB rating in amps"
              value={detail.spareMcbRating ?? ''}
              onChange={(e) => onChange({ spareMcbRating: e.target.value || null })}
            />
            <Input
              className="h-9"
              disabled={readOnly}
              aria-label="Spare MCB remarks"
              value={detail.spareMcbRemarks ?? ''}
              onChange={(e) => onChange({ spareMcbRemarks: e.target.value || null })}
            />
          </div>

          {/* Row 2 — the MCB that will actually be reused for the new panel. */}
          <div className={BOARD_GRID_COLS}>
            <div className="flex flex-col gap-0.5">
              <span className="text-xs font-medium text-gray-600">
                MCB to be used for network panel supply
              </span>
              <Input
                className="h-9"
                disabled={readOnly}
                aria-label="MCB that will be utilised for the network panel supply"
                value={detail.mcbUtilisedForNetworkPanel ?? ''}
                onChange={(e) => onChange({ mcbUtilisedForNetworkPanel: e.target.value || null })}
              />
            </div>
            <PoleSelect
              label="Utilised MCB pole type"
              value={detail.utilisedMcbPole}
              onChange={(v) => onChange({ utilisedMcbPole: v })}
              readOnly={readOnly}
            />
            <Input
              className="h-9"
              disabled={readOnly}
              aria-label="Utilised MCB rating in amps"
              value={detail.utilisedMcbRating ?? ''}
              onChange={(e) => onChange({ utilisedMcbRating: e.target.value || null })}
            />
            <Input
              className="h-9"
              disabled={readOnly}
              aria-label="Utilised MCB remarks"
              value={detail.utilisedMcbRemarks ?? ''}
              onChange={(e) => onChange({ utilisedMcbRemarks: e.target.value || null })}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * The superseded fixed-10-slot entries, shown read-only when a survey still
 * holds any.
 *
 * Never auto-mapped into the count above: ten individually-numbered slots
 * carry no clean translation into one aggregate "Nos.", and guessing would
 * write a wrong answer onto a document that governs a government submission.
 * Renders nothing for every survey that has none — which is all of them
 * except any in-progress one answered before this change.
 */
function LegacySlotsNote({ label, slots }: { label: string; slots: McbSlot[] }) {
  const filled = slots
    .map((slot, i) => ({ n: i + 1, ...slot }))
    .filter((slot) => slot.poleType !== null || slot.ratingA !== null);
  if (filled.length === 0) return null;

  return (
    <div className="rounded border border-amber-200 bg-amber-50 px-2 py-1.5">
      <p className="text-xs font-medium text-amber-900">
        Previously recorded {label} slots — please re-enter above
      </p>
      <ul className="mt-0.5 flex flex-col gap-0.5">
        {filled.map((slot) => (
          <li key={slot.n} className="text-xs text-amber-800">
            MCB {slot.n}: {slot.poleType ? MCB_POLE_TYPE_LABELS[slot.poleType] : '—'}
            {slot.ratingA ? `, ${slot.ratingA}` : ''}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * ACDB & DCDB Details — the station's own distribution boards.
 *
 * Not to be confused with the per-voltage-level DC breaker voltages on the
 * Site Infrastructure & Checklist step: those describe each substation voltage
 * level, this describes the station's own battery/charger system.
 */
export function StepAcdcDetails({ survey, onChange, readOnly }: SurveyStepProps) {
  const details = survey.acdcMcbDetails;

  function patch(p: Partial<SurveyAcdcMcbDetails>) {
    onChange({ acdcMcbDetails: { ...details, ...p } });
  }

  return (
    <div className="flex flex-col gap-6">
      <h3 className="text-base font-semibold text-gray-900">ACDB &amp; DCDB Details</h3>

      <div className="flex flex-col gap-2">
        <BoardTable
          title="ACDB Details"
          subtitle="230V AC distribution board."
          detail={details.acdb ?? EMPTY_BOARD}
          onChange={(p) => patch({ acdb: { ...(details.acdb ?? EMPTY_BOARD), ...p } })}
          readOnly={readOnly}
        />
        <LegacySlotsNote label="ACDB" slots={details.acdbMcbSlots ?? []} />
      </div>

      <div className="flex flex-col gap-3 border-t border-gray-100 pt-4">
        <div>
          <h4 className="text-sm font-semibold uppercase tracking-wide text-gray-500">DCDB Details</h4>
          <p className="text-xs text-gray-400">
            110 / 220V DC — the station&apos;s own battery / charger system.
          </p>
        </div>

        {/* Free text, not numbers — these carry their units as written, same
            reasoning as MVA Rating on the Transformer step. */}
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="chargerOutputVoltage">Charger O/P Voltage</Label>
            <Input
              id="chargerOutputVoltage"
              disabled={readOnly}
              placeholder="e.g. 220 V"
              value={details.dcdbChargerOutputVoltage ?? ''}
              onChange={(e) => patch({ dcdbChargerOutputVoltage: e.target.value || null })}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="batteryOutputVoltage">Battery O/P Voltage</Label>
            <Input
              id="batteryOutputVoltage"
              disabled={readOnly}
              placeholder="e.g. 220 V"
              value={details.dcdbBatteryOutputVoltage ?? ''}
              onChange={(e) => patch({ dcdbBatteryOutputVoltage: e.target.value || null })}
            />
          </div>
        </div>

        <BoardTable
          title="DCDB MCBs"
          subtitle="110 / 220V DC distribution board."
          detail={details.dcdb ?? EMPTY_BOARD}
          onChange={(p) => patch({ dcdb: { ...(details.dcdb ?? EMPTY_BOARD), ...p } })}
          readOnly={readOnly}
        />
        <LegacySlotsNote label="DCDB" slots={details.dcdbMcbSlots ?? []} />
      </div>
    </div>
  );
}
