import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell,
} from 'recharts';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SiteCompletionRow {
  siteCode: string;
  rate:     number;   // 0–100
  completed: number;
  total:     number;
}

interface SiteCompletionChartProps {
  data: SiteCompletionRow[];
}

// ─── Tooltip ──────────────────────────────────────────────────────────────────

function CustomTooltip({
  active, payload, label,
}: {
  active?:  boolean;
  payload?: { value: number; payload: SiteCompletionRow }[];
  label?:   string;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <div className="rounded-lg border border-gray-100 bg-white px-3 py-2 shadow-lg text-xs">
      <p className="font-semibold text-gray-800 font-mono mb-1">{label}</p>
      <p className="text-teal-600">Completed: {row.completed}</p>
      <p className="text-brand-blue">Total: {row.total}</p>
      <p className="text-gray-500 mt-0.5">Rate: {row.rate}%</p>
    </div>
  );
}

// ─── Colour helper ────────────────────────────────────────────────────────────

function rateColour(rate: number): string {
  if (rate >= 70) return '#2A9D8F';
  if (rate >= 40) return '#F4A261';
  return '#E63946';
}

// ─── Component ────────────────────────────────────────────────────────────────

export function SiteCompletionChart({ data }: SiteCompletionChartProps) {
  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-sm text-gray-400">
        No data yet
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart
        data={data}
        margin={{ top: 8, right: 8, left: -16, bottom: 0 }}
        layout="vertical"
      >
        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f0f0f0" />
        <XAxis
          type="number"
          domain={[0, 100]}
          tickFormatter={(v) => `${v}%`}
          tick={{ fontSize: 11 }}
        />
        <YAxis
          type="category"
          dataKey="siteCode"
          width={110}
          tick={{ fontSize: 10, fontFamily: 'monospace' }}
        />
        <Tooltip content={<CustomTooltip />} />
        <Bar dataKey="rate" name="Completion %" radius={[0, 4, 4, 0]}>
          {data.map((row, i) => (
            <Cell key={i} fill={rateColour(row.rate)} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
