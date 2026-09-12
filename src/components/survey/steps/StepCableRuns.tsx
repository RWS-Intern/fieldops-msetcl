import { RepeatableGroup } from '@/components/survey/RepeatableGroup';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { TRAYS_LABELS } from '@/lib/surveyLabels';
import type { CableType, Trays } from '@/lib/surveyLabels';
import type { SurveyStepProps } from './StepProps';
import type { SurveyCableRun } from '@/types';

const TRAYS_UNSPECIFIED = 'unspecified';

/** One rendered group per cable type — the type is never a per-entry choice. */
const CABLE_GROUPS: {
  type: CableType; title: string; addLabel: string; emptyText: string; entryNoun: string;
}[] = [
  { type: 'cat6',  title: 'CAT6 Cable Runs',  addLabel: 'Add CAT6 Run',
    emptyText: 'No CAT6 cable runs added yet.',  entryNoun: 'CAT6 run' },
  { type: 'power', title: 'Power Cable Runs', addLabel: 'Add Power Run',
    emptyText: 'No power cable runs added yet.', entryNoun: 'power run' },
];

/**
 * Each group's Add button stamps its own cable type, so an entry can never be
 * created without one — which is why the per-entry type picker is gone.
 */
function createCableRun(cableType: CableType): SurveyCableRun {
  return {
    uid:       crypto.randomUUID(),
    cableType,
    fromTo:    '',
    lengthM:   null,
    trays:     null,
  };
}

// The type is already stated by the group heading, so the collapsed line
// leads with the route instead of repeating it.
function renderCableRunSummary(run: SurveyCableRun, index: number) {
  const label = run.fromTo.trim() || `Run #${index + 1}`;
  const lengthLabel = run.lengthM != null ? `${run.lengthM} m` : '—';
  return (
    <>
      <span className="font-semibold text-gray-900">{label}</span>
      <span className="text-gray-400"> · {lengthLabel}</span>
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

      {/* Two groups over ONE underlying array: each list is survey.cableRuns
          filtered by type, and each group's onChange splices its own type back
          together with the other type's entries untouched. Both are required
          before Submit — every site needs a CAT6 route and a power route. */}
      {CABLE_GROUPS.map(({ type, title, addLabel, emptyText, entryNoun }) => (
        <div key={type} className="flex flex-col gap-2">
          <h4 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
            {title}<span className="text-brand-red"> *</span>
          </h4>
          <RepeatableGroup<SurveyCableRun>
            entries={survey.cableRuns.filter((r) => r.cableType === type)}
            onChange={(runs) => onChange({
              cableRuns: [...survey.cableRuns.filter((r) => r.cableType !== type), ...runs],
            })}
            createEntry={() => createCableRun(type)}
            renderSummary={renderCableRunSummary}
            renderForm={renderCableRunForm}
            readOnly={readOnly}
            addLabel={addLabel}
            emptyText={emptyText}
            entryNoun={entryNoun}
          />
        </div>
      ))}

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
