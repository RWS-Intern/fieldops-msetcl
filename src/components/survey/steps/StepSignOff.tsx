import type { SurveyStepProps } from './StepProps';

/** Joint sign-off & submit. Fields added in task 3. */
export function StepSignOff({ readOnly }: SurveyStepProps) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-base font-semibold text-gray-900">Joint Sign-Off &amp; Submit</h3>
      <p className="text-sm text-gray-400">Fields added in task 3.</p>
      {readOnly && (
        <p className="text-xs text-gray-400 italic">Read-only — this survey cannot be edited right now.</p>
      )}
    </div>
  );
}
