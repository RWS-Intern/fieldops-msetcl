import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell,
} from 'recharts';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CityCount {
  city:  string;
  count: number;
}

interface CityChartProps {
  data: CityCount[];
}

// ─── Tooltip ──────────────────────────────────────────────────────────────────

function CustomTooltip({
  active, payload, label,
}: {
  active?:  boolean;
  payload?: { value: number }[];
  label?:   string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-gray-100 bg-white px-3 py-2 shadow-lg text-xs">
      <p className="font-semibold text-gray-800 mb-1">{label}</p>
      <p className="text-brand-blue">{payload[0].value} site{payload[0].value !== 1 ? 's' : ''}</p>
    </div>
  );
}

// ─── Colour palette ───────────────────────────────────────────────────────────

const PALETTE = [
  '#0077B6', '#2A9D8F', '#F4A261', '#7C3AED',
  '#E63946', '#457B9D', '#06B6D4', '#84CC16',
  '#F59E0B', '#EC4899',
];

// ─── Component ────────────────────────────────────────────────────────────────

export function CityChart({ data }: CityChartProps) {
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
        <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
        <YAxis
          type="category"
          dataKey="city"
          width={100}
          tick={{ fontSize: 11 }}
        />
        <Tooltip content={<CustomTooltip />} />
        <Bar dataKey="count" name="Sites" radius={[0, 4, 4, 0]}>
          {data.map((_, i) => (
            <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
