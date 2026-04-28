import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import type { TypeCount } from '@/hooks/useReports';

interface TypeChartProps {
  data: TypeCount[];
}

// Truncate long type names for the X-axis tick
function truncate(str: string, n = 12) {
  return str.length > n ? `${str.slice(0, n)}…` : str;
}

export function TypeChart({ data }: TypeChartProps) {
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
        <XAxis
          dataKey="name"
          tick={{ fontSize: 11 }}
          tickFormatter={truncate}
          interval={0}
        />
        <YAxis
          allowDecimals={false}
          tick={{ fontSize: 11 }}
        />
        <Tooltip />
        <Bar dataKey="count" radius={[4, 4, 0, 0]}>
          {data.map((_, i) => (
            <Cell key={i} fill="#0077B6" />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
