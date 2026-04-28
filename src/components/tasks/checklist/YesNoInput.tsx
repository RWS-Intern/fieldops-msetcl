import { cn } from '@/lib/utils';

interface YesNoInputProps {
  value: string | null;
  onChange: (v: string) => void;
  disabled?: boolean;
}

const OPTIONS = [
  { key: 'yes', label: 'Yes', selected: 'bg-green-600 text-white border-green-600', hover: 'hover:bg-green-50' },
  { key: 'no',  label: 'No',  selected: 'bg-brand-red text-white border-brand-red',  hover: 'hover:bg-red-50' },
  { key: 'na',  label: 'N/A', selected: 'bg-gray-400 text-white border-gray-400',    hover: 'hover:bg-gray-100' },
];

export function YesNoInput({ value, onChange, disabled }: YesNoInputProps) {
  return (
    <div className="flex gap-2">
      {OPTIONS.map(({ key, label, selected, hover }) => (
        <button
          key={key}
          type="button"
          disabled={disabled}
          onClick={() => onChange(key)}
          className={cn(
            'flex-1 rounded-md border px-2 py-1.5 text-sm font-medium transition-colors',
            value === key
              ? selected
              : `border-gray-200 bg-white text-gray-700 ${hover}`,
            disabled && 'opacity-50 cursor-not-allowed'
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
