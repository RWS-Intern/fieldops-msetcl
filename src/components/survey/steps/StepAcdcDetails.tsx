import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { MCB_POLE_TYPE_LABELS } from '@/lib/surveyLabels';
import { ACDC_MCB_SLOT_COUNT } from '@/types';
import type { SurveyStepProps } from './StepProps';
import type { McbSlot, SurveyAcdcMcbDetails } from '@/types';

type McbPoleType = NonNullable<McbSlot['poleType']>;

/**
 * One board's spare-MCB table.
 *
 * Deliberately NOT a RepeatableGroup: nothing is ever added or removed — the
 * board has a fixed number of ways on the paper form, and every row exists
 * whether or not it is filled. A collapsible add/remove card per row would
 * also be ten taps deep on a phone for what is really a small grid.
 *
 * Laid out as compact rows (fixed label + two small controls) rather than the
 * stacked full-width fields the repeatable steps use, so all ten stay legible
 * and thumb-reachable without scrolling past one row per screen.
 */
function McbTable({
  title, subtitle, slots, onChange, readOnly,
}: {
  title:    string;
  subtitle: string;
  slots:    McbSlot[];
  onChange: (slots: McbSlot[]) => void;
  readOnly: boolean;
}) {
  function updateSlot(index: number, patch: Partial<McbSlot>) {
    onChange(slots.map((slot, i) => (i === index ? { ...slot, ...patch } : slot)));
  }

  return (
    <div className="flex flex-col gap-2">
      <div>
        <h4 className="text-sm font-semibold uppercase tracking-wide text-gray-500">{title}</h4>
        <p className="text-xs text-gray-400">{subtitle}</p>
      </div>

      <div className="flex flex-col gap-1.5 rounded-lg border border-gray-100 p-2">
        {/* Column headings once, rather than a Label on all twenty controls. */}
        <div className="grid grid-cols-[3.25rem_1fr_5.5rem] items-center gap-2 px-1">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Slot</span>
          <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Pole type</span>
          <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Rating (A)</span>
        </div>

        {slots.map((slot, i) => (
          <div key={i} className="grid grid-cols-[3.25rem_1fr_5.5rem] items-center gap-2">
            <span className="text-xs font-medium text-gray-600">MCB {i + 1}</span>

            <Select
              disabled={readOnly}
              value={slot.poleType ?? undefined}
              onValueChange={(v) => updateSlot(i, { poleType: v as McbPoleType })}
            >
              <SelectTrigger className="h-9" aria-label={`MCB ${i + 1} pole type`}>
                <SelectValue placeholder="Select…" />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(MCB_POLE_TYPE_LABELS) as McbPoleType[]).map((t) => (
                  <SelectItem key={t} value={t}>{MCB_POLE_TYPE_LABELS[t]}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Input
              className="h-9"
              disabled={readOnly}
              aria-label={`MCB ${i + 1} rating in amps`}
              value={slot.ratingA ?? ''}
              onChange={(e) => updateSlot(i, { ratingA: e.target.value || null })}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * ACDB & DCDB Details — the station's own distribution boards and their spare
 * ways.
 *
 * Not to be confused with the per-voltage-level DC breaker voltages on the
 * Site Infrastructure & Checklist step: those describe each substation voltage
 * level, this describes the station's own battery/charger system. Both are in
 * the source document; neither replaces the other.
 */
export function StepAcdcDetails({ survey, onChange, readOnly }: SurveyStepProps) {
  const details = survey.acdcMcbDetails;

  function patch(p: Partial<SurveyAcdcMcbDetails>) {
    onChange({ acdcMcbDetails: { ...details, ...p } });
  }

  return (
    <div className="flex flex-col gap-6">
      <h3 className="text-base font-semibold text-gray-900">ACDB &amp; DCDB Details</h3>

      <McbTable
        title="ACDB Details"
        subtitle={`Spare MCB ways on the 230V AC distribution board — ${ACDC_MCB_SLOT_COUNT} slots.`}
        slots={details.acdbMcbSlots}
        onChange={(acdbMcbSlots) => patch({ acdbMcbSlots })}
        readOnly={readOnly}
      />

      <div className="flex flex-col gap-3 border-t border-gray-100 pt-4">
        <div>
          <h4 className="text-sm font-semibold uppercase tracking-wide text-gray-500">DCDB Details</h4>
          <p className="text-xs text-gray-400">
            The station&apos;s own battery / charger system.
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
              placeholder="e.g. 48 V"
              value={details.dcdbChargerOutputVoltage ?? ''}
              onChange={(e) => patch({ dcdbChargerOutputVoltage: e.target.value || null })}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="batteryOutputVoltage">Battery O/P Voltage</Label>
            <Input
              id="batteryOutputVoltage"
              disabled={readOnly}
              placeholder="e.g. 48 V"
              value={details.dcdbBatteryOutputVoltage ?? ''}
              onChange={(e) => patch({ dcdbBatteryOutputVoltage: e.target.value || null })}
            />
          </div>
        </div>

        <McbTable
          title="DCDB Spare MCBs"
          subtitle={`Spare MCB ways on the 48V DC distribution board — ${ACDC_MCB_SLOT_COUNT} slots.`}
          slots={details.dcdbMcbSlots}
          onChange={(dcdbMcbSlots) => patch({ dcdbMcbSlots })}
          readOnly={readOnly}
        />
      </div>
    </div>
  );
}
