import { cn } from '@/lib/utils';

interface TriStateToggleProps {
  label: string;
  value: boolean | null;
  onChange: (value: boolean | null) => void;
  readOnly?: boolean;
}

/**
 * Yes / No / not-answered control. `null` must stay visually distinguishable
 * from `false` — "not answered" and "no" mean different things to a
 * reviewer — so the current state is always spelled out as a small badge,
 * not just implied by which button looks pressed. Tapping the
 * already-selected value again resets to `null` (two big tap targets on
 * mobile, rather than a cramped three-way segmented control).
 */
export function TriStateToggle({ label, value, onChange, readOnly }: TriStateToggleProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm text-gray-700">{label}</span>
        <span
          className={cn(
            'text-[10px] font-semibold px-1.5 py-0.5 rounded shrink-0',
            value === true  && 'bg-green-50 text-green-700',
            value === false && 'bg-red-50 text-red-700',
            value == null   && 'bg-gray-100 text-gray-400',
          )}
        >
          {value === true ? 'Yes' : value === false ? 'No' : 'Not answered'}
        </span>
      </div>
      <div className="flex gap-1.5">
        <button
          type="button"
          disabled={readOnly}
          onClick={() => onChange(value === true ? null : true)}
          className={cn(
            'flex-1 h-9 rounded-md text-xs font-medium border transition-colors',
            value === true ? 'bg-green-50 border-green-300 text-green-700' : 'border-gray-200 text-gray-500 hover:bg-gray-50',
            readOnly && 'cursor-not-allowed opacity-60',
          )}
        >
          Yes
        </button>
        <button
          type="button"
          disabled={readOnly}
          onClick={() => onChange(value === false ? null : false)}
          className={cn(
            'flex-1 h-9 rounded-md text-xs font-medium border transition-colors',
            value === false ? 'bg-red-50 border-red-300 text-red-700' : 'border-gray-200 text-gray-500 hover:bg-gray-50',
            readOnly && 'cursor-not-allowed opacity-60',
          )}
        >
          No
        </button>
      </div>
    </div>
  );
}
