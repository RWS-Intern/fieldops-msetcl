import { RepeatableGroup } from '@/components/survey/RepeatableGroup';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import type { SurveyStepProps } from './StepProps';
import type { SurveyCableRun } from '@/types';

type CableType = NonNullable<SurveyCableRun['cableType']>;

const CABLE_TYPE_LABELS: Record<CableType, string> = {
  cat6:  'CAT6',
  power: 'Power',
};

type Trays = NonNullable<SurveyCableRun['trays']>;

const TRAYS_LABELS: Record<Trays, string> = {
  available:    'Available',
  new_required: 'New Required',
};

const TRAYS_UNSPECIFIED = 'unspecified';

function createCableRun(): SurveyCableRun {
  return {
    uid:       crypto.randomUUID(),
    cableType: null,
    fromTo:    '',
    lengthM:   null,
    trays:     null,
  };
}

function renderCableRunSummary(run: SurveyCableRun, index: number) {
  const label = run.fromTo.trim() || `Cable run #${index + 1}`;
  const typeLabel = run.cableType ? CABLE_TYPE_LABELS[run.cableType] : '—';
  const lengthLabel = run.lengthM != null ? `${run.lengthM} m` : '—';
  return (
    <>
      <span className="font-semibold text-gray-900">{typeLabel}</span>
      <span className="text-gray-400"> · {label} · {lengthLabel}</span>
    </>
  );
}

/** Cable runs — Section H, repeatable. */
export function StepCableRuns({ survey, onChange, readOnly }: SurveyStepProps) {
  const cat6Total  = survey.cableRuns
    .filter((r) => r.cableType === 'cat6')
    .reduce((sum, r) => sum + (r.lengthM ?? 0), 0);
  const powerTotal = survey.cableRuns
    .filter((r) => r.cableType === 'power')
    .reduce((sum, r) => sum + (r.lengthM ?? 0), 0);

  function renderCableRunForm(run: SurveyCableRun, update: (patch: Partial<SurveyCableRun>) => void) {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label>Cable Type</Label>
          <Select
            disabled={readOnly}
            value={run.cableType ?? undefined}
            onValueChange={(v) => update({ cableType: v as CableType })}
          >
            <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
            <SelectContent>
              {(Object.keys(CABLE_TYPE_LABELS) as CableType[]).map((t) => (
                <SelectItem key={t} value={t}>{CABLE_TYPE_LABELS[t]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label>Route (from / to)</Label>
          <Input
            disabled={readOnly}
            value={run.fromTo}
            onChange={(e) => update({ fromTo: e.target.value })}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label>Length (metres)</Label>
          <Input
            type="number" inputMode="numeric" disabled={readOnly}
            value={run.lengthM ?? ''}
            onChange={(e) => update({ lengthM: e.target.value === '' ? null : Math.max(0, Number(e.target.value)) })}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label>Trays</Label>
          <Select
            disabled={readOnly}
            value={run.trays ?? TRAYS_UNSPECIFIED}
            onValueChange={(v) => update({ trays: v === TRAYS_UNSPECIFIED ? null : (v as Trays) })}
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={TRAYS_UNSPECIFIED}>Not specified</SelectItem>
              {(Object.keys(TRAYS_LABELS) as Trays[]).map((t) => (
                <SelectItem key={t} value={t}>{TRAYS_LABELS[t]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-base font-semibold text-gray-900">Cable Runs</h3>

      <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-blue-50 border border-blue-200 text-xs text-brand-blue font-medium">
        <span>CAT6 total: {cat6Total} m</span>
        <span className="text-blue-300">·</span>
        <span>Power total: {powerTotal} m</span>
      </div>

      <RepeatableGroup<SurveyCableRun>
        entries={survey.cableRuns}
        onChange={(cableRuns) => onChange({ cableRuns })}
        createEntry={createCableRun}
        renderSummary={renderCableRunSummary}
        renderForm={renderCableRunForm}
        readOnly={readOnly}
        addLabel="Add Cable Run"
        emptyText="No cable runs added yet."
        entryNoun="cable run"
      />

      <div className="flex flex-col gap-1.5">
        <Label>Longest / difficult runs noted</Label>
        <Textarea
          disabled={readOnly}
          value={survey.difficultRunsNotes ?? ''}
          onChange={(e) => onChange({ difficultRunsNotes: e.target.value || null })}
        />
      </div>
    </div>
  );
}
