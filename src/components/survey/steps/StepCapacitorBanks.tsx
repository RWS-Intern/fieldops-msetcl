import { RepeatableGroup } from '@/components/survey/RepeatableGroup';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { VOLTAGE_LEVEL_LABELS, storedVoltageLabel, CAPACITOR_CONTROL_TYPE_LABELS } from '@/lib/surveyLabels';
import type { CapacitorControlType } from '@/lib/surveyLabels';
import { SURVEY_VOLTAGE_LEVELS } from '@/types';
import { LegacyVoltageNote } from '@/components/survey/LegacyVoltageNote';
import type { SurveyStepProps } from './StepProps';
import type { SurveyCapacitorBank, SurveyVoltageLevel } from '@/types';

function createCapacitorBank(): SurveyCapacitorBank {
  return {
    uid:           crypto.randomUUID(),
    bankNumber:    '',
    voltageLevel:  null,
    numberOfBanks: null,
    controlType:   null,
    ratingPerBank: null,
    workingStatus: null,
    remarks:       null,
  };
}

function renderBankSummary(bank: SurveyCapacitorBank, index: number) {
  const label = bank.bankNumber.trim() || `Capacitor bank #${index + 1}`;
  const voltageLabel = bank.voltageLevel ? storedVoltageLabel(bank.voltageLevel) : '—';
  const countLabel = bank.numberOfBanks != null ? ` · ${bank.numberOfBanks} bank${bank.numberOfBanks === 1 ? '' : 's'}` : '';

  return (
    <>
      <span className="font-semibold text-gray-900">{label}</span>
      <span className="text-gray-400">
        {' '}· {voltageLabel}{countLabel}
      </span>
    </>
  );
}

/**
 * Capacitor Bank Details — Step 4, repeatable.
 *
 * No photo capture: the checklist gives this section no photo column, and the
 * Feeder List / CRP Relay steps cover the panels a bank would be photographed
 * against. Site-wide shots still belong on the Photos step.
 */
export function StepCapacitorBanks({ survey, onChange, readOnly }: SurveyStepProps) {
  function renderBankForm(
    bank: SurveyCapacitorBank,
    update: (patch: Partial<SurveyCapacitorBank>) => void,
  ) {
    return (
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>Bank Number</Label>
            <Input
              disabled={readOnly}
              value={bank.bankNumber}
              onChange={(e) => update({ bankNumber: e.target.value })}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Voltage Level</Label>
            <Select
              disabled={readOnly}
              value={bank.voltageLevel ?? undefined}
              onValueChange={(v) => update({ voltageLevel: v as SurveyVoltageLevel })}
            >
              <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
              <SelectContent>
                {SURVEY_VOLTAGE_LEVELS.map((v) => (
                  <SelectItem key={v} value={v}>{VOLTAGE_LEVEL_LABELS[v]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {/* The stored value is the pre-split combined one, so the picker
                above reads as unanswered. Show what was actually recorded
                rather than leaving the surveyor to guess. */}
            <LegacyVoltageNote level={bank.voltageLevel} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>Number of Banks</Label>
            <Input
              type="number" inputMode="numeric" disabled={readOnly}
              value={bank.numberOfBanks ?? ''}
              onChange={(e) => update({
                numberOfBanks: e.target.value === '' ? null : Math.max(0, Number(e.target.value)),
              })}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Control Type</Label>
            <Select
              disabled={readOnly}
              value={bank.controlType ?? undefined}
              onValueChange={(v) => update({ controlType: v as CapacitorControlType })}
            >
              <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
              <SelectContent>
                {(Object.keys(CAPACITOR_CONTROL_TYPE_LABELS) as CapacitorControlType[]).map((t) => (
                  <SelectItem key={t} value={t}>{CAPACITOR_CONTROL_TYPE_LABELS[t]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Text, not a number: the rating is transcribed with its units. */}
        <div className="flex flex-col gap-1.5">
          <Label>Rating per Bank</Label>
          <Input
            disabled={readOnly}
            placeholder="e.g. 5 MVAR"
            value={bank.ratingPerBank ?? ''}
            onChange={(e) => update({ ratingPerBank: e.target.value || null })}
          />
        </div>

        {/*
          Free text rather than a yes/no toggle — see the note on the type.
          One entry can cover several banks, so a partial answer ("2 of 3 in
          service") has to be expressible.
        */}
        <div className="flex flex-col gap-1.5">
          <Label>Working Status</Label>
          <Input
            disabled={readOnly}
            placeholder="e.g. Working, or 2 of 3 in service"
            value={bank.workingStatus ?? ''}
            onChange={(e) => update({ workingStatus: e.target.value || null })}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label>Remarks</Label>
          <Textarea
            disabled={readOnly}
            value={bank.remarks ?? ''}
            onChange={(e) => update({ remarks: e.target.value || null })}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-base font-semibold text-gray-900">Capacitor Bank Details</h3>

      <RepeatableGroup<SurveyCapacitorBank>
        entries={survey.capacitorBanks}
        onChange={(capacitorBanks) => onChange({ capacitorBanks })}
        createEntry={createCapacitorBank}
        renderSummary={renderBankSummary}
        renderForm={renderBankForm}
        readOnly={readOnly}
        addLabel="Add Capacitor Bank"
        emptyText="No capacitor banks added yet."
        entryNoun="capacitor bank"
      />
    </div>
  );
}
