import { Input } from '@/components/ui/input';

interface NumberInputProps {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
}

export function NumberInput({ value, onChange, placeholder, disabled }: NumberInputProps) {
  return (
    <Input
      type="number"
      inputMode="numeric"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
    />
  );
}
