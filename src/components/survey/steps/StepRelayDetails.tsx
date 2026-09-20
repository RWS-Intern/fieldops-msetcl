import { RepeatableGroup } from '@/components/survey/RepeatableGroup';
import { PhotoCapture } from '@/components/survey/PhotoCapture';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { VOLTAGE_LEVEL_LABELS, RELAY_TYPE_LABELS } from '@/lib/surveyLabels';
import { SURVEY_VOLTAGE_LEVELS } from '@/types';
import { LegacyVoltageNote, LegacyRelayNote } from '@/components/survey/LegacyVoltageNote';
import type { SurveyStepProps } from './StepProps';
import type {
  SurveyRelayEntry, SurveyVoltageLevel, SurveyRelayType,
} from '@/types';

function createRelay(): SurveyRelayEntry {
  return {
    uid:            crypto.randomUUID(),
    bayName:        '',
    nominalVoltage: null,
    relayMakeModel: null,
    relayType:      null,
    // Superseded — seeded null and never written again, so a new relay can
    // never acquire one. Present only so old entries keep their answer.
    protocol:       null,
    ipAddress:      null,
    optical:        null,
    ctRatio:        null,
    remarks:        null,
    photos:         [],
  };
}

function renderRelaySummary(relay: SurveyRelayEntry, index: number) {
  const label = relay.bayName.trim() || `Relay #${index + 1}`;
  const typeLabel = relay.relayType ? RELAY_TYPE_LABELS[relay.relayType] : '—';
  const makeModel = relay.relayMakeModel?.trim();

  return (
    <>
      <span className="font-semibold text-gray-900">{label}</span>
      <span className="text-gray-400">
        {' '}· {typeLabel}{makeModel ? ` · ${makeModel}` : ''}
      </span>
    </>
  );
}

/** CRP Relay Details — Step 3, repeatable. Replaces the old Devices step. */
export function StepRelayDetails({ survey, onChange, readOnly, onReplacePhotoRef }: SurveyStepProps) {
  function renderRelayForm(
    relay: SurveyRelayEntry,
    update: (patch: Partial<SurveyRelayEntry>) => void,
  ) {
    return (
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>Bay Name</Label>
            <Input
              disabled={readOnly}
              value={relay.bayName}
              onChange={(e) => update({ bayName: e.target.value })}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Nominal Voltage</Label>
            <Select
              disabled={readOnly}
              value={relay.nominalVoltage ?? undefined}
              onValueChange={(v) => update({ nominalVoltage: v as SurveyVoltageLevel })}
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
            <LegacyVoltageNote level={relay.nominalVoltage} />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label>Relay Make / Model</Label>
          <Input
            disabled={readOnly}
            value={relay.relayMakeModel ?? ''}
            onChange={(e) => update({ relayMakeModel: e.target.value || null })}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>Relay Type</Label>
            <Select
              disabled={readOnly}
              value={relay.relayType ?? undefined}
              onValueChange={(v) => update({ relayType: v as SurveyRelayType })}
            >
              <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
              <SelectContent>
                {(Object.keys(RELAY_TYPE_LABELS) as SurveyRelayType[]).map((t) => (
                  <SelectItem key={t} value={t}>{RELAY_TYPE_LABELS[t]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {/*
            Free text, not a yes/no toggle: unconfirmed against the source
            document (Phase 1 decision 3). Text holds either answer — a tick
            or a description — so nothing is lost while it stays unconfirmed.
          */}
          <div className="flex flex-col gap-1.5">
            <Label>Optical</Label>
            <Input
              disabled={readOnly}
              value={relay.optical ?? ''}
              onChange={(e) => update({ optical: e.target.value || null })}
            />
          </div>
        </div>

        {/* Protocol and IP Address used to sit here. Shown back read-only
            where a relay still holds them — there is no field to re-enter
            them into, so this is reference, not an outstanding action. */}
        <LegacyRelayNote protocol={relay.protocol} ipAddress={relay.ipAddress} />

        <div className="flex flex-col gap-1.5">
          <Label>CT Ratio</Label>
          <Input
            disabled={readOnly}
            value={relay.ctRatio ?? ''}
            onChange={(e) => update({ ctRatio: e.target.value || null })}
          />
        </div>

        <PhotoCapture
          photos={relay.photos}
          onChange={(photos) => update({ photos })}
          onReplacePhotoRef={onReplacePhotoRef}
          workOrderId={survey.workOrderId}
          siteCode={survey.siteCode}
          readOnly={readOnly}
          label="Photo of the relay / CRP panel"
        />

        <div className="flex flex-col gap-1.5">
          <Label>Remarks</Label>
          <Textarea
            disabled={readOnly}
            value={relay.remarks ?? ''}
            onChange={(e) => update({ remarks: e.target.value || null })}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-base font-semibold text-gray-900">CRP Relay Details</h3>

      <RepeatableGroup<SurveyRelayEntry>
        entries={survey.relays}
        onChange={(relays) => onChange({ relays })}
        createEntry={createRelay}
        renderSummary={renderRelaySummary}
        renderForm={renderRelayForm}
        readOnly={readOnly}
        addLabel="Add Relay"
        emptyText="No relays added yet."
        entryNoun="relay"
      />
    </div>
  );
}
