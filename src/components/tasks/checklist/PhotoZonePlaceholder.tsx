import { Camera } from 'lucide-react';

interface PhotoZonePlaceholderProps {
  label?: string;
  required?: boolean;
}

export function PhotoZonePlaceholder({ label, required }: PhotoZonePlaceholderProps) {
  return (
    <div className="mt-1">
      {label && (
        <p className="text-xs text-gray-500 mb-1">{label}</p>
      )}
      <div className="flex h-24 flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-gray-200 bg-gray-50">
        <Camera className="h-5 w-5 text-gray-300" />
        <span className="text-xs text-gray-400">Photo upload — coming soon</span>
        {required && (
          <span className="text-xs text-brand-red font-medium">(Required)</span>
        )}
      </div>
    </div>
  );
}
