import { TriStateToggle } from '@/components/survey/TriStateToggle';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  DC_VOLTAGE_LABELS, VOLTAGE_LEVEL_LABELS,
  CABLE_LAYING_METHOD_LABELS, SLD_HANDOVER_FORMAT_LABELS,
  MATERIAL_STORAGE_LOCATION_LABELS,
} from '@/lib/surveyLabels';
import { SURVEY_VOLTAGE_LEVELS, LEGACY_COMBINED_VOLTAGE_LEVEL } from '@/types';
import { LegacyVoltageValueNote } from '@/components/survey/LegacyVoltageNote';
import type { SurveyStepProps } from './StepProps';
import type {
  SurveyInfrastructure, SurveySiteChecklist, SurveyCommunicationEquipment,
  SurveyAcDcSupply, SurveySldDetails, SurveyEarthingDetails,
  SurveyStorageDetails, SurveyDcVoltage,
  CableLayingMethod, SldHandoverFormat, MaterialStorageLocation,
} from '@/types';

// One step, TWO type structures: the official checklist's table 2
// (survey.siteChecklist) and the retained pre-rebuild survey.infrastructure.
// They stay separate in the document; combining them on screen is deliberate —
// two adjacent near-identical screens is worse for a surveyor than one.
//
// SUPERSEDED — the new field is rendered, the old one is left in the type,
// unused, deliberately NOT deleted:
//   infrastructure.civilWork[]                 -> siteChecklist.outdoorCivilWorkStatus
//   infrastructure.earthingAvailable           -> siteChecklist.earthing.*
//   infrastructure.dcVoltages/dcSupplyAvailable-> siteChecklist.acDcSupply.dcBreakerVoltageByLevel
//   infrastructure.acSupplyAvailable           -> siteChecklist.acDcSupply.ac230vAvailable
//
// The five checklist sections below now follow the document's own tables row
// for row. The four "unlabelled rows" noted in Phase 1 are resolved — the
// revision behind this reconciliation names them, and each has a field.
//
// The RETAINED infrastructure blocks (Existing Network Readiness, Install
// Location, spare MCBs / DCDB location) are deliberately NOT part of that
// reconciliation: they were kept separate from the official checklist on
// purpose and no target table covers them, so they are left exactly as they
// are rather than retired for absence from tables that never claimed them.

const DC_UNSPECIFIED = 'unspecified';

/**
 * Fallback for a nested group a stale local draft may not have at all.
 *
 * A draft saved before siteChecklist.acDcSupply existed restores without it,
 * and the shallow merge keeps the gap — so every read below would throw. The
 * draft-restore path now normalises, but this makes the component safe against
 * ANY caller, which is the guarantee worth having in a step that a field
 * expert reaches mid-survey.
 */
const EMPTY_AC_DC: SurveyAcDcSupply = {
  ac230vAvailable:         null,
  dcBreakerVoltageByLevel: {} as SurveyAcDcSupply['dcBreakerVoltageByLevel'],
  distanceToAcdbM:         null,
  distanceToDcdbM:         null,
};

/**
 * One answer to a checklist question this step no longer asks.
 *
 * Grey, not amber, and worded as a statement: there is nowhere to re-enter
 * these, so they are historical context rather than an outstanding action —
 * the same treatment relay Protocol / IP got. Renders nothing when the survey
 * holds no value, which is every survey answered since the reconciliation.
 */
function RemovedAnswerNote({
  label, value,
}: {
  label: string;
  value: string | number | boolean | null | undefined;
}) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && value.trim() === '') return null;

  return (
    <p className="rounded border border-gray-200 bg-gray-50 px-2 py-1.5 text-xs text-gray-600">
      Previously recorded, no longer collected — <strong>{label}</strong>:{' '}
      <strong>{typeof value === 'boolean' ? (value ? 'Yes' : 'No') : String(value)}</strong>.
      Kept for reference only.
    </p>
  );
}

/** Blank clears to null, never 0 — an unmeasured distance is not zero metres. */
function toMetres(raw: string): number | null {
  return raw === '' ? null : Math.max(0, Number(raw));
}

/** Panel, power, comms & site checklist — no repeatable groups on this step. */
export function StepInfrastructure({ survey, onChange, readOnly }: SurveyStepProps) {
  const infra     = survey.infrastructure;
  const checklist = survey.siteChecklist;
  const acDc      = checklist.acDcSupply ?? EMPTY_AC_DC;

  function patchInfra(patch: Partial<SurveyInfrastructure>) {
    onChange({ infrastructure: { ...infra, ...patch } });
  }
  function patchChecklist(patch: Partial<SurveySiteChecklist>) {
    onChange({ siteChecklist: { ...checklist, ...patch } });
  }
  // Each nested group spreads its own current value, so a partial edit never
  // drops a sibling field.
  function patchComms(patch: Partial<SurveyCommunicationEquipment>) {
    patchChecklist({ communication: { ...(checklist.communication ?? {}), ...patch } } as Partial<SurveySiteChecklist>);
  }
  function patchAcDc(patch: Partial<SurveyAcDcSupply>) {
    patchChecklist({ acDcSupply: { ...acDc, ...patch } });
  }
  function patchSld(patch: Partial<SurveySldDetails>) {
    patchChecklist({ sld: { ...(checklist.sld ?? {}), ...patch } } as Partial<SurveySiteChecklist>);
  }
  function patchEarthing(patch: Partial<SurveyEarthingDetails>) {
    patchChecklist({ earthing: { ...(checklist.earthing ?? {}), ...patch } } as Partial<SurveySiteChecklist>);
  }
  function patchStorage(patch: Partial<SurveyStorageDetails>) {
    patchChecklist({ storage: { ...(checklist.storage ?? {}), ...patch } } as Partial<SurveySiteChecklist>);
  }

  return (
    <div className="flex flex-col gap-6">
      <h3 className="text-base font-semibold text-gray-900">Site Infrastructure &amp; Checklist</h3>

      {/* ── Communication equipment Details ──────────────────────────────── */}
      <div className="flex flex-col gap-3">
        <h4 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
          Communication Equipment Details
        </h4>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="distToRtu">
            Distance between proposed Network panel location and MSETCL communication panel (m)
          </Label>
          <Input
            id="distToRtu"
            type="number" inputMode="decimal" disabled={readOnly}
            value={checklist.communication?.distanceToProposedRtuLocationM ?? ''}
            onChange={(e) => patchComms({ distanceToProposedRtuLocationM: toMetres(e.target.value) })}
          />
        </div>

        {/* Free text despite the named options — the document's own third
            option is "Other", so the set is open. */}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="channelType">Type of communication availability</Label>
          <Input
            id="channelType"
            disabled={readOnly}
            placeholder="FOTE / VSAT / other"
            value={checklist.communication?.channelType ?? ''}
            onChange={(e) => patchComms({ channelType: e.target.value || null })}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="cableLaying">Communication cable will lay through</Label>
          <Select
            disabled={readOnly}
            value={checklist.communication?.cableLayingMethod ?? undefined}
            onValueChange={(v) => patchComms({ cableLayingMethod: v as CableLayingMethod })}
          >
            <SelectTrigger id="cableLaying"><SelectValue placeholder="Select…" /></SelectTrigger>
            <SelectContent>
              {(Object.keys(CABLE_LAYING_METHOD_LABELS) as CableLayingMethod[]).map((m) => (
                <SelectItem key={m} value={m}>{CABLE_LAYING_METHOD_LABELS[m]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {/* The superseded yes/no, where a survey still holds one. Never
              converted — "a route exists" says nothing about trench vs wall. */}
          <RemovedAnswerNote
            label="Cable route already exists for the communication cable"
            value={checklist.communication?.cableRouteExists}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="baySwitchToRtu">Bay switch to RTU (Network panel) distance run (m)</Label>
          <Input
            id="baySwitchToRtu"
            type="number" inputMode="decimal" disabled={readOnly}
            value={checklist.communication?.baySwitchToRtuDistanceM ?? ''}
            onChange={(e) => patchComms({ baySwitchToRtuDistanceM: toMetres(e.target.value) })}
          />
        </div>

        <RemovedAnswerNote label="Channel make" value={checklist.communication?.channelMake} />
        <RemovedAnswerNote label="Outdoor civil work status" value={checklist.outdoorCivilWorkStatus} />
      </div>

      {/* ── Power supply ─────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3 pt-4 border-t border-gray-100">
        <h4 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
          Station AC &amp; DC Supply Details
        </h4>

        <TriStateToggle
          label="230V AC for utilities available?"
          value={acDc.ac230vAvailable}
          onChange={(v) => patchAcDc({ ac230vAvailable: v })}
          readOnly={readOnly}
        />

        <div className="flex flex-col gap-1.5">
          <Label>DC operational voltage for breaker, per voltage level</Label>
          {/* One value PER LEVEL, replacing the old single shared multi-select.
              Driven by SURVEY_VOLTAGE_LEVELS so adding a level is a one-place
              change, never a new hard-coded control here. */}
          <div className="grid grid-cols-2 gap-3">
            {SURVEY_VOLTAGE_LEVELS.map((level) => (
              <div key={level} className="flex flex-col gap-1">
                <Label htmlFor={`dcBreaker-${level}`} className="text-xs font-normal text-gray-500">
                  {VOLTAGE_LEVEL_LABELS[level]}
                </Label>
                <Select
                  disabled={readOnly}
                  value={acDc.dcBreakerVoltageByLevel?.[level] ?? DC_UNSPECIFIED}
                  onValueChange={(v) => patchAcDc({
                    dcBreakerVoltageByLevel: {
                      ...(acDc.dcBreakerVoltageByLevel ?? {}),
                      [level]: v === DC_UNSPECIFIED ? null : (v as SurveyDcVoltage),
                    },
                  })}
                >
                  <SelectTrigger id={`dcBreaker-${level}`}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={DC_UNSPECIFIED}>Not answered</SelectItem>
                    {(Object.keys(DC_VOLTAGE_LABELS) as SurveyDcVoltage[]).map((v) => (
                      <SelectItem key={v} value={v}>{DC_VOLTAGE_LABELS[v]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>
        </div>

        {/* A pre-split DC breaker voltage is still stored under the combined
            key and has no picker of its own — surface it for re-entry. */}
        <LegacyVoltageValueNote
          value={acDc.dcBreakerVoltageByLevel?.[LEGACY_COMBINED_VOLTAGE_LEVEL] ?? null}
        />

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="distAcdb">
              Distance between proposed Network panel and ACDB (m)
            </Label>
            <Input
              id="distAcdb"
              type="number" inputMode="decimal" disabled={readOnly}
              value={acDc.distanceToAcdbM ?? ''}
              onChange={(e) => patchAcDc({ distanceToAcdbM: toMetres(e.target.value) })}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="distDcdb">
              Distance between proposed Network panel and DCDB (m)
            </Label>
            <Input
              id="distDcdb"
              type="number" inputMode="decimal" disabled={readOnly}
              value={acDc.distanceToDcdbM ?? ''}
              onChange={(e) => patchAcDc({ distanceToDcdbM: toMetres(e.target.value) })}
            />
          </div>
        </div>

        {/* Retained from the pre-rebuild shape — nothing in the checklist
            replaces either of these. See the report. */}
        <TriStateToggle
          label="Spare MCBs / feeders for the new equipment"
          value={infra.spareMcbs}
          onChange={(v) => patchInfra({ spareMcbs: v })}
          readOnly={readOnly}
        />
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="dcdbLocation">DCDB / distribution location</Label>
          <Input
            id="dcdbLocation"
            disabled={readOnly}
            value={infra.dcdbLocation ?? ''}
            onChange={(e) => patchInfra({ dcdbLocation: e.target.value || null })}
          />
        </div>
      </div>

      {/* ── Existing network readiness (retained infrastructure block) ───── */}
      <div className="flex flex-col gap-3 pt-4 border-t border-gray-100">
        <h4 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
          Existing Network Readiness
        </h4>
        <p className="text-xs text-gray-400">
          What the substation already has for connectivity — distinct from the physical cable
          route recorded above.
        </p>

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
          <Label htmlFor="sldcPath">Path / readiness for link to SLDC &amp; ALDC (substation-end)</Label>
          <Textarea
            id="sldcPath"
            disabled={readOnly}
            value={infra.sldcPathNotes ?? ''}
            onChange={(e) => patchInfra({ sldcPathNotes: e.target.value || null })}
          />
        </div>
      </div>

      {/* ── Single Line Diagram Details ──────────────────────────────────── */}
      <div className="flex flex-col gap-3 pt-4 border-t border-gray-100">
        <h4 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
          Single Line Diagram Details
        </h4>

        <TriStateToggle
          label="Single Line Diagram available at substation?"
          value={checklist.sld?.sldDrawnAndConfirmed}
          onChange={(v) => patchSld({ sldDrawnAndConfirmed: v })}
          readOnly={readOnly}
        />
        <TriStateToggle
          label="SLD shows all existing bays as well as future bays?"
          value={checklist.sld?.sldShowsExistingAndFutureBays}
          onChange={(v) => patchSld({ sldShowsExistingAndFutureBays: v })}
          readOnly={readOnly}
        />
        <TriStateToggle
          label="Breakers, CTs, PTs, LAs, reactors, capacitor banks, isolators, earth switches and bus couplers shown in SLD?"
          value={checklist.sld?.allEquipmentTypesShownOnSld}
          onChange={(v) => patchSld({ allEquipmentTypesShownOnSld: v })}
          readOnly={readOnly}
        />

        {/* Three states, not a yes/no: the document asks WHICH format was
            handed over, and "not handed over" is the third answer. */}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="sldHandover">SLD handed over to surveyor</Label>
          <Select
            disabled={readOnly}
            value={checklist.sld?.sldHandoverFormat ?? undefined}
            onValueChange={(v) => patchSld({ sldHandoverFormat: v as SldHandoverFormat })}
          >
            <SelectTrigger id="sldHandover"><SelectValue placeholder="Select…" /></SelectTrigger>
            <SelectContent>
              {(Object.keys(SLD_HANDOVER_FORMAT_LABELS) as SldHandoverFormat[]).map((f) => (
                <SelectItem key={f} value={f}>{SLD_HANDOVER_FORMAT_LABELS[f]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* ── Substation Earthing Details ──────────────────────────────────── */}
      <div className="flex flex-col gap-3 pt-4 border-t border-gray-100">
        <h4 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
          Substation Earthing Details
        </h4>

        <TriStateToggle
          label="Is the earth mat strip extended to the control room?"
          value={checklist.earthing?.matExtendedToControlRoom}
          onChange={(v) => patchEarthing({ matExtendedToControlRoom: v })}
          readOnly={readOnly}
        />
        <TriStateToggle
          label="Is the earth mat intact?"
          value={checklist.earthing?.matIntact}
          onChange={(v) => patchEarthing({ matIntact: v })}
          readOnly={readOnly}
        />
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="distEarthStrip">
            Distance between proposed Network panel and associated equipment to earth strip (m)
          </Label>
          <Input
            id="distEarthStrip"
            type="number" inputMode="decimal" disabled={readOnly}
            value={checklist.earthing?.distanceToEarthStripM ?? ''}
            onChange={(e) => patchEarthing({ distanceToEarthStripM: toMetres(e.target.value) })}
          />
        </div>

        <RemovedAnswerNote
          label="Lightning protection extended to the control room"
          value={checklist.lightningProtectionToControlRoom}
        />
      </div>

      {/* ── Install location — where the new equipment goes permanently ──── */}
      <div className="flex flex-col gap-3 pt-4 border-t border-gray-100">
        <h4 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
          Install Location for New Equipment
        </h4>
        <p className="text-xs text-gray-400">
          Where the new panel and RTU are permanently mounted. Not the same as the temporary
          storage area below.
        </p>

        <TriStateToggle
          label="Panel space available?"
          value={infra.panelSpaceAvailable}
          onChange={(v) => patchInfra({ panelSpaceAvailable: v })}
          readOnly={readOnly}
        />
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="panelSpaceMeasurement">
            Space available for new networking panel and RTU (measure)
          </Label>
          <Input
            id="panelSpaceMeasurement"
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
          <Label htmlFor="mountingNotes">Mounting arrangement / rack space</Label>
          <Textarea
            id="mountingNotes"
            disabled={readOnly}
            value={infra.mountingNotes ?? ''}
            onChange={(e) => patchInfra({ mountingNotes: e.target.value || null })}
          />
        </div>
      </div>

      {/* ── Space Availability for storage ───────────────────────────────── */}
      <div className="flex flex-col gap-3 pt-4 border-t border-gray-100">
        <h4 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
          Space Availability for Storage
        </h4>
        <p className="text-xs text-gray-400">
          Where material can be unloaded and held before installation — the document treats this
          separately from the install location above.
        </p>

        <TriStateToggle
          label="Access to storage site?"
          value={checklist.storage?.siteAccessAvailable}
          onChange={(v) => patchStorage({ siteAccessAvailable: v })}
          readOnly={readOnly}
        />
        <TriStateToggle
          label="Space available for unloading at site?"
          value={checklist.storage?.spaceForUnloading}
          onChange={(v) => patchStorage({ spaceForUnloading: v })}
          readOnly={readOnly}
        />
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="materialStorage">Material will be stored at</Label>
          <Select
            disabled={readOnly}
            value={checklist.storage?.materialStorageLocation ?? undefined}
            onValueChange={(v) => patchStorage({ materialStorageLocation: v as MaterialStorageLocation })}
          >
            <SelectTrigger id="materialStorage"><SelectValue placeholder="Select…" /></SelectTrigger>
            <SelectContent>
              {(Object.keys(MATERIAL_STORAGE_LOCATION_LABELS) as MaterialStorageLocation[]).map((l) => (
                <SelectItem key={l} value={l}>{MATERIAL_STORAGE_LOCATION_LABELS[l]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <RemovedAnswerNote
          label="Storage space available for the RTU panel"
          value={checklist.storage?.storageSpaceForRtuPanel}
        />
        <RemovedAnswerNote
          label="Install space available for F-RTU / switch / MFM + CMR"
          value={checklist.storage?.installSpaceForFrtuSwitchMfmCmr}
        />
      </div>
    </div>
  );
}
