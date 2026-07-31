import { TriStateToggle } from '@/components/survey/TriStateToggle';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { CIVIL_WORK_LABELS, DC_VOLTAGE_LABELS } from '@/lib/surveyLabels';
import type { CivilWork, DcVoltage } from '@/lib/surveyLabels';
import type { SurveyStepProps } from './StepProps';
import type { SurveyInfrastructure } from '@/types';

const CIVIL_WORK_OPTIONS: CivilWork[] = ['grouting', 'cable_entry', 'foundation', 'none'];
const DC_VOLTAGE_OPTIONS: DcVoltage[] = ['110', '48', '24'];

function MultiSelectChips<T extends string>({
  options, labels, value, onToggle, readOnly,
}: {
  options:  T[];
  labels:   Record<T, string>;
  value:    T[];
  onToggle: (opt: T) => void;
  readOnly: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((opt) => {
        const active = value.includes(opt);
        return (
          <button
            key={opt}
            type="button"
            disabled={readOnly}
            onClick={() => onToggle(opt)}
            className={cn(
              'px-3 py-1.5 rounded-full text-xs font-medium border transition-colors',
              active ? 'bg-brand-blue text-white border-brand-blue' : 'border-gray-200 text-gray-600 hover:bg-gray-50',
              readOnly && 'cursor-not-allowed opacity-60',
            )}
          >
            {labels[opt]}
          </button>
        );
      })}
    </div>
  );
}

/** Panel, power & comms — Sections E + F + G (no repeatable groups). */
export function StepInfrastructure({ survey, onChange, readOnly }: SurveyStepProps) {
  const infra = survey.infrastructure;

  function patchInfra(patch: Partial<SurveyInfrastructure>) {
    onChange({ infrastructure: { ...infra, ...patch } });
  }

  function toggleCivilWork(opt: CivilWork) {
    if (opt === 'none') {
      patchInfra({ civilWork: infra.civilWork.includes('none') ? [] : ['none'] });
      return;
    }
    const withoutNone = infra.civilWork.filter((c) => c !== 'none');
    patchInfra({
      civilWork: withoutNone.includes(opt)
        ? withoutNone.filter((c) => c !== opt)
        : [...withoutNone, opt],
    });
  }

  function toggleDcVoltage(opt: DcVoltage) {
    patchInfra({
      dcVoltages: infra.dcVoltages.includes(opt)
        ? infra.dcVoltages.filter((v) => v !== opt)
        : [...infra.dcVoltages, opt],
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <h3 className="text-base font-semibold text-gray-900">Panel, Power &amp; Comms</h3>

      {/* Section E — Panel space & mounting */}
      <div className="flex flex-col gap-3">
        <h4 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
          Panel Space &amp; Mounting
        </h4>

        <TriStateToggle
          label="Panel space available?"
          value={infra.panelSpaceAvailable}
          onChange={(v) => patchInfra({ panelSpaceAvailable: v })}
          readOnly={readOnly}
        />
        <div className="flex flex-col gap-1.5">
          <Label>Space available for new networking panel and RTU (measure)</Label>
          <Input
            disabled={readOnly}
            value={infra.panelSpaceMeasurement ?? ''}
            onChange={(e) => patchInfra({ panelSpaceMeasurement: e.target.value || null })}
          />
        </div>
        <TriStateToggle
          label="New panel required, or free space in existing panels?"
          value={infra.newPanelRequired}
          onChange={(v) => patchInfra({ newPanelRequired: v })}
          readOnly={readOnly}
        />
        <div className="flex flex-col gap-1.5">
          <Label>Mounting arrangement / rack space</Label>
          <Textarea
            disabled={readOnly}
            value={infra.mountingNotes ?? ''}
            onChange={(e) => patchInfra({ mountingNotes: e.target.value || null })}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Minor civil work needed (note extent)</Label>
          <MultiSelectChips
            options={CIVIL_WORK_OPTIONS}
            labels={CIVIL_WORK_LABELS}
            value={infra.civilWork}
            onToggle={toggleCivilWork}
            readOnly={readOnly}
          />
        </div>
      </div>

      {/* Section F — Power supply */}
      <div className="flex flex-col gap-3 pt-4 border-t border-gray-100">
        <h4 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
          Power Supply
        </h4>

        <TriStateToggle
          label="DC supply available?"
          value={infra.dcSupplyAvailable}
          onChange={(v) => patchInfra({ dcSupplyAvailable: v })}
          readOnly={readOnly}
        />
        <div className="flex flex-col gap-1.5">
          <Label>DC voltages present</Label>
          <MultiSelectChips
            options={DC_VOLTAGE_OPTIONS}
            labels={DC_VOLTAGE_LABELS}
            value={infra.dcVoltages}
            onToggle={toggleDcVoltage}
            readOnly={readOnly}
          />
        </div>
        <TriStateToggle
          label="AC supply available?"
          value={infra.acSupplyAvailable}
          onChange={(v) => patchInfra({ acSupplyAvailable: v })}
          readOnly={readOnly}
        />
        <TriStateToggle
          label="Spare MCBs / feeders for the new equipment"
          value={infra.spareMcbs}
          onChange={(v) => patchInfra({ spareMcbs: v })}
          readOnly={readOnly}
        />
        <div className="flex flex-col gap-1.5">
          <Label>DCDB / distribution location</Label>
          <Input
            disabled={readOnly}
            value={infra.dcdbLocation ?? ''}
            onChange={(e) => patchInfra({ dcdbLocation: e.target.value || null })}
          />
        </div>
      </div>

      {/* Section G — Communication & networking */}
      <div className="flex flex-col gap-3 pt-4 border-t border-gray-100">
        <h4 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
          Communication &amp; Networking
        </h4>

        <TriStateToggle
          label="Existing OFC / Ethernet availability"
          value={infra.ofcAvailable}
          onChange={(v) => patchInfra({ ofcAvailable: v })}
          readOnly={readOnly}
        />
        <TriStateToggle
          label="Router available?"
          value={infra.routerAvailable}
          onChange={(v) => patchInfra({ routerAvailable: v })}
          readOnly={readOnly}
        />
        <TriStateToggle
          label="MPLS available?"
          value={infra.mplsAvailable}
          onChange={(v) => patchInfra({ mplsAvailable: v })}
          readOnly={readOnly}
        />
        <div className="flex flex-col gap-1.5">
          <Label>Path / readiness for link to SLDC &amp; ALDC (substation-end)</Label>
          <Textarea
            disabled={readOnly}
            value={infra.sldcPathNotes ?? ''}
            onChange={(e) => patchInfra({ sldcPathNotes: e.target.value || null })}
          />
        </div>
        <TriStateToggle
          label="Earthing points available for equipment/panel"
          value={infra.earthingAvailable}
          onChange={(v) => patchInfra({ earthingAvailable: v })}
          readOnly={readOnly}
        />
      </div>
    </div>
  );
}
