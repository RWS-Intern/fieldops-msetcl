import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface StatCardProps {
  label: string;
  count: number;
  colour: string;
  onClick: () => void;
}

export function StatCard({ label, count, colour, onClick }: StatCardProps) {
  return (
    <Card
      onClick={onClick}
      className={cn(
        'relative cursor-pointer overflow-hidden border-l-4 transition-all hover:shadow-md hover:-translate-y-0.5 active:translate-y-0'
      )}
      style={{ borderLeftColor: colour }}
    >
      <div className="p-4">
        <p
          className="text-4xl font-bold leading-none"
          style={{ color: colour }}
        >
          {count}
        </p>
        <p className="mt-1.5 text-sm text-gray-500 font-medium">{label}</p>
      </div>
    </Card>
  );
}
