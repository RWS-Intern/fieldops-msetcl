import { AlertTriangle } from 'lucide-react';
import { RepeatableGroup } from '@/components/survey/RepeatableGroup';
import { TriStateToggle } from '@/components/survey/TriStateToggle';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import type { SurveyStepProps } from './StepProps';
import type { SurveyBay, BayType } from '@/types';

const BAY_TYPE_LABELS: Record<BayType, string> = {
  line:         'Line',
  transformer:  'Transformer',
  bus_coupler:  'Bus Coupler',
  bus_section:  'Bus Section',
  capacitor:    'Capacitor',
  reactor:      'Reactor',
};

type VoltageLevel = NonNullable<SurveyBay['voltageLevel']>;
const VOLTAGE_LEVELS: VoltageLevel[] = ['132', '110', '100', '66'];

function createBay(): SurveyBay {
  return {
    uid:               crypto.randomUUID(),
    bayNumber:         '',
    bayType:           null,
    voltageLevel:      null,
    diPoints:          null,
    doPoints:          null,
    aiPoints:          null,
    ctRatio:           null,
    ptRatio:           null,
    tapChangerPresent: null,
    tapPositions:      null,
    photos:            [],
    remarks:           null,
  };
}

function renderBaySummary(bay: SurveyBay, index: number) {
  const label = bay.bayNumber.trim() || `Bay #${index + 1}`;
  const typeLabel = bay.bayType ? BAY_TYPE_LABELS[bay.bayType] : '—';
  const voltageLabel = bay.voltageLevel ? `${bay.voltageLevel} kV` : '—';
  const diLabel = bay.diPoints ?? '—';
  const doLabel = bay.doPoints ?? '—';
  const aiLabel = bay.aiPoints ?? '—';
  return (
    <>
      <span className="font-semibold text-gray-900">{label}</span>
      <span className="text-gray-400">
        {' '}· {typeLabel} · {voltageLabel} · DI {diLabel}/DO {doLabel}/AI {aiLabel}
      </span>
    </>
  );
}

/** Bays — Section C, repeatable. */
export function StepBays({ survey, onChange, readOnly }: SurveyStepProps) {
  function renderBayForm(bay: SurveyBay, update: (patch: Partial<SurveyBay>) => void) {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label>Bay Number</Label>
          <Input
            disabled={readOnly}
            value={bay.bayNumber}
            onChange={(e) => update({ bayNumber: e.target.value })}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>Bay Type</Label>
            <Select
              disabled={readOnly}
              value={bay.bayType ?? undefined}
              onValueChange={(v) => update({ bayType: v as BayType })}
            >
              <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
              <SelectContent>
                {(Object.keys(BAY_TYPE_LABELS) as BayType[]).map((t) => (
                  <SelectItem key={t} value={t}>{BAY_TYPE_LABELS[t]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Voltage Level</Label>
            <Select
              disabled={readOnly}
              value={bay.voltageLevel ?? undefined}
              onValueChange={(v) => update({ voltageLevel: v as VoltageLevel })}
            >
              <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
              <SelectContent>
                {VOLTAGE_LEVELS.map((v) => (
                  <SelectItem key={v} value={v}>{v} kV</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label>Status (digital input) points — CB, isolators, earth switches, trip/alarm</Label>
          <Input
            type="number" inputMode="numeric" disabled={readOnly}
            value={bay.diPoints ?? ''}
            onChange={(e) => update({ diPoints: e.target.value === '' ? null : Math.max(0, Number(e.target.value)) })}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Control (digital output) points — open/close</Label>
          <Input
            type="number" inputMode="numeric" disabled={readOnly}
            value={bay.doPoints ?? ''}
            onChange={(e) => update({ doPoints: e.target.value === '' ? null : Math.max(0, Number(e.target.value)) })}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Analog points — MW, MVAR, V, I, Hz</Label>
          <Input
            type="number" inputMode="numeric" disabled={readOnly}
            value={bay.aiPoints ?? ''}
            onChange={(e) => update({ aiPoints: e.target.value === '' ? null : Math.max(0, Number(e.target.value)) })}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>CT Ratio</Label>
            <Input
              disabled={readOnly}
              value={bay.ctRatio ?? ''}
              onChange={(e) => update({ ctRatio: e.target.value || null })}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>PT Ratio</Label>
            <Input
              disabled={readOnly}
              value={bay.ptRatio ?? ''}
              onChange={(e) => update({ ptRatio: e.target.value || null })}
            />
          </div>
        </div>

        {bay.bayType === 'transformer' && (
          <TriStateToggle
            label="Tap changer present?"
            value={bay.tapChangerPresent}
            onChange={(v) => update({ tapChangerPresent: v })}
            readOnly={readOnly}
          />
        )}
        {bay.bayType === 'transformer' && bay.tapChangerPresent === true && (
          <div className="flex flex-col gap-1.5">
            <Label>Number of Tap Positions</Label>
            <Input
              type="number" inputMode="numeric" disabled={readOnly}
              value={bay.tapPositions ?? ''}
              onChange={(e) => update({ tapPositions: e.target.value === '' ? null : Number(e.target.value) })}
            />
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <Label>Remarks</Label>
          <Textarea
            disabled={readOnly}
            value={bay.remarks ?? ''}
            onChange={(e) => update({ remarks: e.target.value || null })}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-base font-semibold text-gray-900">Bays</h3>

      <div className="flex items-start gap-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
        <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
        <p className="text-xs text-amber-800">
          The bay/signal counts decide how many FRTU/Remote-IO modules, MFMs, CMRs and
          tap-position transducers each site needs. Count carefully — the Section J
          quantities are built from this.
        </p>
      </div>

      <RepeatableGroup<SurveyBay>
        entries={survey.bays}
        onChange={(bays) => onChange({ bays })}
        createEntry={createBay}
        renderSummary={renderBaySummary}
        renderForm={renderBayForm}
        readOnly={readOnly}
        addLabel="Add Bay"
        emptyText="No bays added yet."
        entryNoun="bay"
      />
    </div>
  );
}
