import { TriStateToggle } from '@/components/survey/TriStateToggle';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { DC_VOLTAGE_LABELS, VOLTAGE_LEVEL_LABELS } from '@/lib/surveyLabels';
import { SURVEY_VOLTAGE_LEVELS, LEGACY_COMBINED_VOLTAGE_LEVEL } from '@/types';
import { LegacyVoltageValueNote } from '@/components/survey/LegacyVoltageNote';
import type { SurveyStepProps } from './StepProps';
import type {
  SurveyInfrastructure, SurveySiteChecklist, SurveyCommunicationEquipment,
  SurveyAcDcSupply, SurveySldDetails, SurveyEarthingDetails,
  SurveyStorageDetails, SurveyDcVoltage,
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
// NOT rendered at all: the four unlabelled rows under the document's
// Communication Equipment Details table. They have no heading text in the
// source, and inventing plausible-sounding labels for a government document
// would be worse than omitting them (Phase 1 decision).

const DC_UNSPECIFIED = 'unspecified';

/** Blank clears to null, never 0 — an unmeasured distance is not zero metres. */
function toMetres(raw: string): number | null {
  return raw === '' ? null : Math.max(0, Number(raw));
}

/** Panel, power, comms & site checklist — no repeatable groups on this step. */
export function StepInfrastructure({ survey, onChange, readOnly }: SurveyStepProps) {
  const infra     = survey.infrastructure;
  const checklist = survey.siteChecklist;

  function patchInfra(patch: Partial<SurveyInfrastructure>) {
    onChange({ infrastructure: { ...infra, ...patch } });
  }
  function patchChecklist(patch: Partial<SurveySiteChecklist>) {
    onChange({ siteChecklist: { ...checklist, ...patch } });
  }
  // Each nested group spreads its own current value, so a partial edit never
  // drops a sibling field.
  function patchComms(patch: Partial<SurveyCommunicationEquipment>) {
    patchChecklist({ communication: { ...checklist.communication, ...patch } });
  }
  function patchAcDc(patch: Partial<SurveyAcDcSupply>) {
    patchChecklist({ acDcSupply: { ...checklist.acDcSupply, ...patch } });
  }
  function patchSld(patch: Partial<SurveySldDetails>) {
    patchChecklist({ sld: { ...checklist.sld, ...patch } });
  }
  function patchEarthing(patch: Partial<SurveyEarthingDetails>) {
    patchChecklist({ earthing: { ...checklist.earthing, ...patch } });
  }
  function patchStorage(patch: Partial<SurveyStorageDetails>) {
    patchChecklist({ storage: { ...checklist.storage, ...patch } });
  }

  return (
    <div className="flex flex-col gap-6">
      <h3 className="text-base font-semibold text-gray-900">Site Infrastructure &amp; Checklist</h3>

      {/* ── Civil work & communication equipment ─────────────────────────── */}
      <div className="flex flex-col gap-3">
        <h4 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
          Outdoor Civil Work &amp; Communication
        </h4>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="outdoorCivilWork">Outdoor civil work status</Label>
          {/* Free text, not an enum: the document's own wording for the
              options is unknown, and inventing a status vocabulary would be
              the same mistake as inventing the unlabelled rows. */}
          <Textarea
            id="outdoorCivilWork"
            disabled={readOnly}
            value={checklist.outdoorCivilWorkStatus ?? ''}
            onChange={(e) => patchChecklist({ outdoorCivilWorkStatus: e.target.value || null })}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="distToRtu">Distance to proposed RTU location (m)</Label>
          <Input
            id="distToRtu"
            type="number" inputMode="decimal" disabled={readOnly}
            value={checklist.communication.distanceToProposedRtuLocationM ?? ''}
            onChange={(e) => patchComms({ distanceToProposedRtuLocationM: toMetres(e.target.value) })}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="channelType">Channel type</Label>
            <Input
              id="channelType"
              disabled={readOnly}
              value={checklist.communication.channelType ?? ''}
              onChange={(e) => patchComms({ channelType: e.target.value || null })}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="channelMake">Channel make</Label>
            <Input
              id="channelMake"
              disabled={readOnly}
              value={checklist.communication.channelMake ?? ''}
              onChange={(e) => patchComms({ channelMake: e.target.value || null })}
            />
          </div>
        </div>

        <TriStateToggle
          label="Cable route already exists for the communication cable?"
          value={checklist.communication.cableRouteExists}
          onChange={(v) => patchComms({ cableRouteExists: v })}
          readOnly={readOnly}
        />
      </div>

      {/* ── Power supply ─────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3 pt-4 border-t border-gray-100">
        <h4 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
          AC / DC Supply
        </h4>

        <TriStateToggle
          label="230V AC supply available?"
          value={checklist.acDcSupply.ac230vAvailable}
          onChange={(v) => patchAcDc({ ac230vAvailable: v })}
          readOnly={readOnly}
        />

        <div className="flex flex-col gap-1.5">
          <Label>DC breaker voltage, per voltage level</Label>
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
                  value={checklist.acDcSupply.dcBreakerVoltageByLevel[level] ?? DC_UNSPECIFIED}
                  onValueChange={(v) => patchAcDc({
                    dcBreakerVoltageByLevel: {
                      ...checklist.acDcSupply.dcBreakerVoltageByLevel,
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
          value={checklist.acDcSupply.dcBreakerVoltageByLevel[LEGACY_COMBINED_VOLTAGE_LEVEL]}
        />

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="distAcdb">Distance to ACDB (m)</Label>
            <Input
              id="distAcdb"
              type="number" inputMode="decimal" disabled={readOnly}
              value={checklist.acDcSupply.distanceToAcdbM ?? ''}
              onChange={(e) => patchAcDc({ distanceToAcdbM: toMetres(e.target.value) })}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="distDcdb">Distance to DCDB (m)</Label>
            <Input
              id="distDcdb"
              type="number" inputMode="decimal" disabled={readOnly}
              value={checklist.acDcSupply.distanceToDcdbM ?? ''}
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

      {/* ── SLD, earthing & lightning protection ─────────────────────────── */}
      <div className="flex flex-col gap-3 pt-4 border-t border-gray-100">
        <h4 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
          SLD, Earthing &amp; Lightning Protection
        </h4>

        <TriStateToggle
          label="SLD drawn and confirmed?"
          value={checklist.sld.sldDrawnAndConfirmed}
          onChange={(v) => patchSld({ sldDrawnAndConfirmed: v })}
          readOnly={readOnly}
        />
        <TriStateToggle
          label="All equipment types shown on the SLD?"
          value={checklist.sld.allEquipmentTypesShownOnSld}
          onChange={(v) => patchSld({ allEquipmentTypesShownOnSld: v })}
          readOnly={readOnly}
        />
        <TriStateToggle
          label="Earthing mat extended to the control room?"
          value={checklist.earthing.matExtendedToControlRoom}
          onChange={(v) => patchEarthing({ matExtendedToControlRoom: v })}
          readOnly={readOnly}
        />
        <TriStateToggle
          label="Earthing mat intact?"
          value={checklist.earthing.matIntact}
          onChange={(v) => patchEarthing({ matIntact: v })}
          readOnly={readOnly}
        />
        <TriStateToggle
          label="Lightning protection extended to the control room?"
          value={checklist.lightningProtectionToControlRoom}
          onChange={(v) => patchChecklist({ lightningProtectionToControlRoom: v })}
          readOnly={readOnly}
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

      {/* ── Temporary storage — a different physical space ───────────────── */}
      <div className="flex flex-col gap-3 pt-4 border-t border-gray-100">
        <h4 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
          Temporary Storage / Holding Area
        </h4>
        <p className="text-xs text-gray-400">
          Where material can be unloaded and held before installation — the document treats this
          separately from the install location above.
        </p>

        <TriStateToggle
          label="Site access available?"
          value={checklist.storage.siteAccessAvailable}
          onChange={(v) => patchStorage({ siteAccessAvailable: v })}
          readOnly={readOnly}
        />
        <div className="flex flex-col gap-1">
          <TriStateToggle
            label="Storage space available for the RTU panel?"
            value={checklist.storage.storageSpaceForRtuPanel}
            onChange={(v) => patchStorage({ storageSpaceForRtuPanel: v })}
            readOnly={readOnly}
          />
          {/* A hint for the surveyor, deliberately not a validated dimension —
              the answer is a judgement about the actual room. */}
          <p className="text-xs text-gray-500">
            The RTU panel is approximately 1000 × 440 × 600 mm.
          </p>
        </div>
        <TriStateToggle
          label="Space available for unloading?"
          value={checklist.storage.spaceForUnloading}
          onChange={(v) => patchStorage({ spaceForUnloading: v })}
          readOnly={readOnly}
        />
        <TriStateToggle
          label="Install space available for F-RTU / switch / MFM + CMR?"
          value={checklist.storage.installSpaceForFrtuSwitchMfmCmr}
          onChange={(v) => patchStorage({ installSpaceForFrtuSwitchMfmCmr: v })}
          readOnly={readOnly}
        />
      </div>
    </div>
  );
}
