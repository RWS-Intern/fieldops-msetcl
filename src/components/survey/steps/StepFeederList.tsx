import { AlertTriangle, Info } from 'lucide-react';
import { RepeatableGroup } from '@/components/survey/RepeatableGroup';
import { TriStateToggle } from '@/components/survey/TriStateToggle';
import { PhotoCapture } from '@/components/survey/PhotoCapture';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { VOLTAGE_LEVEL_LABELS } from '@/lib/surveyLabels';
import { SURVEY_VOLTAGE_LEVELS } from '@/types';
import type { SurveyStepProps } from './StepProps';
import type { SurveyFeederEntry, SurveyVoltageLevel } from '@/types';

function createFeeder(): SurveyFeederEntry {
  return {
    uid:                            crypto.randomUUID(),
    bayName:                        '',
    nominalVoltage:                 null,
    feederOrTransformerDescription: null,
    cableTrenchLengthM:             null,
    panelSpaceAvailable:            null,
    existingMfmAvailableWorking:    null,
    existingMfmRs485Available:      null,
    mfmRequired:                    null,
    cmrRequired:                    null,
    ctPtRatio:                      null,
    shutdownRequired:               null,
    diStatusPoints:                 null,
    frtuModulesRequired:            null,
    remarks:                        null,
    photos:                         [],
  };
}

/**
 * Collapsed line: bay name, voltage, then the three supply-driving counts —
 * but only the ones actually filled. A feeder nobody has costed yet shows just
 * its name and voltage rather than a row of dashes implying zeros.
 */
function renderFeederSummary(feeder: SurveyFeederEntry, index: number) {
  const label = feeder.bayName.trim() || `Feeder #${index + 1}`;
  const voltageLabel = feeder.nominalVoltage
    ? VOLTAGE_LEVEL_LABELS[feeder.nominalVoltage]
    : '—';

  const counts = [
    feeder.mfmRequired         != null ? `MFM ${feeder.mfmRequired}`   : null,
    feeder.cmrRequired         != null ? `CMR ${feeder.cmrRequired}`   : null,
    feeder.frtuModulesRequired != null ? `F-RTU ${feeder.frtuModulesRequired}` : null,
  ].filter(Boolean) as string[];

  return (
    <>
      <span className="font-semibold text-gray-900">{label}</span>
      <span className="text-gray-400">
        {' '}· {voltageLabel}
        {counts.length > 0 ? ` · ${counts.join(' / ')}` : ''}
      </span>
    </>
  );
}

/** Feeder List — Step 2, repeatable. Replaces the old Bays step. */
export function StepFeederList({ survey, onChange, readOnly, onReplacePhotoRef }: SurveyStepProps) {
  function renderFeederForm(
    feeder: SurveyFeederEntry,
    update: (patch: Partial<SurveyFeederEntry>) => void,
  ) {
    return (
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>Bay Name</Label>
            <Input
              disabled={readOnly}
              value={feeder.bayName}
              onChange={(e) => update({ bayName: e.target.value })}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Nominal Voltage</Label>
            <Select
              disabled={readOnly}
              value={feeder.nominalVoltage ?? undefined}
              onValueChange={(v) => update({ nominalVoltage: v as SurveyVoltageLevel })}
            >
              <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
              <SelectContent>
                {SURVEY_VOLTAGE_LEVELS.map((v) => (
                  <SelectItem key={v} value={v}>{VOLTAGE_LEVEL_LABELS[v]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label>Feeder / Transformer Description</Label>
          <Input
            disabled={readOnly}
            value={feeder.feederOrTransformerDescription ?? ''}
            onChange={(e) => update({ feederOrTransformerDescription: e.target.value || null })}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label>Cable Trench Length (m)</Label>
          <Input
            type="number" inputMode="numeric" disabled={readOnly}
            value={feeder.cableTrenchLengthM ?? ''}
            onChange={(e) => update({
              cableTrenchLengthM: e.target.value === '' ? null : Math.max(0, Number(e.target.value)),
            })}
          />
        </div>

        <TriStateToggle
          label="Panel space available?"
          value={feeder.panelSpaceAvailable}
          onChange={(v) => update({ panelSpaceAvailable: v })}
          readOnly={readOnly}
        />

        <TriStateToggle
          label="Existing MFM available & working?"
          value={feeder.existingMfmAvailableWorking}
          onChange={(v) => update({ existingMfmAvailableWorking: v })}
          readOnly={readOnly}
        />
        {/*
          RS485 is only a meaningful question about an MFM that exists. Note the
          answer is NOT cleared when the parent flips back to no/unanswered —
          silently discarding a recorded observation would be worse than a
          hidden stale value, and the reviewer sees the parent answer too.
        */}
        {feeder.existingMfmAvailableWorking === true && (
          <TriStateToggle
            label="Existing MFM RS485 available?"
            value={feeder.existingMfmRs485Available}
            onChange={(v) => update({ existingMfmRs485Available: v })}
            readOnly={readOnly}
          />
        )}

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>MFM required</Label>
            <Input
              type="number" inputMode="numeric" disabled={readOnly}
              value={feeder.mfmRequired ?? ''}
              onChange={(e) => update({
                mfmRequired: e.target.value === '' ? null : Math.max(0, Number(e.target.value)),
              })}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>CMR required</Label>
            <Input
              type="number" inputMode="numeric" disabled={readOnly}
              value={feeder.cmrRequired ?? ''}
              onChange={(e) => update({
                cmrRequired: e.target.value === '' ? null : Math.max(0, Number(e.target.value)),
              })}
            />
          </div>
        </div>

        {/*
          The printed Feeder List column reads "MFT required". The app
          standardises on MFM everywhere (decision 6), so a surveyor comparing
          screen to paper WILL see a different abbreviation in this one column.
          Flagged inline rather than only in the docs, because the person who
          hits it is the surveyor, not whoever read the handover note.
        */}
        <div className="flex items-start gap-2 px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg">
          <Info className="h-4 w-4 text-gray-400 shrink-0 mt-0.5" />
          <p className="text-xs text-gray-600">
            The paper checklist labels this column <strong>MFT required</strong>. It is the same
            figure as <strong>MFM required</strong> above — this app uses MFM throughout.
            Worth calling out when training surveyors.
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label>CT / PT Ratio</Label>
          <Input
            disabled={readOnly}
            value={feeder.ctPtRatio ?? ''}
            onChange={(e) => update({ ctPtRatio: e.target.value || null })}
          />
        </div>

        <TriStateToggle
          label="Shutdown required?"
          value={feeder.shutdownRequired}
          onChange={(v) => update({ shutdownRequired: v })}
          readOnly={readOnly}
        />

        <div className="flex flex-col gap-1.5">
          <Label>No. of DI Status Points</Label>
          <Input
            type="number" inputMode="numeric" disabled={readOnly}
            value={feeder.diStatusPoints ?? ''}
            onChange={(e) => update({
              diStatusPoints: e.target.value === '' ? null : Math.max(0, Number(e.target.value)),
            })}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label>No. of F-RTU / Remote-IO Modules Required</Label>
          <Input
            type="number" inputMode="numeric" disabled={readOnly}
            value={feeder.frtuModulesRequired ?? ''}
            onChange={(e) => update({
              frtuModulesRequired: e.target.value === '' ? null : Math.max(0, Number(e.target.value)),
            })}
          />
        </div>

        <PhotoCapture
          photos={feeder.photos}
          onChange={(photos) => update({ photos })}
          onReplacePhotoRef={onReplacePhotoRef}
          workOrderId={survey.workOrderId}
          siteCode={survey.siteCode}
          readOnly={readOnly}
          label="Photo of the bay / relay panel"
        />

        <div className="flex flex-col gap-1.5">
          <Label>Remarks</Label>
          <Textarea
            disabled={readOnly}
            value={feeder.remarks ?? ''}
            onChange={(e) => update({ remarks: e.target.value || null })}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-base font-semibold text-gray-900">Feeder List</h3>

      <div className="flex items-start gap-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
        <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
        <p className="text-xs text-amber-800">
          The MFM, CMR and F-RTU / Remote-IO counts entered here are summed straight into the
          BOQ step. Count per feeder carefully — these figures govern what gets supplied to
          the site once the BOQ is jointly signed.
        </p>
      </div>

      <RepeatableGroup<SurveyFeederEntry>
        entries={survey.feeders}
        onChange={(feeders) => onChange({ feeders })}
        createEntry={createFeeder}
        renderSummary={renderFeederSummary}
        renderForm={renderFeederForm}
        readOnly={readOnly}
        addLabel="Add Feeder"
        emptyText="No feeders added yet."
        entryNoun="feeder"
      />
    </div>
  );
}
