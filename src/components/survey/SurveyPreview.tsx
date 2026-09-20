import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { SUPPLY_BOQ_MASTER } from '@/lib/boqMaster';
import { SURVEY_PHOTO_SLOTS, validateSurvey } from '@/lib/surveyValidation';
import { formatMetresAsKm } from '@/lib/units';
import {
  VOLTAGE_LEVEL_LABELS, ASSET_COUNT_ROWS, ASSET_COUNT_ROW_LABELS,
  RELAY_TYPE_LABELS, PROTOCOL_LABELS,
  CAPACITOR_CONTROL_TYPE_LABELS, TRAYS_LABELS,
  DC_VOLTAGE_LABELS, MCB_POLE_TYPE_LABELS, BOQ_CHECK_LABELS, storedVoltageLabel,
  LEGACY_COMBINED_VOLTAGE_LABEL,
} from '@/lib/surveyLabels';
import { SurveyPhotoThumb } from './SurveyPhotoThumb';
import { SignaturePad } from './SignaturePad';
import {
  SURVEY_VOLTAGE_LEVELS, LEGACY_COMBINED_VOLTAGE_LEVEL,
} from '@/types';
import type { BoqMasterItem } from '@/lib/boqMaster';
import type {
  SurveyReport, SurveyFeederEntry, SurveyRelayEntry, SurveyTransformerEntry,
  SurveyCapacitorBank, SurveyCableRun, SurveyInfrastructure, SurveyBoqLine,
  SurveySignOff, SurveyContactDetails, SurveyControlRoom, SurveyAssetCounts,
  SurveySiteChecklist, SurveyAcdcMcbDetails, AcdcMcbBoardDetail, McbSlot, McbPoleType,
} from '@/types';

// Every enum label and checklist wording comes from src/lib/surveyLabels.ts —
// the single source shared with the step components. Nothing is redefined
// here: a preview whose wording differs from the form it previews is a
// correctness problem on a document an MSETCL engineer signs. BOQ item names
// and photo slot names come from their own shared homes (boqMaster.ts /
// surveyValidation.ts), imported above.
//
// Every section below now matches the rebuilt shapes and, section for section,
// what the wizard step actually writes. The BOQ confirmation checks and
// Sign-Off render unchanged types (SurveyBoqChecks / SurveySignOff), which the
// rebuild never altered — those are current, not pending.

// ─── Small presentational primitives ───────────────────────────────────────────

function dash(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string' && !value.trim()) return '—';
  return String(value);
}

function Field({ label, value, flag }: { label: string; value: string; flag?: string | null }) {
  return (
    <div className="flex flex-col gap-0.5 min-w-0 break-inside-avoid">
      <span className="text-[10px] uppercase tracking-wide text-gray-400">{label}</span>
      <span className="text-sm text-gray-800">{value}</span>
      {flag && <span className="text-xs text-amber-600">⚠ {flag}</span>}
    </div>
  );
}

function TriField({ label, value }: { label: string; value: boolean | null }) {
  return (
    <div className="flex items-center justify-between gap-2 py-1 break-inside-avoid">
      <span className="text-sm text-gray-700">{label}</span>
      <span
        className={cn(
          'text-xs font-semibold px-2 py-0.5 rounded-full shrink-0',
          value === true ? 'bg-green-50 text-green-700' : value === false ? 'bg-red-50 text-red-700' : 'bg-gray-100 text-gray-400',
        )}
      >
        {value === true ? 'Yes' : value === false ? 'No' : 'Not answered'}
      </span>
    </div>
  );
}

function TickField({ label, checked }: { label: string; checked: boolean }) {
  return (
    <div className="flex items-start gap-2 py-1 break-inside-avoid">
      <span className={cn('text-sm font-bold shrink-0', checked ? 'text-green-600' : 'text-red-500')}>
        {checked ? '✓' : '✗'}
      </span>
      <span className="text-sm text-gray-700">{label}</span>
    </div>
  );
}

function SectionHeading({ children }: { children: ReactNode }) {
  return (
    <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wide border-b border-gray-300 pb-1">
      {children}
    </h3>
  );
}

function SubHeading({ children }: { children: ReactNode }) {
  return <h4 className="text-xs font-bold text-gray-500 uppercase">{children}</h4>;
}

function PhotoGrid({ refs }: { refs: string[] }) {
  if (refs.length === 0) {
    return <p className="text-xs text-gray-400 italic">No photos.</p>;
  }
  return (
    <div className="flex flex-wrap gap-2">
      {refs.map((ref) => (
        <div key={ref} className="h-20 w-20 rounded-lg overflow-hidden border border-gray-200 shrink-0 break-inside-avoid">
          <SurveyPhotoThumb reference={ref} className="h-full w-full" />
        </div>
      ))}
    </div>
  );
}

/** Shared shell for one entry of a repeatable group. */
function EntryCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 p-3 rounded-lg border border-gray-200 break-inside-avoid">
      <p className="text-sm font-bold text-gray-900">{title}</p>
      {children}
    </div>
  );
}

function voltageLabel(level: SurveyFeederEntry['nominalVoltage']): string {
  // storedVoltageLabel, not VOLTAGE_LEVEL_LABELS: a value read from a document
  // may be the pre-split combined one, which has no entry in the picker map.
  return level ? storedVoltageLabel(level) : '—';
}

// ─── Site & Visit ──────────────────────────────────────────────────────────────

function ContactDetailsBlock({ contact }: { contact: SurveyContactDetails }) {
  return (
    <div className="flex flex-col gap-1">
      <SubHeading>Contact Details</SubHeading>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Name of the Substation In-charge" value={dash(contact.substationInchargeName)} />
        <Field label="Substation In-charge Contact Details" value={dash(contact.substationInchargePhone)} />
        <Field label="Substation Email ID" value={dash(contact.email)} />
        <Field label="Substation contact no" value={dash(contact.substationContactNo)} />
        <Field label="Substation Telephone — Landline" value={dash(contact.substationLandline)} />
        <Field label="Substation Telephone — VOIP" value={dash(contact.substationVoip)} />
        <Field label="Zone" value={dash(contact.zoneName)} />
        <Field label="Circle" value={dash(contact.circle)} />
        <Field label="Division" value={dash(contact.division)} />
        <Field label="Division contact No." value={dash(contact.divisionContactNo)} />
        <Field
          label="Commissioned Date"
          value={contact.commissionedDate ? contact.commissionedDate.toLocaleDateString() : '—'}
        />
        <Field label="Nearest Railway Station / Landmark" value={dash(contact.nearestRailwayStationOrLandmark)} />
      </div>
      <Field label="Contact Details of Shift Operators" value={dash(contact.shiftOperatorContacts)} />
      <Field label="Address" value={dash(contact.address)} />
      <Field label="Substation PIN code" value={dash(contact.pinCode)} />
    </div>
  );
}

function ControlRoomBlock({ controlRoom }: { controlRoom: SurveyControlRoom }) {
  return (
    <div className="flex flex-col gap-1">
      <SubHeading>Control Room Details</SubHeading>
      <Field label="Control room layout notes" value={dash(controlRoom.layoutNotes)} />
      <div className="grid grid-cols-2 gap-2">
        <Field label="Room Temperature" value={dash(controlRoom.roomTemperature)} />
        <Field
          label="Mounting Structure / Existing RTU Panel Dimensions"
          value={dash(controlRoom.mountingStructureOrRtuPanelDimensions)}
        />
      </div>
      <TriField label="AC available" value={controlRoom.acAvailable} />
      {controlRoom.acAvailable === true && (
        <Field label="AC Condition" value={dash(controlRoom.acCondition)} />
      )}
      <TriField label="Cable trench available" value={controlRoom.cableTrenchAvailable} />
      {controlRoom.cableTrenchAvailable === true && (
        <Field
          label="Cable Trench Length"
          value={controlRoom.cableTrenchLengthM != null ? `${controlRoom.cableTrenchLengthM} m` : '—'}
        />
      )}
      <TriField label="Trench extension needed" value={controlRoom.trenchExtensionNeeded} />
    </div>
  );
}

function AssetCountsBlock({
  counts, siteMaster,
}: {
  counts: SurveyAssetCounts;
  siteMaster?: { totalBays: number | null; numPowerTransformers: number | null } | null;
}) {
  // Sum of the levels actually answered — null until at least one is, so a
  // half-filled row never flags a misleadingly large discrepancy against the
  // site master. Same rule as the Site & Visit step's own hint.
  // Defensive on the record itself — see the note on the step's own copy.
  const sumAnswered = (record: Record<string, number | null> | undefined | null): number | null => {
    if (!record) return null;
    const answered = Object.values(record).filter((n): n is number => n != null);
    return answered.length > 0 ? answered.reduce((sum, n) => sum + n, 0) : null;
  };

  const totalBays = sumAnswered(counts.baysByVoltage);
  const totalTransformers = sumAnswered(counts.transformersByVoltage);

  const bayFlag =
    siteMaster?.totalBays != null && totalBays != null && siteMaster.totalBays !== totalBays
      ? `Site master says ${siteMaster.totalBays}`
      : null;
  const transformerFlag =
    siteMaster?.numPowerTransformers != null &&
    totalTransformers != null &&
    siteMaster.numPowerTransformers !== totalTransformers
      ? `Site master says ${siteMaster.numPowerTransformers}`
      : null;

  const legacyBays = counts.baysByVoltage?.[LEGACY_COMBINED_VOLTAGE_LEVEL] ?? null;

  return (
    <div className="flex flex-col gap-1">
      <SubHeading>Asset Counts</SubHeading>

      {/* The same 4 x 7 grid the step renders, read-only. Scrolls rather than
          wrapping, so the column-to-level alignment survives a narrow screen
          and a printed page. */}
      <div className="overflow-x-auto">
        <div className="min-w-[34rem]">
          <div className={ASSET_GRID_COLS}>
            <span className="text-[10px] uppercase tracking-wide text-gray-400">Asset</span>
            {SURVEY_VOLTAGE_LEVELS.map((level) => (
              <span key={level} className="text-center text-[10px] uppercase tracking-wide text-gray-400">
                {VOLTAGE_LEVEL_LABELS[level]}
              </span>
            ))}
          </div>
          {ASSET_COUNT_ROWS.map((row) => (
            <div key={row} className={`${ASSET_GRID_COLS} border-b border-gray-100 py-1`}>
              <span className="text-xs font-medium text-gray-600">{ASSET_COUNT_ROW_LABELS[row]}</span>
              {SURVEY_VOLTAGE_LEVELS.map((level) => (
                <span key={level} className="text-center text-xs text-gray-800">
                  {dash(counts[row]?.[level])}
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>

      <div className="mt-1 grid grid-cols-2 gap-2">
        <Field label="Total Bays (sum of answered levels)" value={dash(totalBays)} flag={bayFlag} />
        <Field label="Total Transformers (sum of answered levels)" value={dash(totalTransformers)} flag={transformerFlag} />
      </div>

      {/* Answers recorded before this section changed shape — shown so a
          reviewer knows they exist and have not yet been re-entered. */}
      {legacyBays != null && (
        <Field
          label={`Bays recorded before the split (${LEGACY_COMBINED_VOLTAGE_LABEL})`}
          value={String(legacyBays)}
          flag="Not yet re-entered against 66 kV or 33 kV"
        />
      )}
      {counts.transformerCount != null && (
        <Field label="Previously recorded total — transformers" value={String(counts.transformerCount)}
               flag="Not yet distributed across voltage levels" />
      )}
      {counts.busCount != null && (
        <Field label="Previously recorded total — buses" value={String(counts.busCount)}
               flag="Not yet distributed across voltage levels" />
      )}
      {counts.capacitorBankCount != null && (
        <Field label="Previously recorded total — capacitor banks" value={String(counts.capacitorBankCount)}
               flag="Not yet distributed across voltage levels" />
      )}
    </div>
  );
}

/** Column template shared by the asset grid's heading and data rows. */
const ASSET_GRID_COLS = 'grid grid-cols-[7rem_repeat(7,minmax(2.75rem,1fr))] items-center gap-1.5';

// ─── Repeatable groups ─────────────────────────────────────────────────────────

function FeederBlock({ feeder, index }: { feeder: SurveyFeederEntry; index: number }) {
  return (
    <EntryCard title={feeder.bayName.trim() || `Feeder #${index + 1}`}>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Nominal Voltage" value={voltageLabel(feeder.nominalVoltage)} />
        <Field label="Feeder / Transformer Description" value={dash(feeder.feederOrTransformerDescription)} />
        <Field
          label="Cable Trench Length"
          value={feeder.cableTrenchLengthM != null ? `${feeder.cableTrenchLengthM} m` : '—'}
        />
        <Field label="CT / PT Ratio" value={dash(feeder.ctPtRatio)} />
        <Field label="No. of DI Status Points" value={dash(feeder.diStatusPoints)} />
        <Field
          label="CAT6 Cable Length, FRTU to Bay Switch"
          value={feeder.cat6LengthFrtuToBaySwitchM != null ? `${feeder.cat6LengthFrtuToBaySwitchM} m` : '—'}
        />
        <Field label="MFM required" value={dash(feeder.mfmRequired)} />
        <Field label="CMR required" value={dash(feeder.cmrRequired)} />
        <Field label="No. of F-RTU / Remote-IO Modules Required" value={dash(feeder.frtuModulesRequired)} />
      </div>
      <TriField label="Panel space available" value={feeder.panelSpaceAvailable} />
      <TriField label="Existing MFM available" value={feeder.existingMfmAvailable} />
      <TriField label="Existing MFM working" value={feeder.existingMfmWorking} />
      {feeder.existingMfmAvailable === true && (
        <>
          <TriField label="Existing MFM RS485 available" value={feeder.existingMfmRs485Available} />
          <TriField label="Existing MFM RS485 working" value={feeder.existingMfmRs485Working} />
        </>
      )}
      {/* The pre-split combined answer, flagged rather than silently dropped,
          so a reviewer can see this feeder still needs re-entering. */}
      {feeder.existingMfmAvailableWorking != null && (
        <Field
          label="Previously recorded — MFM available &amp; working"
          value={feeder.existingMfmAvailableWorking ? 'Yes' : 'No'}
          flag="Not yet re-entered as two separate answers"
        />
      )}
      <TriField label="Space available in C&amp;R for FRTU" value={feeder.frtuSpaceAvailable} />
      <TriField label="Space available in C&amp;R panel to install CMRs" value={feeder.cmrSpaceAvailable} />
      <TriField label="Shutdown required" value={feeder.shutdownRequired} />
      <Field label="Remarks" value={dash(feeder.remarks)} />
      <PhotoGrid refs={feeder.photos} />
    </EntryCard>
  );
}

function RelayBlock({ relay, index }: { relay: SurveyRelayEntry; index: number }) {
  return (
    <EntryCard title={relay.bayName.trim() || `Relay #${index + 1}`}>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Nominal Voltage" value={voltageLabel(relay.nominalVoltage)} />
        <Field label="Relay Make / Model" value={dash(relay.relayMakeModel)} />
        <Field label="Relay Type" value={relay.relayType ? RELAY_TYPE_LABELS[relay.relayType] : '—'} />
        <Field label="Protocol" value={relay.protocol ? PROTOCOL_LABELS[relay.protocol] : '—'} />
        <Field label="IP Address" value={dash(relay.ipAddress)} />
        <Field label="Optical" value={dash(relay.optical)} />
        <Field label="CT Ratio" value={dash(relay.ctRatio)} />
      </div>
      <Field label="Remarks" value={dash(relay.remarks)} />
      <PhotoGrid refs={relay.photos} />
    </EntryCard>
  );
}

function CapacitorBankBlock({ bank, index }: { bank: SurveyCapacitorBank; index: number }) {
  return (
    <EntryCard title={bank.bankNumber.trim() || `Capacitor bank #${index + 1}`}>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Voltage Level" value={voltageLabel(bank.voltageLevel)} />
        <Field label="Number of Banks" value={dash(bank.numberOfBanks)} />
        <Field
          label="Control Type"
          value={bank.controlType ? CAPACITOR_CONTROL_TYPE_LABELS[bank.controlType] : '—'}
        />
        <Field label="Rating per Bank" value={dash(bank.ratingPerBank)} />
        <Field label="Working Status" value={dash(bank.workingStatus)} />
      </div>
      <Field label="Remarks" value={dash(bank.remarks)} />
    </EntryCard>
  );
}

function TransformerBlock({ tx, index }: { tx: SurveyTransformerEntry; index: number }) {
  return (
    <EntryCard title={tx.transformerNumber.trim() || `Transformer #${index + 1}`}>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Voltage Level" value={voltageLabel(tx.voltageLevel)} />
        <Field label="MVA Rating" value={dash(tx.mvaRating)} />
        <Field label="RTCC High Step" value={dash(tx.rtccHighStep)} />
        <Field label="RTCC Low Step" value={dash(tx.rtccLowStep)} />
        <Field label="Tap Position Connection Type" value={dash(tx.tapPositionConnectionType)} />
      </div>
      <TriField label="RTCC panel working" value={tx.rtccPanelWorking} />
      <TriField label="Existing TPT working" value={tx.existingTptWorking} />
      {tx.existingTptWorking === true && (
        <TriField label="Existing TPI 4-20 mA output available" value={tx.existingTpi4to20mAAvailable} />
      )}
      <TriField label="Tap Position Transducer (TPT) required" value={tx.tptRequired} />
      <Field label="No. of Required TPT" value={dash(tx.requiredTptCount)} />
      <Field label="Remarks" value={dash(tx.remarks)} />
    </EntryCard>
  );
}

// ─── Site infrastructure & checklist ──────────────────────────────────────────
//
// Mirrors StepInfrastructure.tsx's six sub-sections and reading split exactly —
// see the supersede/keep comment block at the top of that file. It renders TWO
// type structures as one section, because the step does.
//
// SUPERSEDED — the new field is previewed; the old one is NOT rendered at all,
// because the step no longer writes it, so it can only ever be stale:
//   infrastructure.civilWork[]                  -> siteChecklist.outdoorCivilWorkStatus
//   infrastructure.earthingAvailable            -> siteChecklist.earthing.*
//   infrastructure.dcVoltages/dcSupplyAvailable -> siteChecklist.acDcSupply.dcBreakerVoltageByLevel
//   infrastructure.acSupplyAvailable            -> siteChecklist.acDcSupply.ac230vAvailable
//
// KEPT from infrastructure, because the step still writes them and nothing in
// the checklist replaces them: spareMcbs, dcdbLocation, ofc/router/mpls/
// sldcPathNotes, panelSpace*.

function InfrastructureSection({
  infra, checklist,
}: {
  infra:     SurveyInfrastructure;
  checklist: SurveySiteChecklist;
}) {
  // Bound once so the truthiness check narrows it — a `?.` chain followed by
  // a non-null assertion is exactly the pattern the linter rejects.
  const legacyDcBreaker = checklist.acDcSupply?.dcBreakerVoltageByLevel?.[LEGACY_COMBINED_VOLTAGE_LEVEL] ?? null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <SubHeading>Outdoor Civil Work &amp; Communication</SubHeading>
        <Field label="Outdoor civil work status" value={dash(checklist.outdoorCivilWorkStatus)} />
        <div className="grid grid-cols-2 gap-2">
          <Field
            label="Distance to proposed RTU location"
            value={checklist.communication?.distanceToProposedRtuLocationM != null
              ? `${checklist.communication?.distanceToProposedRtuLocationM} m`
              : '—'}
          />
          <Field label="Channel type" value={dash(checklist.communication?.channelType)} />
          <Field label="Channel make" value={dash(checklist.communication?.channelMake)} />
        </div>
        <TriField
          label="Cable route already exists for the communication cable"
          value={checklist.communication?.cableRouteExists}
        />
      </div>

      <div className="flex flex-col gap-1">
        <SubHeading>AC / DC Supply</SubHeading>
        <TriField label="230V AC supply available" value={checklist.acDcSupply?.ac230vAvailable} />
        {/* Per voltage level, replacing the old single shared multi-select. */}
        <div className="grid grid-cols-2 gap-2">
          {SURVEY_VOLTAGE_LEVELS.map((level) => {
            const dc = checklist.acDcSupply?.dcBreakerVoltageByLevel?.[level];
            return (
              <Field
                key={level}
                label={`DC breaker voltage — ${VOLTAGE_LEVEL_LABELS[level]}`}
                value={dc ? DC_VOLTAGE_LABELS[dc] : '—'}
              />
            );
          })}
          {legacyDcBreaker && (
            <Field
              label={`DC breaker voltage before the split (${LEGACY_COMBINED_VOLTAGE_LABEL})`}
              value={DC_VOLTAGE_LABELS[legacyDcBreaker]}
              flag="Not yet re-entered against 66 kV or 33 kV"
            />
          )}
          <Field
            label="Distance to ACDB"
            value={checklist.acDcSupply?.distanceToAcdbM != null ? `${checklist.acDcSupply?.distanceToAcdbM} m` : '—'}
          />
          <Field
            label="Distance to DCDB"
            value={checklist.acDcSupply?.distanceToDcdbM != null ? `${checklist.acDcSupply?.distanceToDcdbM} m` : '—'}
          />
        </div>
        <TriField label="Spare MCBs / feeders" value={infra.spareMcbs} />
        <Field label="DCDB / distribution location" value={dash(infra.dcdbLocation)} />
      </div>

      <div className="flex flex-col gap-1">
        <SubHeading>Existing Network Readiness</SubHeading>
        <TriField label="OFC / Ethernet availability" value={infra.ofcAvailable} />
        <TriField label="Router available" value={infra.routerAvailable} />
        <TriField label="MPLS available" value={infra.mplsAvailable} />
        <Field label="SLDC / ALDC path notes" value={dash(infra.sldcPathNotes)} />
      </div>

      <div className="flex flex-col gap-1">
        <SubHeading>SLD, Earthing &amp; Lightning Protection</SubHeading>
        <TriField label="SLD drawn and confirmed" value={checklist.sld?.sldDrawnAndConfirmed} />
        <TriField label="All equipment types shown on the SLD" value={checklist.sld?.allEquipmentTypesShownOnSld} />
        <TriField label="Earthing mat extended to the control room" value={checklist.earthing?.matExtendedToControlRoom} />
        <TriField label="Earthing mat intact" value={checklist.earthing?.matIntact} />
        <TriField
          label="Lightning protection extended to the control room"
          value={checklist.lightningProtectionToControlRoom}
        />
      </div>

      {/* Two DIFFERENT physical spaces — the permanent install location and a
          temporary holding area. Kept visibly distinct here for the same
          reason the step does: a reviewer must not read them as duplicates. */}
      <div className="flex flex-col gap-1">
        <SubHeading>Install Location for New Equipment</SubHeading>
        <TriField label="Panel space available" value={infra.panelSpaceAvailable} />
        <Field label="Space available for new networking panel and RTU" value={dash(infra.panelSpaceMeasurement)} />
        <TriField label="New panel required" value={infra.newPanelRequired} />
        <Field label="Mounting arrangement / rack space" value={dash(infra.mountingNotes)} />
      </div>

      <div className="flex flex-col gap-1">
        <SubHeading>Temporary Storage / Holding Area</SubHeading>
        <TriField label="Site access available" value={checklist.storage?.siteAccessAvailable} />
        <TriField label="Storage space available for the RTU panel" value={checklist.storage?.storageSpaceForRtuPanel} />
        <TriField label="Space available for unloading" value={checklist.storage?.spaceForUnloading} />
        <TriField
          label="Install space available for F-RTU / switch / MFM + CMR"
          value={checklist.storage?.installSpaceForFrtuSwitchMfmCmr}
        />
      </div>
    </div>
  );
}

/** Column template shared by the board tables' heading and their two rows. */
const BOARD_GRID_COLS = 'grid grid-cols-[9rem_1fr_1fr_1.4fr] gap-2';

/** Fallback for a board a stale local draft predates — see the step's copy. */
const EMPTY_BOARD_PREVIEW: AcdcMcbBoardDetail = {
  spareMcbCount: null, spareMcbPole: null, spareMcbRating: null, spareMcbRemarks: null,
  mcbUtilisedForNetworkPanel: null, utilisedMcbPole: null,
  utilisedMcbRating: null, utilisedMcbRemarks: null,
};

/**
 * One board's MCB detail, read-only — the same two rows the step captures.
 * Unset cells show "—" so a genuinely unanswered field stays distinct from one
 * answered as blank, the rule the rest of this preview follows.
 */
function BoardDetailPreview({ title, detail }: { title: string; detail: AcdcMcbBoardDetail }) {
  const rows: [string, string, McbPoleType | null, string | null, string | null][] = [
    ['Spare MCBs (Nos.)', dash(detail.spareMcbCount), detail.spareMcbPole, detail.spareMcbRating, detail.spareMcbRemarks],
    ['MCB for network panel supply', dash(detail.mcbUtilisedForNetworkPanel), detail.utilisedMcbPole, detail.utilisedMcbRating, detail.utilisedMcbRemarks],
  ];

  return (
    <div className="flex flex-col gap-1">
      <SubHeading>{title}</SubHeading>
      <div className="overflow-x-auto">
        <div className="min-w-[28rem]">
          <div className={`${BOARD_GRID_COLS} border-b border-gray-300 pb-1 text-[10px] uppercase tracking-wide text-gray-400`}>
            <span /><span>Single / Double Pole</span><span>Rating (A)</span><span>Remarks</span>
          </div>
          {rows.map(([label, answer, pole, rating, remarks]) => (
            <div key={label} className={`${BOARD_GRID_COLS} break-inside-avoid border-b border-gray-100 py-1 text-xs`}>
              <span className="text-gray-600">
                <span className="font-medium">{label}</span>
                <span className="block text-gray-800">{answer}</span>
              </span>
              <span className="text-gray-800">{pole ? MCB_POLE_TYPE_LABELS[pole] : '—'}</span>
              <span className="text-gray-800">{dash(rating)}</span>
              <span className="text-gray-800">{dash(remarks)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Superseded fixed-slot entries, shown so a reviewer knows they are pending. */
function LegacySlotsPreview({ label, slots }: { label: string; slots: McbSlot[] }) {
  const filled = slots
    .map((slot, i) => ({ n: i + 1, ...slot }))
    .filter((slot) => slot.poleType !== null || slot.ratingA !== null);
  if (filled.length === 0) return null;

  return (
    <Field
      label={`${label} slots recorded before this section changed`}
      value={filled
        .map((s) => `MCB ${s.n}: ${s.poleType ? MCB_POLE_TYPE_LABELS[s.poleType] : '—'}${s.ratingA ? `, ${s.ratingA}` : ''}`)
        .join(' · ')}
      flag="Not yet re-entered above"
    />
  );
}

function AcdcDetailsSection({ details }: { details: SurveyAcdcMcbDetails }) {
  return (
    <div className="flex flex-col gap-3">
      <BoardDetailPreview title="ACDB (230V AC)" detail={details.acdb ?? EMPTY_BOARD_PREVIEW} />
      <LegacySlotsPreview label="ACDB" slots={details.acdbMcbSlots ?? []} />
      <div className="flex flex-col gap-1">
        <SubHeading>DCDB Details (110 / 220V DC)</SubHeading>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Charger O/P Voltage" value={dash(details.dcdbChargerOutputVoltage)} />
          <Field label="Battery O/P Voltage" value={dash(details.dcdbBatteryOutputVoltage)} />
        </div>
      </div>
      <BoardDetailPreview title="DCDB (110 / 220V DC)" detail={details.dcdb ?? EMPTY_BOARD_PREVIEW} />
      <LegacySlotsPreview label="DCDB" slots={details.dcdbMcbSlots ?? []} />
    </div>
  );
}

function CableRunsSection({ cableRuns, difficultRunsNotes }: { cableRuns: SurveyCableRun[]; difficultRunsNotes: string | null }) {
  const cat6Total  = cableRuns.filter((r) => r.cableType === 'cat6').reduce((sum, r) => sum + (r.lengthM ?? 0), 0);
  const powerTotal = cableRuns.filter((r) => r.cableType === 'power').reduce((sum, r) => sum + (r.lengthM ?? 0), 0);

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-medium text-gray-600">
        CAT6 total: {cat6Total} m = {formatMetresAsKm(cat6Total)} km · Power total: {powerTotal} m = {formatMetresAsKm(powerTotal)} km
      </p>
      {/* Two labelled groups, matching the step. Each is required, so an
          empty one is a real gap a reviewer should see named. */}
      {([['cat6', 'CAT6 Cable Runs'], ['power', 'Power Cable Runs']] as const).map(([type, title]) => {
        const runs = cableRuns.filter((r) => r.cableType === type);
        return (
          <div key={type} className="flex flex-col gap-1">
            <SubHeading>{title}</SubHeading>
            {runs.length === 0 ? (
              <p className="text-xs text-gray-400 italic">None recorded.</p>
            ) : (
              runs.map((run, i) => (
                <div key={run.uid} className="grid grid-cols-3 gap-2 p-2 rounded border border-gray-200 break-inside-avoid">
                  <Field label="Route" value={run.fromTo.trim() || `Run #${i + 1}`} />
                  <Field label="Length" value={run.lengthM != null ? `${run.lengthM} m` : '—'} />
                  <Field label="Trays" value={run.trays ? TRAYS_LABELS[run.trays] : '—'} />
                </div>
              ))
            )}
          </div>
        );
      })}
      <Field label="Longest / difficult runs noted" value={dash(difficultRunsNotes)} />
    </div>
  );
}

// ─── BOQ ───────────────────────────────────────────────────────────────────────

/**
 * Two quantity columns, matching the official table and the rebuilt
 * SurveyBoqLine: what is already on site and reusable, and what we must
 * supply. Service/ITC lines carry hasExistingUsable:false — their
 * "existing" cell reads n/a rather than an em-dash, so a reviewer can tell
 * "question doesn't apply" from "nobody answered".
 */
function BoqTable({ title, master, lines }: { title: string; master: readonly BoqMasterItem[]; lines: SurveyBoqLine[] }) {
  return (
    <div className="flex flex-col gap-1">
      <SubHeading>{title}</SubHeading>
      <div className="grid grid-cols-[1.5rem_1fr_5rem_5rem_1fr] gap-2 items-baseline py-1 border-b border-gray-300 text-[10px] uppercase tracking-wide text-gray-400">
        <span>Sr</span>
        <span>Item</span>
        <span>Existing &amp; usable</span>
        <span>Required to supply</span>
        <span>Remarks</span>
      </div>
      {master.map((item) => {
        // Matched by itemKey, never array position — same rule as StepBoq.tsx.
        const line = lines.find((l) => l.itemKey === item.itemKey);

        // A considered zero ("not applicable, because…") must not print
        // identically to an unanswered line — that distinction is the whole
        // reason SurveyBoqLine carries notApplicable, and this is the page
        // the approver actually vets.
        const existing = !item.hasExistingUsable
          ? 'n/a'
          : line?.existingUsable != null ? `${line.existingUsable} ${item.unit}` : '—';
        const required = line?.notApplicable
          ? 'Not applicable'
          : line?.requiredToSupply != null ? `${line.requiredToSupply} ${item.unit}` : '—';

        return (
          <div
            key={item.itemKey}
            className="grid grid-cols-[1.5rem_1fr_5rem_5rem_1fr] gap-2 items-baseline py-1 border-b border-gray-100 break-inside-avoid text-xs"
          >
            <span className="text-gray-400 font-mono">{item.sr}</span>
            <span className="text-gray-800">{item.item}</span>
            <span className={cn('text-gray-600', !item.hasExistingUsable && 'text-gray-300 italic')}>
              {existing}
            </span>
            <span className="text-gray-800 font-medium">
              {required}
              {line?.autoDerived && line.requiredToSupply != null && !line.notApplicable && (
                <span className="ml-1 text-[10px] font-normal text-gray-400">(derived)</span>
              )}
            </span>
            <span className="text-gray-500 italic truncate">{dash(line?.remarks)}</span>
          </div>
        );
      })}
    </div>
  );
}

// ─── Props ──────────────────────────────────────────────────────────────────────

export interface SurveyPreviewProps {
  survey: SurveyReport;
  siteName: string;
  siteMaster?: { totalBays: number | null; numPowerTransformers: number | null } | null;
  /** WorkOrder field not present on SurveyReport — shown in the header if given. */
  workOrderCode?: string | null;
  /**
   * Applies a patch to the survey — needed only for the two signature pads at
   * the bottom to write signOff.surveyorSignatureImage/msetclSignatureImage.
   * Omit (or pass readOnly=true) to render fully read-only, e.g. an
   * approver's review screen that shows already-captured signatures but
   * can't add new ones.
   */
  onChange?: (patch: Partial<SurveyReport>) => void;
  /** Required alongside onChange — signatures are keyed by this id, same as every other photo. */
  workOrderId?: string;
  readOnly?: boolean;
  onClose?: () => void;
  /**
   * Optional actions rendered in the toolbar next to "Save as PDF" — e.g.
   * the approver review screen's Approve / Request Changes buttons. Omitted
   * by the wizard's own "Preview & Sign" usage.
   */
  renderActions?: () => ReactNode;
}

// ─── Print styling ──────────────────────────────────────────────────────────────
// Rendered as a <style> tag inside the portal, so it's scoped to exist only
// while the preview is mounted, with zero global CSS file to edit — fully
// self-contained and portable to the approver review screen.

const PRINT_CSS = `
@media print {
  body > *:not(.survey-print-root) { display: none !important; }
  .survey-print-root {
    position: static !important;
    inset: auto !important;
    height: auto !important;
    max-height: none !important;
    overflow: visible !important;
    background: white !important;
  }
  .survey-print-content { padding-top: 28px !important; }
  @page { size: A4; margin: 15mm 12mm; }
}
`;

/**
 * Full read-only preview of everything recorded in the survey, printable to
 * PDF via window.print() (no jsPDF/html2canvas — see the task note on why).
 * Shared verbatim by the wizard's Sign-Off step and the approver's review
 * screen — no wizard-specific coupling here beyond the optional
 * onChange/workOrderId used by the signature pads.
 *
 * Section order follows the 10-step wizard exactly, so a reviewer reading the
 * preview and a surveyor walking the form are looking at the same document in
 * the same order.
 */
export function SurveyPreview({
  survey, siteName, siteMaster, workOrderCode, onChange, workOrderId, readOnly = false, onClose,
  renderActions,
}: SurveyPreviewProps) {
  const issues = validateSurvey(survey);
  const errorCount = issues.filter((i) => i.severity === 'error').length;
  const canEditSignatures = !!onChange && !!workOrderId && !readOnly;

  function updateSignOff(patch: Partial<SurveySignOff>) {
    onChange?.({ signOff: { ...survey.signOff, ...patch } });
  }

  const content = (
    <div className="survey-print-root fixed inset-0 z-[9999] bg-brand-background overflow-y-auto">
      <style>{PRINT_CSS}</style>

      {/* Repeating print header — position:fixed elements re-render on every printed page. */}
      <div className="hidden print:block fixed top-0 left-0 right-0 bg-white px-3 py-1 border-b border-gray-300">
        <p className="text-[10px] text-gray-500">
          {survey.siteCode}{workOrderCode ? ` · ${workOrderCode}` : ''}
        </p>
      </div>

      {/* On-screen toolbar */}
      <div className="print:hidden sticky top-0 z-10 flex items-center justify-between gap-2 bg-white border-b border-gray-200 px-4 py-3">
        <h2 className="text-base font-bold text-gray-900">Survey Preview</h2>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          {renderActions?.()}
          <Button type="button" variant="outline" size="sm" onClick={() => window.print()}>
            Save as PDF
          </Button>
          {onClose && (
            <Button type="button" variant="outline" size="sm" onClick={onClose} aria-label="Close preview">
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      <div className="survey-print-content max-w-3xl mx-auto p-4 print:p-0 print:max-w-none flex flex-col gap-4 print:text-black">
        {/* Header */}
        <div className="flex flex-col gap-0.5">
          {workOrderCode && <p className="text-xs text-gray-400 font-mono">{workOrderCode}</p>}
          <h1 className="text-xl font-bold text-gray-900">{siteName || survey.siteCode}</h1>
          <p className="text-xs text-gray-500">{survey.siteCode}</p>
          <p className="text-[10px] text-gray-400">Generated from FieldOps on {new Date().toLocaleString()}</p>
        </div>

        {/* Incomplete banner — an MSETCL engineer must not sign something that can't even be submitted */}
        {errorCount > 0 && (
          <div className="flex items-start gap-3 p-3 bg-red-50 border border-red-200 rounded-lg break-inside-avoid">
            <AlertTriangle className="h-5 w-5 text-red-600 shrink-0 mt-0.5" />
            <p className="text-sm font-semibold text-red-800">
              This survey is incomplete — {errorCount} item{errorCount !== 1 ? 's' : ''} still required.
            </p>
          </div>
        )}

        {/* 1. Site & Visit */}
        <div className="flex flex-col gap-3">
          <SectionHeading>1. Site &amp; Visit</SectionHeading>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Substation" value={dash(siteName || survey.siteCode)} />
            <Field label="Site Code" value={dash(survey.siteCode)} />
            <Field label="SAP Code" value={dash(survey.sapCode)} />
            <Field label="Zone" value={dash(survey.zone)} />
            <Field label="Voltage Class" value={survey.voltageClass ? `${survey.voltageClass} kV` : '—'} />
            <Field label="Survey Date" value={survey.surveyDate ? survey.surveyDate.toLocaleDateString() : '—'} />
            <Field label="GPS" value={survey.location ? `${survey.location.lat.toFixed(6)}, ${survey.location.lng.toFixed(6)}` : '—'} />
            <Field label="Surveyor" value={dash(survey.surveyorName)} />
          </div>
          <ContactDetailsBlock contact={survey.contactDetails} />
          <ControlRoomBlock controlRoom={survey.controlRoom} />
          <AssetCountsBlock counts={survey.assetCounts} siteMaster={siteMaster} />
        </div>

        {/* 2. Feeder List */}
        <div className="flex flex-col gap-2">
          <SectionHeading>2. Feeder List</SectionHeading>
          {survey.feeders.length === 0 ? (
            <p className="text-xs text-gray-400 italic">No feeders recorded.</p>
          ) : (
            survey.feeders.map((feeder, i) => <FeederBlock key={feeder.uid} feeder={feeder} index={i} />)
          )}
        </div>

        {/* 3. CRP Relay Details */}
        <div className="flex flex-col gap-2">
          <SectionHeading>3. CRP Relay Details</SectionHeading>
          {survey.relays.length === 0 ? (
            <p className="text-xs text-gray-400 italic">No relays recorded.</p>
          ) : (
            survey.relays.map((relay, i) => <RelayBlock key={relay.uid} relay={relay} index={i} />)
          )}
        </div>

        {/* 4. Capacitor Bank Details */}
        <div className="flex flex-col gap-2">
          <SectionHeading>4. Capacitor Bank Details</SectionHeading>
          {survey.capacitorBanks.length === 0 ? (
            <p className="text-xs text-gray-400 italic">No capacitor banks recorded.</p>
          ) : (
            survey.capacitorBanks.map((bank, i) => <CapacitorBankBlock key={bank.uid} bank={bank} index={i} />)
          )}
        </div>

        {/* 5. Transformer Details */}
        <div className="flex flex-col gap-2">
          <SectionHeading>5. Transformer Details</SectionHeading>
          {survey.transformers.length === 0 ? (
            <p className="text-xs text-gray-400 italic">No transformers recorded.</p>
          ) : (
            survey.transformers.map((tx, i) => <TransformerBlock key={tx.uid} tx={tx} index={i} />)
          )}
        </div>

        {/* 6. Infrastructure — still the pre-rebuild shape (see note at top of file) */}
        <div className="flex flex-col gap-2">
          <SectionHeading>6. Site Infrastructure &amp; Checklist</SectionHeading>
          <InfrastructureSection infra={survey.infrastructure} checklist={survey.siteChecklist} />
        </div>

        {/* 7. ACDB & DCDB Details — the station's own boards. Distinct from the
            per-voltage-level DC breaker voltages in section 6 above. */}
        <div className="flex flex-col gap-2">
          <SectionHeading>7. ACDB &amp; DCDB Details</SectionHeading>
          <AcdcDetailsSection details={survey.acdcMcbDetails} />
        </div>

        {/* 8. Cable Runs */}
        <div className="flex flex-col gap-2">
          <SectionHeading>8. Cable Runs</SectionHeading>
          <CableRunsSection cableRuns={survey.cableRuns} difficultRunsNotes={survey.difficultRunsNotes} />
        </div>

        {/* 9. Site Photographs — grouped by slot, in SURVEY_PHOTO_SLOTS order (not array order) */}
        <div className="flex flex-col gap-3">
          <SectionHeading>9. Site Photographs</SectionHeading>
          {SURVEY_PHOTO_SLOTS.map((slot) => {
            const entries = survey.sitePhotos.filter((p) => p.caption === slot);
            const remarked = entries.filter((p) => !!p.remark?.trim());
            return (
              <div key={slot} className="flex flex-col gap-1 break-inside-avoid">
                <span className="text-xs font-medium text-gray-600">{slot}</span>
                <PhotoGrid refs={entries.map((p) => p.url)} />
                {/* Remarks are optional — the block is omitted entirely when
                    none of this slot's photos carries one. */}
                {remarked.length > 0 && (
                  <ul className="mt-0.5 flex flex-col gap-0.5">
                    {remarked.map((p, i) => (
                      <li key={p.url} className="text-xs text-gray-500">
                        <span className="text-gray-400">Photo {i + 1}:</span>{' '}
                        <span className="italic">{p.remark}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>

        {/* 10. BOQ */}
        <div className="flex flex-col gap-3">
          <SectionHeading>10. Bill of Quantity</SectionHeading>
          <BoqTable title="Supply" master={SUPPLY_BOQ_MASTER} lines={survey.boqSupply} />
        </div>

        {/* Confirmation — unchanged shape */}
        <div className="flex flex-col gap-1">
          <SectionHeading>Confirmation</SectionHeading>
          {BOQ_CHECK_LABELS.map((item) => (
            <TickField key={item.key} label={item.label} checked={survey.boqChecks[item.key]} />
          ))}
        </div>

        {/* 11. Sign-off — unchanged shape */}
        <div className="flex flex-col gap-2">
          <SectionHeading>11. Sign-Off</SectionHeading>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Surveyor" value={dash(survey.surveyorName)} />
            <Field label="MSETCL Engineer Name" value={dash(survey.signOff.msetclEngineerName)} />
            <Field label="MSETCL Engineer Designation" value={dash(survey.signOff.msetclEngineerDesignation)} />
            <Field label="MSETCL Engineer Emp ID" value={dash(survey.signOff.msetclEngineerEmpId)} />
          </div>
          <span className="text-xs font-medium text-gray-600">Signed BOQ Page</span>
          <PhotoGrid refs={survey.signOff.signedPagePhotos} />
        </div>

        {/* Signatures */}
        <div className="flex flex-col gap-3 pt-2">
          <SectionHeading>Signatures</SectionHeading>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <SignaturePad
              signerLabel="Surveyor (our representative)"
              signerName={survey.surveyorName}
              value={survey.signOff.surveyorSignatureImage}
              onChange={(ref) => updateSignOff({ surveyorSignatureImage: ref })}
              workOrderId={workOrderId ?? ''}
              readOnly={!canEditSignatures}
            />
            <SignaturePad
              signerLabel="MSETCL Joint Engineer"
              signerName={survey.signOff.msetclEngineerName}
              value={survey.signOff.msetclSignatureImage}
              onChange={(ref) => updateSignOff({ msetclSignatureImage: ref })}
              workOrderId={workOrderId ?? ''}
              readOnly={!canEditSignatures}
            />
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(content, document.body);
}
