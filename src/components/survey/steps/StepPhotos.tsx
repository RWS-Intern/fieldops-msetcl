import { SURVEY_PHOTO_SLOTS } from '@/lib/surveyValidation';
import { PhotoCapture } from '@/components/survey/PhotoCapture';
import { SurveyPhotoThumb } from '@/components/survey/SurveyPhotoThumb';
import { Input } from '@/components/ui/input';
import type { SurveyStepProps } from './StepProps';
import type { SurveyReport } from '@/types';

type SitePhoto = SurveyReport['sitePhotos'][number];

function slotEntries(sitePhotos: SurveyReport['sitePhotos'], slot: string): SitePhoto[] {
  return sitePhotos.filter((p) => p.caption === slot);
}

/**
 * Replaces all entries for one slot with a new set of references, leaving other
 * slots untouched — and CARRYING EXISTING REMARKS ACROSS by url. PhotoCapture
 * hands back a plain string[], so without this lookup every remark in the slot
 * would be wiped the moment another photo was added or removed.
 */
function withSlotPhotos(
  sitePhotos: SurveyReport['sitePhotos'],
  slot: string,
  refs: string[],
): SurveyReport['sitePhotos'] {
  const others   = sitePhotos.filter((p) => p.caption !== slot);
  const remarks  = new Map(slotEntries(sitePhotos, slot).map((p) => [p.url, p.remark]));
  return [...others, ...refs.map((url) => ({ url, caption: slot, remark: remarks.get(url) ?? null }))];
}

function withPhotoRemark(
  sitePhotos: SurveyReport['sitePhotos'],
  url: string,
  remark: string | null,
): SurveyReport['sitePhotos'] {
  return sitePhotos.map((p) => (p.url === url ? { ...p, remark } : p));
}

/**
 * Site photographs — Section I. Seven named slots, each a PhotoCapture bound
 * to the subset of sitePhotos[] sharing that slot's name as its caption —
 * grouping this way (rather than a flat gallery) is what lets a reviewer
 * (and the PDF preview) tell which photo is which.
 *
 * Remarks are rendered HERE rather than inside PhotoCapture: that component is
 * shared with the feeder and relay steps, which have no per-photo remark, and
 * widening it would push an unused field into both.
 */
export function StepPhotos({ survey, onChange, readOnly, onReplacePhotoRef }: SurveyStepProps) {
  return (
    <div className="flex flex-col gap-4">
      <h3 className="text-base font-semibold text-gray-900">Site Photographs</h3>

      {SURVEY_PHOTO_SLOTS.map((slot, i) => {
        const entries = slotEntries(survey.sitePhotos, slot);

        return (
          <div key={slot} className="flex flex-col gap-2 p-3 rounded-lg border border-gray-100">
            <div className="flex items-center gap-2">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-gray-100 text-[10px] font-semibold text-gray-500 shrink-0">
                {i + 1}
              </span>
              <span className="text-sm font-medium text-gray-700">
                {slot}
                {i === 0 && <span className="text-brand-red"> *</span>}
              </span>
            </div>
            <PhotoCapture
              photos={entries.map((p) => p.url)}
              onChange={(refs) => onChange({ sitePhotos: withSlotPhotos(survey.sitePhotos, slot, refs) })}
              onReplacePhotoRef={onReplacePhotoRef}
              workOrderId={survey.workOrderId}
              siteCode={survey.siteCode}
              readOnly={readOnly}
            />

            {/* One optional remark per photograph. Always optional — an empty
                remark is a normal outcome and is never a validation issue. */}
            {entries.length > 0 && (
              <div className="flex flex-col gap-2 pt-1">
                {entries.map((photo, n) => (
                  <div key={photo.url} className="flex items-center gap-2">
                    <div className="h-10 w-10 shrink-0 overflow-hidden rounded border border-gray-200">
                      <SurveyPhotoThumb reference={photo.url} className="h-full w-full" />
                    </div>
                    <Input
                      disabled={readOnly}
                      value={photo.remark ?? ''}
                      placeholder={`Remark for photo ${n + 1} (optional)`}
                      onChange={(e) =>
                        onChange({
                          sitePhotos: withPhotoRemark(survey.sitePhotos, photo.url, e.target.value || null),
                        })
                      }
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
