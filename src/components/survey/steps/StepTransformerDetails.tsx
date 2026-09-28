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
import { transformerNeedsNewTpt } from '@/lib/boqDerivation';
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
    modbusAvailable:             null,
    // Superseded — seeded null and never written again.
    existingTpi4to20mAAvailable: null,
    tptRequired:                 null,
    requiredTptCount:            null,
    remarks:                     null,
  };
}

/**
 * One answer to a question this step no longer asks.
 *
 * Grey, not amber, and worded as a statement: the TPT count is derived now, so
 * there is nowhere to re-enter these — historical context, not an action. Same
 * treatment as relay Protocol / IP.
 */
function RemovedAnswerNote({
  label, value,
}: {
  label: string;
  value: string | number | boolean | null;
}) {
  if (value === null || value === undefined) return null;

  return (
    <p className="rounded border border-gray-200 bg-gray-50 px-2 py-1.5 text-xs text-gray-600">
      Previously recorded, no longer collected — <strong>{label}</strong>:{' '}
      <strong>{typeof value === 'boolean' ? (value ? 'Yes' : 'No') : String(value)}</strong>.
      Kept for reference only.
    </p>
  );
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
    // The single source of truth for the rule — imported, never restated here,
    // so the form and the BOQ can never disagree about what counts.
    const needsNewTpt = transformerNeedsNewTpt(tx);

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
          Only meaningful about a TPT that works, so it appears once the parent
          is yes — the same slot and the same condition the 4-20 mA question
          used. Not cleared when the parent flips back: discarding a recorded
          observation is worse than a hidden stale value the reviewer can see
          in context.
        */}
        {tx.existingTptWorking === true && (
          <TriStateToggle
            label="Modbus Available?"
            value={tx.modbusAvailable}
            onChange={(v) => update({ modbusAvailable: v })}
            readOnly={readOnly}
          />
        )}

        {/* The consequence of the two answers above, stated rather than left
            for the surveyor to infer from the BOQ step. */}
        <div className="flex items-start gap-2 px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg">
          <Info className="h-4 w-4 text-gray-400 shrink-0 mt-0.5" />
          <p className="text-xs text-gray-600">
            {needsNewTpt === null
              ? <>Answer both questions above and this transformer will be counted, or not
                  counted, towards the BOQ&apos;s <strong>Transformer Tap position
                  transducer</strong> line automatically.</>
              : needsNewTpt
                ? <>A <strong>new TPT is needed</strong> for this transformer — it is counted in
                    the BOQ&apos;s <strong>Transformer Tap position transducer</strong> line.</>
                : <>The existing TPT can be integrated over Modbus — <strong>no new TPT</strong>{' '}
                    is counted for this transformer.</>}
          </p>
        </div>

        {/* Superseded answers, where a transformer still holds them. There is
            nothing to re-enter them into: the count is derived now. */}
        <RemovedAnswerNote
          label="Existing TPI 4-20 mA output available"
          value={tx.existingTpi4to20mAAvailable}
        />
        <RemovedAnswerNote label="Tap Position Transducer (TPT) required" value={tx.tptRequired} />
        <RemovedAnswerNote label="No. of Required TPT" value={tx.requiredTptCount} />

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
