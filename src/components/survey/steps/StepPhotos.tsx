import type { SurveyStepProps } from './StepProps';

/** Site photographs — Section I. Fields added in task 3. */
export function StepPhotos({ readOnly }: SurveyStepProps) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-base font-semibold text-gray-900">Site Photographs</h3>
      <p className="text-sm text-gray-400">Section I — fields added in task 3.</p>
      {readOnly && (
        <p className="text-xs text-gray-400 italic">Read-only — this survey cannot be edited right now.</p>
      )}
    </div>
  );
}
