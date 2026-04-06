import {
  LineChart as RechartsLineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
} from "recharts"
import { useChartColors } from "../hooks/use-chart-colors"
import { ChartTooltip } from "./chart-tooltip"

interface LineChartProps {
  data: Record<string, unknown>[]
  xKey: string
  yKeys: string[]
  height?: number
}

export function LineChart({ data, xKey, yKeys, height = 300 }: LineChartProps) {
  const { series, gridStroke, tickFill } = useChartColors()

  return (
    <ResponsiveContainer width="100%" height={height}>
      <RechartsLineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
        <XAxis dataKey={xKey} className="text-xs" tick={{ fill: tickFill }} />
        <YAxis className="text-xs" tick={{ fill: tickFill }} />
        <Tooltip content={<ChartTooltip />} />
        {yKeys.map((key, i) => (
          <Line
            key={key}
            type="monotone"
            dataKey={key}
            stroke={series[i % series.length]}
            strokeWidth={2}
            dot={false}
          />
        ))}
      </RechartsLineChart>
    </ResponsiveContainer>
  )
}
