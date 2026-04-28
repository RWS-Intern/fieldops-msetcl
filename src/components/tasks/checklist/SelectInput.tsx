import { cn } from '@/lib/utils';

interface SelectInputProps {
  options: string[];
  value: string | null;
  onChange: (v: string) => void;
  disabled?: boolean;
}

export function SelectInput({ options, value, onChange, disabled }: SelectInputProps) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => (
        <button
          key={opt}
          type="button"
          disabled={disabled}
          onClick={() => onChange(opt)}
          className={cn(
            'rounded-md border px-3 py-1.5 text-sm font-medium transition-colors',
            value === opt
              ? 'bg-brand-blue text-white border-brand-blue'
              : 'border-gray-200 bg-white text-gray-700 hover:bg-blue-50',
            disabled && 'opacity-50 cursor-not-allowed'
          )}
        >
          {opt}
        </button>
      ))}
    </div>
  );
}
