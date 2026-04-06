import {
  PieChart as RechartsPieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
  Legend,
} from "recharts"
import { useChartColors } from "../hooks/use-chart-colors"
import { ChartTooltip } from "./chart-tooltip"

interface PieChartProps {
  data: Array<{ name: string; value: number }>
  height?: number
  innerRadius?: number
}

export function PieChart({
  data,
  height = 300,
  innerRadius = 0,
}: PieChartProps) {
  const { series } = useChartColors()

  return (
    <ResponsiveContainer width="100%" height={height}>
      <RechartsPieChart>
        <Pie
          data={data}
          cx="50%"
          cy="50%"
          innerRadius={innerRadius}
          outerRadius={80}
          dataKey="value"
          nameKey="name"
        >
          {data.map((_, i) => (
            <Cell key={i} fill={series[i % series.length]} />
          ))}
        </Pie>
        <Tooltip content={<ChartTooltip />} />
        <Legend />
      </RechartsPieChart>
    </ResponsiveContainer>
  )
}
