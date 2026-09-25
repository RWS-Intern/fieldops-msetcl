import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { PhotoCapture } from '@/components/survey/PhotoCapture';
import { SignedPdfAttach } from '@/components/survey/SignedPdfAttach';
import { DrawingTitleBlock } from '@/components/survey/DrawingTitleBlock';
import { isPdfRef } from '@/lib/signedDocs';
import { SurveyPhotoThumb } from '@/components/survey/SurveyPhotoThumb';
import { SurveyPreview } from '@/components/survey/SurveyPreview';
import type { SurveyStepProps } from './StepProps';
import type { SurveyDrawingTitleBlock } from '@/types';

function SummaryStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex flex-col">
      <span className="text-lg font-bold text-gray-900 leading-tight">{value}</span>
      <span className="text-[11px] text-gray-500">{label}</span>
    </div>
  );
}

function SignatureThumb({ label, reference }: { label: string; reference: string | null }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-gray-500">{label}</span>
      <div className="h-16 border border-gray-200 rounded-lg bg-white flex items-center justify-center overflow-hidden">
        {reference ? (
          <SurveyPhotoThumb reference={reference} className="h-full w-full object-contain" />
        ) : (
          <span className="text-[10px] text-gray-400">Not signed</span>
        )}
      </div>
    </div>
  );
}

/**
 * Joint sign-off & submit. The signed paper survey is the legal artefact for
 * SE-PAC vetting — an attachment of it (photo or scanned PDF) stays a hard
 * requirement. "Preview &
 * Sign" opens a full-page read-only preview of everything recorded, printable
 * to PDF, with both parties' on-screen signatures at the end of it —
 * supplementary evidence alongside the paper original, not a replacement for
 * it (see the comment in surveyValidation.ts's validateSignOff for why they're
 * warnings, not errors).
 */
export function StepSignOff({
  survey, onChange, readOnly, onReplacePhotoRef, siteName, siteMaster, workOrderCode,
}: SurveyStepProps) {
  const [showPreview, setShowPreview] = useState(false);
  const signOff = survey.signOff;

  // One stored array, two controls. Splitting on read keeps PhotoCapture's
  // behaviour identical to every other photo field in the survey.
  const signedPagePdfRefs   = signOff.signedPagePhotos.filter(isPdfRef);
  const signedPagePhotoRefs = signOff.signedPagePhotos.filter((r) => !isPdfRef(r));

  function patchSignOff(patch: Partial<typeof signOff>) {
    onChange({ signOff: { ...signOff, ...patch } });
  }

  const totalPhotos =
    survey.sitePhotos.length +
    survey.feeders.reduce((n, f) => n + f.photos.length, 0) +
    survey.relays.reduce((n, r) => n + r.photos.length, 0) +
    // Photos only — a PDF is an attachment, not a photograph, and counting it
    // here would make the pre-submit photo tally disagree with the Photos step.
    signedPagePhotoRefs.length;
  // Supply only — the service table is no longer part of the survey, so
  // counting its (permanently unfillable) lines would make this read x/18.
  const boqTotalLines = survey.boqSupply.length;
  // "Filled" counts the required-to-supply column, matching validateBoq's
  // remap — that is the column that governs supply. existingUsable is not
  // counted here for the same reason it carries no validation rule.
  const boqFilledLines =
    survey.boqSupply.filter((l) => l.requiredToSupply != null).length;

  return (
    <div className="flex flex-col gap-5">
      <h3 className="text-base font-semibold text-gray-900">Joint Sign-Off &amp; Submit</h3>

      {/* Surveyor — captured in Step 1, read-only here */}
      <div className="flex flex-col gap-1.5">
        <Label>Surveyor (our rep)</Label>
        <p className="text-sm font-medium text-gray-800 py-2">{survey.surveyorName || '—'}</p>
        <p className="text-xs text-gray-400">To change this, go back to Step 1 (Site &amp; Visit).</p>
      </div>

      {/* MSETCL joint engineer */}
      <div className="flex flex-col gap-3">
        <h4 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">MSETCL Joint Engineer</h4>
        <div className="flex flex-col gap-1.5">
          <Label>
            Name<span className="text-brand-red"> *</span>
          </Label>
          <Input
            disabled={readOnly}
            value={signOff.msetclEngineerName ?? ''}
            onChange={(e) => patchSignOff({ msetclEngineerName: e.target.value || null })}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>
            Designation<span className="text-brand-red"> *</span>
          </Label>
          <Input
            disabled={readOnly}
            value={signOff.msetclEngineerDesignation ?? ''}
            onChange={(e) => patchSignOff({ msetclEngineerDesignation: e.target.value || null })}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Employee ID</Label>
          <Input
            disabled={readOnly}
            value={signOff.msetclEngineerEmpId ?? ''}
            placeholder="Optional — not always to hand on site"
            onChange={(e) => patchSignOff({ msetclEngineerEmpId: e.target.value || null })}
          />
        </div>
      </div>

      {/* Preview & Sign */}
      <div className="flex flex-col gap-3 pt-3 border-t border-gray-100">
        <Button type="button" className="w-full" onClick={() => setShowPreview(true)}>
          Preview &amp; Sign
        </Button>
        <div className="grid grid-cols-2 gap-3">
          <SignatureThumb label="Surveyor" reference={signOff.surveyorSignatureImage} />
          <SignatureThumb label="MSETCL Engineer" reference={signOff.msetclSignatureImage} />
        </div>
      </div>

      {showPreview && (
        <SurveyPreview
          survey={survey}
          siteName={siteName || survey.siteCode}
          siteMaster={siteMaster}
          workOrderCode={workOrderCode}
          onChange={onChange}
          workOrderId={survey.workOrderId}
          readOnly={readOnly}
          onClose={() => setShowPreview(false)}
        />
      )}

      {/* The signed page — the document of record. Photos and PDFs share one
          stored array, so either satisfies the requirement; they are split
          here only so each control sees the kind it can actually handle, and
          PhotoCapture never receives a PDF it would render as a broken img. */}
      <div className="flex flex-col gap-3">
        <h4 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Signed Page</h4>
        <p className="text-xs text-gray-500">
          Photograph the physically signed survey with both signatures visible, or attach a
          scanned PDF of it. Together with the paper original this is the document of record for
          SE-PAC vetting, and it is what an approver checks the app&apos;s data against.
        </p>
        <PhotoCapture
          photos={signedPagePhotoRefs}
          onChange={(photos) => patchSignOff({ signedPagePhotos: [...photos, ...signedPagePdfRefs] })}
          onReplacePhotoRef={onReplacePhotoRef}
          workOrderId={survey.workOrderId}
          siteCode={survey.siteCode}
          readOnly={readOnly}
          label="Photo or PDF of the signed survey (both signatures visible)"
        />
        <SignedPdfAttach
          pdfs={signedPagePdfRefs}
          onChange={(pdfs) => patchSignOff({ signedPagePhotos: [...signedPagePhotoRefs, ...pdfs] })}
          siteCode={survey.siteCode}
          readOnly={readOnly}
        />
      </div>

      {/* Drawing title block — document control, after the signatures. */}
      <div className="flex flex-col gap-2 pt-3 border-t border-gray-100">
        <h4 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
          Drawing Title Block
        </h4>
        <DrawingTitleBlock
          value={signOff.titleBlock}
          onChange={(patch) => patchSignOff({ titleBlock: { ...(signOff.titleBlock ?? {}), ...patch } as SurveyDrawingTitleBlock })}
          readOnly={readOnly}
        />
      </div>

      {/* Pre-submit summary */}
      <div className="flex flex-col gap-2 pt-3 border-t border-gray-100">
        <h4 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Before You Submit</h4>
        <p className="text-xs text-gray-500">
          This is the last screen before a contractual submission for approval.
        </p>
        <div className="grid grid-cols-3 gap-3 p-3 rounded-lg bg-gray-50 border border-gray-100">
          <SummaryStat label="Feeders" value={survey.feeders.length} />
          <SummaryStat label="Relays" value={survey.relays.length} />
          <SummaryStat label="Cable Runs" value={survey.cableRuns.length} />
          <SummaryStat label="BOQ Lines Filled" value={`${boqFilledLines}/${boqTotalLines}`} />
          <SummaryStat label="Total Photos" value={totalPhotos} />
        </div>
      </div>
    </div>
  );
}
