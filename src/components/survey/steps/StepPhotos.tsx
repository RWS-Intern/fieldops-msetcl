import { SURVEY_PHOTO_SLOTS } from '@/lib/surveyValidation';
import { PhotoCapture } from '@/components/survey/PhotoCapture';
import type { SurveyStepProps } from './StepProps';
import type { SurveyReport } from '@/types';

function getSlotPhotos(sitePhotos: SurveyReport['sitePhotos'], slot: string): string[] {
  return sitePhotos.filter((p) => p.caption === slot).map((p) => p.url);
}

/** Replaces all entries for one slot with a new set of references, leaving other slots untouched. */
function withSlotPhotos(
  sitePhotos: SurveyReport['sitePhotos'],
  slot: string,
  refs: string[],
): SurveyReport['sitePhotos'] {
  const others = sitePhotos.filter((p) => p.caption !== slot);
  return [...others, ...refs.map((url) => ({ url, caption: slot }))];
}

/**
 * Site photographs — Section I. Seven named slots, each a PhotoCapture bound
 * to the subset of sitePhotos[] sharing that slot's name as its caption —
 * grouping this way (rather than a flat gallery) is what lets a reviewer
 * (and the 3c PDF generator) tell which photo is which.
 */
export function StepPhotos({ survey, onChange, readOnly, onReplacePhotoRef }: SurveyStepProps) {
  return (
    <div className="flex flex-col gap-4">
      <h3 className="text-base font-semibold text-gray-900">Site Photographs</h3>

      {SURVEY_PHOTO_SLOTS.map((slot, i) => (
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
            photos={getSlotPhotos(survey.sitePhotos, slot)}
            onChange={(refs) => onChange({ sitePhotos: withSlotPhotos(survey.sitePhotos, slot, refs) })}
            onReplacePhotoRef={onReplacePhotoRef}
            workOrderId={survey.workOrderId}
            siteCode={survey.siteCode}
            readOnly={readOnly}
          />
        </div>
      ))}
    </div>
  );
}
