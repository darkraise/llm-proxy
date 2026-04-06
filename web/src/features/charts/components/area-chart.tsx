import {
  AreaChart as RechartsAreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
} from "recharts"
import { useChartColors } from "../hooks/use-chart-colors"
import { ChartTooltip } from "./chart-tooltip"

interface AreaChartProps {
  data: Record<string, unknown>[]
  xKey: string
  yKeys: string[]
  height?: number
  stacked?: boolean
}

export function AreaChart({
  data,
  xKey,
  yKeys,
  height = 300,
  stacked = false,
}: AreaChartProps) {
  const { series, gridStroke, tickFill } = useChartColors()

  return (
    <ResponsiveContainer width="100%" height={height}>
      <RechartsAreaChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
        <XAxis dataKey={xKey} className="text-xs" tick={{ fill: tickFill }} />
        <YAxis className="text-xs" tick={{ fill: tickFill }} />
        <Tooltip content={<ChartTooltip />} />
        {yKeys.map((key, i) => (
          <Area
            key={key}
            type="monotone"
            dataKey={key}
            stackId={stacked ? "stack" : undefined}
            stroke={series[i % series.length]}
            fill={series[i % series.length]}
            fillOpacity={0.1}
          />
        ))}
      </RechartsAreaChart>
    </ResponsiveContainer>
  )
}
