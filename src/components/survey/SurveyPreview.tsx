import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { SUPPLY_BOQ_MASTER, SERVICE_BOQ_MASTER } from '@/lib/boqMaster';
import { SURVEY_PHOTO_SLOTS, validateSurvey } from '@/lib/surveyValidation';
import { formatMetresAsKm } from '@/lib/units';
import {
  BAY_TYPE_LABELS, DEVICE_TYPE_LABELS, PROTOCOL_LABELS, PORT_LABELS,
  CABLE_TYPE_LABELS, TRAYS_LABELS, CIVIL_WORK_LABELS, DC_VOLTAGE_LABELS,
  PRE_VISIT_LABELS, BOQ_CHECK_LABELS,
} from '@/lib/surveyLabels';
import { SurveyPhotoThumb } from './SurveyPhotoThumb';
import { SignaturePad } from './SignaturePad';
import type { BoqMasterItem } from '@/lib/boqMaster';
import type {
  SurveyReport, SurveyBay, SurveyDevice, SurveyCableRun, SurveyInfrastructure,
  SurveyBoqLine, SurveySignOff,
} from '@/types';

// Enum display labels and checklist wording (bay type, device type, protocol,
// port, cable type, trays, civil work, DC voltage, pre-visit checklist, BOQ
// confirmation checklist) all come from src/lib/surveyLabels.ts — the single
// source shared with StepSiteVisit.tsx / StepBays.tsx / StepDevices.tsx /
// StepCableRuns.tsx / StepInfrastructure.tsx / StepBoq.tsx. BOQ item names and
// photo slot names come from their own existing shared sources (boqMaster.ts /
// surveyValidation.ts, imported above). None of these are redefined here.

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

// ─── Section renderers ─────────────────────────────────────────────────────────

function BayBlock({ bay, index }: { bay: SurveyBay; index: number }) {
  return (
    <div className="flex flex-col gap-2 p-3 rounded-lg border border-gray-200 break-inside-avoid">
      <p className="text-sm font-bold text-gray-900">{bay.bayNumber.trim() || `Bay #${index + 1}`}</p>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Bay Type" value={bay.bayType ? BAY_TYPE_LABELS[bay.bayType] : '—'} />
        <Field label="Voltage Level" value={bay.voltageLevel ? `${bay.voltageLevel} kV` : '—'} />
        <Field label="Status (DI) Points" value={dash(bay.diPoints)} />
        <Field label="Control (DO) Points" value={dash(bay.doPoints)} />
        <Field label="Analog (AI) Points" value={dash(bay.aiPoints)} />
        <Field label="CT Ratio" value={dash(bay.ctRatio)} />
        <Field label="PT Ratio" value={dash(bay.ptRatio)} />
      </div>
      {bay.bayType === 'transformer' && (
        <div className="grid grid-cols-2 gap-2">
          <TriField label="Tap Changer Present" value={bay.tapChangerPresent} />
          {bay.tapChangerPresent === true && <Field label="Tap Positions" value={dash(bay.tapPositions)} />}
        </div>
      )}
      <Field label="Remarks" value={dash(bay.remarks)} />
      <PhotoGrid refs={bay.photos} />
    </div>
  );
}

function DeviceBlock({ device, index }: { device: SurveyDevice; index: number }) {
  return (
    <div className="flex flex-col gap-2 p-3 rounded-lg border border-gray-200 break-inside-avoid">
      <p className="text-sm font-bold text-gray-900">Device #{index + 1}</p>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Device Type" value={device.deviceType ? DEVICE_TYPE_LABELS[device.deviceType] : '—'} />
        <Field label="Make" value={dash(device.make)} />
        <Field label="Model" value={dash(device.model)} />
        <Field label="Protocol" value={device.protocol ? PROTOCOL_LABELS[device.protocol] : '—'} />
        <Field label="Port" value={device.port ? PORT_LABELS[device.port] : '—'} />
        <Field label="Quantity" value={dash(device.quantity)} />
      </div>
      <TriField label="Reusable / suitable for integration" value={device.reusable} />
      <Field label="Remarks" value={dash(device.remarks)} />
      <PhotoGrid refs={device.photos} />
    </div>
  );
}

function InfrastructureSection({ infra }: { infra: SurveyInfrastructure }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h4 className="text-xs font-bold text-gray-500 uppercase">Panel Space &amp; Mounting</h4>
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
        <h4 className="text-xs font-bold text-gray-500 uppercase">Power Supply</h4>
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
        <h4 className="text-xs font-bold text-gray-500 uppercase">Communication &amp; Networking</h4>
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

function BoqTable({ title, master, lines }: { title: string; master: readonly BoqMasterItem[]; lines: SurveyBoqLine[] }) {
  return (
    <div className="flex flex-col gap-1">
      <h4 className="text-xs font-bold text-gray-500 uppercase">{title}</h4>
      {master.map((item) => {
        // Matched by itemKey, never array position — same rule as StepBoq.tsx.
        const line = lines.find((l) => l.itemKey === item.itemKey);
        return (
          <div
            key={item.itemKey}
            className="grid grid-cols-[2rem_1fr_6rem_8rem] gap-2 items-baseline py-1 border-b border-gray-100 break-inside-avoid text-xs"
          >
            <span className="text-gray-400 font-mono">{item.sr}</span>
            <span className="text-gray-800">{item.item}</span>
            <span className="text-gray-600">{line?.surveyedQty != null ? `${line.surveyedQty} ${item.unit}` : '—'}</span>
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
// self-contained and portable to task 4's approver review screen.

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
 * Shared verbatim by the wizard's Step 8 "Preview & Sign" and (per the
 * design) the approver's review screen — no wizard-specific coupling here
 * beyond the optional onChange/workOrderId used by the signature pads.
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

        {/* A. Site & Visit */}
        <div className="flex flex-col gap-2">
          <SectionHeading>A. Site &amp; Visit</SectionHeading>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Substation" value={dash(siteName || survey.siteCode)} />
            <Field label="Site Code" value={dash(survey.siteCode)} />
            <Field label="SAP Code" value={dash(survey.sapCode)} />
            <Field label="Zone" value={dash(survey.zone)} />
            <Field label="Voltage Class" value={survey.voltageClass ? `${survey.voltageClass} kV` : '—'} />
            <Field label="Survey Date" value={survey.surveyDate ? survey.surveyDate.toLocaleDateString() : '—'} />
            <Field label="GPS" value={survey.location ? `${survey.location.lat.toFixed(6)}, ${survey.location.lng.toFixed(6)}` : '—'} />
            <Field label="Surveyor" value={dash(survey.surveyorName)} />
            <Field
              label="Surveyed Total Bays"
              value={dash(survey.surveyedTotalBays)}
              flag={
                siteMaster?.totalBays != null && survey.surveyedTotalBays != null && siteMaster.totalBays !== survey.surveyedTotalBays
                  ? `Site master says ${siteMaster.totalBays}`
                  : null
              }
            />
            <Field
              label="Surveyed Power Transformers"
              value={dash(survey.surveyedNumPowerTransformers)}
              flag={
                siteMaster?.numPowerTransformers != null &&
                survey.surveyedNumPowerTransformers != null &&
                siteMaster.numPowerTransformers !== survey.surveyedNumPowerTransformers
                  ? `Site master says ${siteMaster.numPowerTransformers}`
                  : null
              }
            />
          </div>
        </div>

        {/* B. Pre-visit checklist */}
        <div className="flex flex-col gap-1">
          <SectionHeading>B. Pre-Visit Checklist</SectionHeading>
          {PRE_VISIT_LABELS.map((item) => (
            <TickField key={item.key} label={item.label} checked={survey.preVisit[item.key]} />
          ))}
        </div>

        {/* C. Bays */}
        <div className="flex flex-col gap-2">
          <SectionHeading>C. Bays</SectionHeading>
          {survey.bays.length === 0 ? (
            <p className="text-xs text-gray-400 italic">No bays recorded.</p>
          ) : (
            survey.bays.map((bay, i) => <BayBlock key={bay.uid} bay={bay} index={i} />)
          )}
        </div>

        {/* D. Devices */}
        <div className="flex flex-col gap-2">
          <SectionHeading>D. Devices</SectionHeading>
          {survey.devices.length === 0 ? (
            <p className="text-xs text-gray-400 italic">No existing devices recorded.</p>
          ) : (
            survey.devices.map((device, i) => <DeviceBlock key={device.uid} device={device} index={i} />)
          )}
        </div>

        {/* E-G. Infrastructure */}
        <div className="flex flex-col gap-2">
          <SectionHeading>E–G. Infrastructure</SectionHeading>
          <InfrastructureSection infra={survey.infrastructure} />
        </div>

        {/* H. Cable Runs */}
        <div className="flex flex-col gap-2">
          <SectionHeading>H. Cable Runs</SectionHeading>
          <CableRunsSection cableRuns={survey.cableRuns} difficultRunsNotes={survey.difficultRunsNotes} />
        </div>

        {/* I. Site Photographs — grouped by slot, in SURVEY_PHOTO_SLOTS order (not array order) */}
        <div className="flex flex-col gap-3">
          <SectionHeading>I. Site Photographs</SectionHeading>
          {SURVEY_PHOTO_SLOTS.map((slot) => (
            <div key={slot} className="flex flex-col gap-1 break-inside-avoid">
              <span className="text-xs font-medium text-gray-600">{slot}</span>
              <PhotoGrid refs={survey.sitePhotos.filter((p) => p.caption === slot).map((p) => p.url)} />
            </div>
          ))}
        </div>

        {/* J. BOQ */}
        <div className="flex flex-col gap-3">
          <SectionHeading>J. Bill of Quantity</SectionHeading>
          <BoqTable title="Supply" master={SUPPLY_BOQ_MASTER} lines={survey.boqSupply} />
          <BoqTable title="Service" master={SERVICE_BOQ_MASTER} lines={survey.boqService} />
        </div>

        {/* Confirmation */}
        <div className="flex flex-col gap-1">
          <SectionHeading>Confirmation</SectionHeading>
          {BOQ_CHECK_LABELS.map((item) => (
            <TickField key={item.key} label={item.label} checked={survey.boqChecks[item.key]} />
          ))}
        </div>

        {/* Sign-off */}
        <div className="flex flex-col gap-2">
          <SectionHeading>Sign-Off</SectionHeading>
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
