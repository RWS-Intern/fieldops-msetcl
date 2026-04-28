import {
  PieChart, Pie, Cell, Legend,
  Tooltip, ResponsiveContainer,
} from 'recharts';
import type { StatusCount } from '@/hooks/useReports';

interface StatusChartProps {
  data: StatusCount[];
}

export function StatusChart({ data }: StatusChartProps) {
  const total   = data.reduce((s, d) => s + d.value, 0);
  const hasData = total > 0;

  if (!hasData) {
    return (
      <div className="flex items-center justify-center h-64 text-sm text-gray-400">
        No data yet
      </div>
    );
  }

  return (
    <div className="relative">
      <ResponsiveContainer width="100%" height={280}>
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            innerRadius={60}
            outerRadius={100}
            paddingAngle={2}
          >
            {data.map((entry, i) => (
              <Cell key={i} fill={entry.colour} />
            ))}
          </Pie>
          <Tooltip />
          <Legend
            formatter={(value) => (
              <span className="text-xs text-gray-600">{value}</span>
            )}
          />
        </PieChart>
      </ResponsiveContainer>

      {/* Centre total label — positioned over the doughnut hole */}
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none pb-8">
        <span className="text-2xl font-bold text-gray-900">{total}</span>
        <span className="text-xs text-gray-400">tasks</span>
      </div>
    </div>
  );
}
