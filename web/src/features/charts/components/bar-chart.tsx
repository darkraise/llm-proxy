import {
  BarChart as RechartsBarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
} from "recharts"
import { useChartColors } from "../hooks/use-chart-colors"
import { ChartTooltip } from "./chart-tooltip"

interface BarChartProps {
  data: Record<string, unknown>[]
  xKey: string
  yKeys: string[]
  height?: number
  stacked?: boolean
}

export function BarChart({
  data,
  xKey,
  yKeys,
  height = 300,
  stacked = false,
}: BarChartProps) {
  const { series, gridStroke, tickFill } = useChartColors()

  return (
    <ResponsiveContainer width="100%" height={height}>
      <RechartsBarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
        <XAxis dataKey={xKey} className="text-xs" tick={{ fill: tickFill }} />
        <YAxis className="text-xs" tick={{ fill: tickFill }} />
        <Tooltip content={<ChartTooltip />} />
        {yKeys.map((key, i) => (
          <Bar
            key={key}
            dataKey={key}
            stackId={stacked ? "stack" : undefined}
            fill={series[i % series.length]}
            radius={[4, 4, 0, 0]}
          />
        ))}
      </RechartsBarChart>
    </ResponsiveContainer>
  )
}
