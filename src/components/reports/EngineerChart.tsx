import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import type { EngineerStat } from '@/hooks/useReports';

interface EngineerChartProps {
  data: EngineerStat[];
}

// Custom tooltip showing completed / total / rate
function CustomTooltip({
  active, payload, label,
}: {
  active?: boolean;
  payload?: { value: number; name: string }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const completed = payload.find((p) => p.name === 'completed')?.value ?? 0;
  const total     = payload.find((p) => p.name === 'total')?.value ?? 0;
  const rate      = total > 0 ? Math.round((completed / total) * 100) : 0;

  return (
    <div className="rounded-lg border border-gray-100 bg-white px-3 py-2 shadow-lg text-xs">
      <p className="font-semibold text-gray-800 mb-1">{label}</p>
      <p className="text-teal-600">Completed: {completed}</p>
      <p className="text-brand-blue">Total: {total}</p>
      <p className="text-gray-500 mt-0.5">Rate: {rate}%</p>
    </div>
  );
}

export function EngineerChart({ data }: EngineerChartProps) {
  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-sm text-gray-400">
        No data yet
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
        <XAxis dataKey="name" tick={{ fontSize: 11 }} />
        <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
        <Tooltip content={<CustomTooltip />} />
        <Legend
          formatter={(value) => (
            <span className="text-xs text-gray-600 capitalize">{value}</span>
          )}
        />
        <Bar dataKey="total"     name="total"     fill="#0077B6" radius={[4, 4, 0, 0]} />
        <Bar dataKey="completed" name="completed" fill="#2A9D8F" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
