import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { SUPPLY_BOQ_MASTER, SERVICE_BOQ_MASTER } from '@/lib/boqMaster';
import { SURVEY_PHOTO_SLOTS, validateSurvey } from '@/lib/surveyValidation';
import { formatMetresAsKm } from '@/lib/units';
import {
  VOLTAGE_LEVEL_LABELS, BAY_COUNT_LABELS, RELAY_TYPE_LABELS, PROTOCOL_LABELS,
  CAPACITOR_CONTROL_TYPE_LABELS, CABLE_TYPE_LABELS, TRAYS_LABELS,
  CIVIL_WORK_LABELS, DC_VOLTAGE_LABELS, PRE_VISIT_LABELS, BOQ_CHECK_LABELS,
} from '@/lib/surveyLabels';
import { SurveyPhotoThumb } from './SurveyPhotoThumb';
import { SignaturePad } from './SignaturePad';
import { SURVEY_VOLTAGE_LEVELS } from '@/types';
import type { BoqMasterItem } from '@/lib/boqMaster';
import type {
  SurveyReport, SurveyFeederEntry, SurveyRelayEntry, SurveyTransformerEntry,
  SurveyCapacitorBank, SurveyCableRun, SurveyInfrastructure, SurveyBoqLine,
  SurveySignOff, SurveyContactDetails, SurveyControlRoom, SurveyAssetCounts,
} from '@/types';

// Every enum label and checklist wording comes from src/lib/surveyLabels.ts —
// the single source shared with the step components. Nothing is redefined
// here: a preview whose wording differs from the form it previews is a
// correctness problem on a document an MSETCL engineer signs. BOQ item names
// and photo slot names come from their own shared homes (boqMaster.ts /
// surveyValidation.ts), imported above.
//
// SECTIONS STILL ON THE PRE-REBUILD SHAPE — deliberately, until their own
// phases land, so this file matches what those steps actually produce today:
//   - Infrastructure  (renders SurveyInfrastructure; survey.siteChecklist is
//                      NOT rendered, because StepInfrastructure doesn't write
//                      it yet)
//   - BOQ confirmation checks and Sign-Off (unchanged shapes)
// Every other section below matches the rebuilt Phase 1–2c shapes.

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
  return level ? VOLTAGE_LEVEL_LABELS[level] : '—';
}

// ─── Site & Visit ──────────────────────────────────────────────────────────────

function ContactDetailsBlock({ contact }: { contact: SurveyContactDetails }) {
  return (
    <div className="flex flex-col gap-1">
      <SubHeading>Contact Details</SubHeading>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Name of the Substation In-charge" value={dash(contact.substationInchargeName)} />
        <Field label="Substation In-charge Contact Details" value={dash(contact.substationInchargePhone)} />
        <Field label="Substation Telephone — Landline" value={dash(contact.substationLandline)} />
        <Field label="Substation Telephone — VOIP" value={dash(contact.substationVoip)} />
        <Field label="Circle" value={dash(contact.circle)} />
        <Field label="Division" value={dash(contact.division)} />
        <Field
          label="Commissioned Date"
          value={contact.commissionedDate ? contact.commissionedDate.toLocaleDateString() : '—'}
        />
        <Field label="Nearest Railway Station / Landmark" value={dash(contact.nearestRailwayStationOrLandmark)} />
      </div>
      <Field label="Contact Details of Shift Operators" value={dash(contact.shiftOperatorContacts)} />
      <Field label="Address" value={dash(contact.address)} />
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
  // half-filled group never flags a misleadingly large discrepancy against
  // the site master. Same rule as the Site & Visit step's own hint.
  const answered = SURVEY_VOLTAGE_LEVELS
    .map((level) => counts.baysByVoltage[level])
    .filter((n): n is number => n != null);
  const totalBays = answered.length > 0 ? answered.reduce((sum, n) => sum + n, 0) : null;

  const bayFlag =
    siteMaster?.totalBays != null && totalBays != null && siteMaster.totalBays !== totalBays
      ? `Site master says ${siteMaster.totalBays}`
      : null;
  const transformerFlag =
    siteMaster?.numPowerTransformers != null &&
    counts.transformerCount != null &&
    siteMaster.numPowerTransformers !== counts.transformerCount
      ? `Site master says ${siteMaster.numPowerTransformers}`
      : null;

  return (
    <div className="flex flex-col gap-1">
      <SubHeading>Asset Counts</SubHeading>
      <div className="grid grid-cols-2 gap-2">
        {SURVEY_VOLTAGE_LEVELS.map((level) => (
          <Field key={level} label={BAY_COUNT_LABELS[level]} value={dash(counts.baysByVoltage[level])} />
        ))}
        <Field label="Total Bays (sum of answered levels)" value={dash(totalBays)} flag={bayFlag} />
        <Field label="Number of Transformers" value={dash(counts.transformerCount)} flag={transformerFlag} />
        <Field label="Number of Buses" value={dash(counts.busCount)} />
        <Field label="Number of Capacitor Banks" value={dash(counts.capacitorBankCount)} />
      </div>
    </div>
  );
}

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
        <Field label="MFM required" value={dash(feeder.mfmRequired)} />
        <Field label="CMR required" value={dash(feeder.cmrRequired)} />
        <Field label="No. of F-RTU / Remote-IO Modules Required" value={dash(feeder.frtuModulesRequired)} />
      </div>
      <TriField label="Panel space available" value={feeder.panelSpaceAvailable} />
      <TriField label="Existing MFM available & working" value={feeder.existingMfmAvailableWorking} />
      {feeder.existingMfmAvailableWorking === true && (
        <TriField label="Existing MFM RS485 available" value={feeder.existingMfmRs485Available} />
      )}
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
      <TriField label="Existing TPI working" value={tx.existingTpiWorking} />
      {tx.existingTpiWorking === true && (
        <TriField label="Existing TPI 4-20 mA output available" value={tx.existingTpi4to20mAAvailable} />
      )}
      <TriField label="Tap Position Transducer (TPT) required" value={tx.tptRequired} />
      <Field label="Remarks" value={dash(tx.remarks)} />
    </EntryCard>
  );
}

// ─── Infrastructure (PRE-REBUILD SHAPE — see the note at the top) ──────────────

function InfrastructureSection({ infra }: { infra: SurveyInfrastructure }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <SubHeading>Panel Space &amp; Mounting</SubHeading>
        <TriField label="Panel space available" value={infra.panelSpaceAvailable} />
        <Field label="Space measurement" value={dash(infra.panelSpaceMeasurement)} />
        <TriField label="New panel required" value={infra.newPanelRequired} />
        <Field label="Mounting notes" value={dash(infra.mountingNotes)} />
        <Field
          label="Civil work"
          value={infra.civilWork.length ? infra.civilWork.map((c) => CIVIL_WORK_LABELS[c]).join(', ') : '—'}
        />
      </div>
      <div className="flex flex-col gap-1">
        <SubHeading>Power Supply</SubHeading>
        <TriField label="DC supply available" value={infra.dcSupplyAvailable} />
        <Field
          label="DC voltages present"
          value={infra.dcVoltages.length ? infra.dcVoltages.map((v) => DC_VOLTAGE_LABELS[v]).join(', ') : '—'}
        />
        <TriField label="AC supply available" value={infra.acSupplyAvailable} />
        <TriField label="Spare MCBs / feeders" value={infra.spareMcbs} />
        <Field label="DCDB / distribution location" value={dash(infra.dcdbLocation)} />
      </div>
      <div className="flex flex-col gap-1">
        <SubHeading>Communication &amp; Networking</SubHeading>
        <TriField label="OFC / Ethernet availability" value={infra.ofcAvailable} />
        <TriField label="Router available" value={infra.routerAvailable} />
        <TriField label="MPLS available" value={infra.mplsAvailable} />
        <Field label="SLDC / ALDC path notes" value={dash(infra.sldcPathNotes)} />
        <TriField label="Earthing available" value={infra.earthingAvailable} />
      </div>
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
      {cableRuns.length === 0 ? (
        <p className="text-xs text-gray-400 italic">No cable runs recorded.</p>
      ) : (
        cableRuns.map((run, i) => (
          <div key={run.uid} className="grid grid-cols-2 gap-2 p-2 rounded border border-gray-200 break-inside-avoid">
            <Field label="Cable Type" value={run.cableType ? CABLE_TYPE_LABELS[run.cableType] : '—'} />
            <Field label="Route" value={run.fromTo.trim() || `Run #${i + 1}`} />
            <Field label="Length" value={run.lengthM != null ? `${run.lengthM} m` : '—'} />
            <Field label="Trays" value={run.trays ? TRAYS_LABELS[run.trays] : '—'} />
          </div>
        ))
      )}
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
          <div className="flex flex-col gap-1">
            <SubHeading>Pre-Visit Checklist</SubHeading>
            {PRE_VISIT_LABELS.map((item) => (
              <TickField key={item.key} label={item.label} checked={survey.preVisit[item.key]} />
            ))}
          </div>
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
          <SectionHeading>6. Site Infrastructure</SectionHeading>
          <p className="text-[10px] text-amber-600 italic print:hidden">
            Not yet rebuilt against the official checklist — mirrors what the Infrastructure step
            currently records. The site-checklist tables land with that step&apos;s own phase.
          </p>
          <InfrastructureSection infra={survey.infrastructure} />
        </div>

        {/* 7. Cable Runs */}
        <div className="flex flex-col gap-2">
          <SectionHeading>7. Cable Runs</SectionHeading>
          <CableRunsSection cableRuns={survey.cableRuns} difficultRunsNotes={survey.difficultRunsNotes} />
        </div>

        {/* 8. Site Photographs — grouped by slot, in SURVEY_PHOTO_SLOTS order (not array order) */}
        <div className="flex flex-col gap-3">
          <SectionHeading>8. Site Photographs</SectionHeading>
          {SURVEY_PHOTO_SLOTS.map((slot) => (
            <div key={slot} className="flex flex-col gap-1 break-inside-avoid">
              <span className="text-xs font-medium text-gray-600">{slot}</span>
              <PhotoGrid refs={survey.sitePhotos.filter((p) => p.caption === slot).map((p) => p.url)} />
            </div>
          ))}
        </div>

        {/* 9. BOQ */}
        <div className="flex flex-col gap-3">
          <SectionHeading>9. Bill of Quantity</SectionHeading>
          <BoqTable title="Supply" master={SUPPLY_BOQ_MASTER} lines={survey.boqSupply} />
          <BoqTable title="Service" master={SERVICE_BOQ_MASTER} lines={survey.boqService} />
        </div>

        {/* Confirmation — unchanged shape */}
        <div className="flex flex-col gap-1">
          <SectionHeading>Confirmation</SectionHeading>
          {BOQ_CHECK_LABELS.map((item) => (
            <TickField key={item.key} label={item.label} checked={survey.boqChecks[item.key]} />
          ))}
        </div>

        {/* 10. Sign-off — unchanged shape */}
        <div className="flex flex-col gap-2">
          <SectionHeading>10. Sign-Off</SectionHeading>
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
