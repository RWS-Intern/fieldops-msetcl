import { cn } from '@/lib/utils';
import { YesNoInput } from './YesNoInput';
import { SelectInput } from './SelectInput';
import { TextInput } from './TextInput';
import { NumberInput } from './NumberInput';
import { PhotoZonePlaceholder } from './PhotoZonePlaceholder';
import type { SubtaskDefinition } from '@/types';

interface ChecklistItemProps {
  subtask: SubtaskDefinition;
  answer: string | null;
  onAnswerChange: (subtaskId: string, value: string) => void;
  showError: boolean;
}

export function ChecklistItem({
  subtask,
  answer,
  onAnswerChange,
  showError,
}: ChecklistItemProps) {
  const hasAnswer = answer !== null && answer !== '';
  const isErrorState = showError && subtask.isRequired && !hasAnswer;

  const borderColour = hasAnswer
    ? 'border-l-green-500'
    : isErrorState
    ? 'border-l-brand-red'
    : 'border-l-gray-200';

  return (
    <div className={cn('rounded-lg border border-gray-100 bg-white p-3 border-l-4', borderColour)}>
      <p className="text-sm font-medium text-gray-800 mb-2">
        {subtask.label}
        {subtask.isRequired && (
          <span className="text-brand-red ml-1" aria-hidden>*</span>
        )}
      </p>

      {/* Input widget */}
      {subtask.collectionType === 'yesno' && (
        <YesNoInput
          value={answer}
          onChange={(v) => onAnswerChange(subtask.subtaskId, v)}
        />
      )}
      {subtask.collectionType === 'select' && (
        <SelectInput
          options={subtask.options ?? []}
          value={answer}
          onChange={(v) => onAnswerChange(subtask.subtaskId, v)}
        />
      )}
      {subtask.collectionType === 'text' && (
        <TextInput
          value={answer ?? ''}
          onChange={(v) => onAnswerChange(subtask.subtaskId, v)}
          placeholder="Enter value…"
        />
      )}
      {subtask.collectionType === 'number' && (
        <NumberInput
          value={answer ?? ''}
          onChange={(v) => onAnswerChange(subtask.subtaskId, v)}
          placeholder="0"
        />
      )}
      {subtask.collectionType === 'image_only' && (
        <PhotoZonePlaceholder required={subtask.isRequired} />
      )}

      {/* Photo zone for imageRequired subtasks (non image_only) */}
      {subtask.imageRequired && subtask.collectionType !== 'image_only' && (
        <PhotoZonePlaceholder label="Required photo for this step" required />
      )}

      {/* Error hint */}
      {isErrorState && subtask.collectionType !== 'image_only' && (
        <p className="mt-1 text-xs text-brand-red">This field is required</p>
      )}
    </div>
  );
}
