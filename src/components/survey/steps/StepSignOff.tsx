import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { PhotoCapture } from '@/components/survey/PhotoCapture';
import { SurveyPhotoThumb } from '@/components/survey/SurveyPhotoThumb';
import { SurveyPreview } from '@/components/survey/SurveyPreview';
import type { SurveyStepProps } from './StepProps';

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
 * Joint sign-off & submit. The signed paper BOQ page is the legal artefact
 * for SE-PAC vetting — the photo of it stays a hard requirement. "Preview &
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

  function patchSignOff(patch: Partial<typeof signOff>) {
    onChange({ signOff: { ...signOff, ...patch } });
  }

  const totalPhotos =
    survey.sitePhotos.length +
    survey.feeders.reduce((n, f) => n + f.photos.length, 0) +
    survey.relays.reduce((n, r) => n + r.photos.length, 0) +
    signOff.signedPagePhotos.length;
  const boqTotalLines = survey.boqSupply.length + survey.boqService.length;
  // "Filled" counts the required-to-supply column, matching validateBoq's
  // remap — that is the column that governs supply. existingUsable is not
  // counted here for the same reason it carries no validation rule.
  const boqFilledLines =
    survey.boqSupply.filter((l) => l.requiredToSupply != null).length +
    survey.boqService.filter((l) => l.requiredToSupply != null).length;

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

      {/* Photo of the signed page — the document of record */}
      <div className="flex flex-col gap-2">
        <h4 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Signed Page</h4>
        <p className="text-xs text-gray-500">
          Photograph the physically signed BOQ page with both signatures visible — this photo,
          together with the paper original, is the document of record for SE-PAC vetting.
        </p>
        <PhotoCapture
          photos={signOff.signedPagePhotos}
          onChange={(photos) => patchSignOff({ signedPagePhotos: photos })}
          onReplacePhotoRef={onReplacePhotoRef}
          workOrderId={survey.workOrderId}
          siteCode={survey.siteCode}
          readOnly={readOnly}
          label="Photo of the signed BOQ page (both signatures visible)"
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
