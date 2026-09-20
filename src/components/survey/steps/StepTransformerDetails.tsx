import { Info } from 'lucide-react';
import { RepeatableGroup } from '@/components/survey/RepeatableGroup';
import { TriStateToggle } from '@/components/survey/TriStateToggle';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { VOLTAGE_LEVEL_LABELS, storedVoltageLabel, TAP_POSITION_CONNECTION_TYPE_LABELS } from '@/lib/surveyLabels';
import { SURVEY_VOLTAGE_LEVELS } from '@/types';
import { LegacyVoltageNote } from '@/components/survey/LegacyVoltageNote';
import type { SurveyStepProps } from './StepProps';
import type {
  SurveyTransformerEntry, SurveyVoltageLevel, TapPositionConnectionType,
} from '@/types';

function createTransformer(): SurveyTransformerEntry {
  return {
    uid:                         crypto.randomUUID(),
    transformerNumber:           '',
    voltageLevel:                null,
    mvaRating:                   null,
    rtccHighStep:                null,
    rtccLowStep:                 null,
    tapPositionConnectionType:   null,
    rtccPanelWorking:            null,
    existingTptWorking:          null,
    existingTpi4to20mAAvailable: null,
    tptRequired:                 null,
    requiredTptCount:            null,
    remarks:                     null,
  };
}

function renderTransformerSummary(tx: SurveyTransformerEntry, index: number) {
  const label = tx.transformerNumber.trim() || `Transformer #${index + 1}`;
  const voltageLabel = tx.voltageLevel ? storedVoltageLabel(tx.voltageLevel) : '—';
  const rating = tx.mvaRating?.trim();

  return (
    <>
      <span className="font-semibold text-gray-900">{label}</span>
      <span className="text-gray-400">
        {' '}· {voltageLabel}{rating ? ` · ${rating}` : ''}
      </span>
    </>
  );
}

/** Transformer Details — Step 5, repeatable. */
export function StepTransformerDetails({ survey, onChange, readOnly }: SurveyStepProps) {
  function renderTransformerForm(
    tx: SurveyTransformerEntry,
    update: (patch: Partial<SurveyTransformerEntry>) => void,
  ) {
    return (
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>Transformer Number</Label>
            <Input
              disabled={readOnly}
              value={tx.transformerNumber}
              onChange={(e) => update({ transformerNumber: e.target.value })}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Voltage Level</Label>
            <Select
              disabled={readOnly}
              value={tx.voltageLevel ?? undefined}
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
            <LegacyVoltageNote level={tx.voltageLevel} />
          </div>
        </div>

        {/* Nameplate values stay text so "50/63 MVA" and "+9/-9" transcribe intact. */}
        <div className="flex flex-col gap-1.5">
          <Label>MVA Rating</Label>
          <Input
            disabled={readOnly}
            placeholder="e.g. 50/25 MVA"
            value={tx.mvaRating ?? ''}
            onChange={(e) => update({ mvaRating: e.target.value || null })}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>RTCC High Step</Label>
            <Input
              disabled={readOnly}
              value={tx.rtccHighStep ?? ''}
              onChange={(e) => update({ rtccHighStep: e.target.value || null })}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>RTCC Low Step</Label>
            <Input
              disabled={readOnly}
              value={tx.rtccLowStep ?? ''}
              onChange={(e) => update({ rtccLowStep: e.target.value || null })}
            />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label>Tap Position Connection Type</Label>
          <Select
            disabled={readOnly}
            value={tx.tapPositionConnectionType ?? undefined}
            onValueChange={(v) => update({ tapPositionConnectionType: v as TapPositionConnectionType })}
          >
            <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
            <SelectContent>
              {(Object.keys(TAP_POSITION_CONNECTION_TYPE_LABELS) as TapPositionConnectionType[]).map((t) => (
                <SelectItem key={t} value={t}>{TAP_POSITION_CONNECTION_TYPE_LABELS[t]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <TriStateToggle
          label="RTCC panel working?"
          value={tx.rtccPanelWorking}
          onChange={(v) => update({ rtccPanelWorking: v })}
          readOnly={readOnly}
        />

        <TriStateToggle
          label="Existing TPT working?"
          value={tx.existingTptWorking}
          onChange={(v) => update({ existingTptWorking: v })}
          readOnly={readOnly}
        />
        {/*
          An analog output can't be assessed on a TPT that isn't working, so
          this only appears once the parent is yes. Not cleared when the
          parent flips back — same reasoning as the RS485 and AC-condition
          fields: discarding a recorded observation is worse than a hidden
          stale value the reviewer can see in context.
        */}
        {tx.existingTptWorking === true && (
          <TriStateToggle
            label="Existing TPI 4-20 mA output available?"
            value={tx.existingTpi4to20mAAvailable}
            onChange={(v) => update({ existingTpi4to20mAAvailable: v })}
            readOnly={readOnly}
          />
        )}

        <TriStateToggle
          label="Tap Position Transducer (TPT) required?"
          value={tx.tptRequired}
          onChange={(v) => update({ tptRequired: v })}
          readOnly={readOnly}
        />
        <div className="flex items-start gap-2 px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg">
          <Info className="h-4 w-4 text-gray-400 shrink-0 mt-0.5" />
          <p className="text-xs text-gray-600">
            This answer feeds the BOQ&apos;s <strong>Transformer Tap position transducer</strong>{' '}
            line. That quantity is entered by hand on the BOQ step — it is not summed from here —
            so cross-check the two before signing.
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label>No. of Required TPT</Label>
          <Input
            type="number" inputMode="numeric" disabled={readOnly}
            value={tx.requiredTptCount ?? ''}
            onChange={(e) => update({
              requiredTptCount: e.target.value === '' ? null : Math.max(0, Number(e.target.value)),
            })}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label>Remarks</Label>
          <Textarea
            disabled={readOnly}
            value={tx.remarks ?? ''}
            onChange={(e) => update({ remarks: e.target.value || null })}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-base font-semibold text-gray-900">Transformer Details</h3>

      <RepeatableGroup<SurveyTransformerEntry>
        entries={survey.transformers}
        onChange={(transformers) => onChange({ transformers })}
        createEntry={createTransformer}
        renderSummary={renderTransformerSummary}
        renderForm={renderTransformerForm}
        readOnly={readOnly}
        addLabel="Add Transformer"
        emptyText="No transformers added yet."
        entryNoun="transformer"
      />
    </div>
  );
}
