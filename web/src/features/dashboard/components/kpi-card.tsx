import { Card, CardContent } from "@/core/components/ui/card"
import type { KPICardProps } from "../types"

export function KPICard({
  label,
  value,
  comparison,
  sparklineData,
}: KPICardProps) {
  const max = sparklineData ? Math.max(...sparklineData) : 0
  const min = sparklineData ? Math.min(...sparklineData) : 0
  const range = max - min || 1

  return (
    <Card className="transition-all duration-200 hover:-translate-y-px hover:shadow-md">
      <CardContent className="p-6">
        <p className="text-sm text-muted-foreground">{label}</p>
        <div className="mt-2 flex items-end justify-between">
          <div>
            <p className="text-2xl font-medium">{value}</p>
            {comparison && (
              <p className="text-xs text-muted-foreground">{comparison}</p>
            )}
          </div>
          {sparklineData && sparklineData.length > 1 && (
            <svg
              viewBox={`0 0 ${sparklineData.length * 8} 32`}
              className="h-8 w-20"
            >
              <polyline
                fill="none"
                stroke="hsl(var(--primary))"
                strokeWidth="2"
                points={sparklineData
                  .map(
                    (d, i) => `${i * 8},${32 - ((d - min) / range) * 28 - 2}`,
                  )
                  .join(" ")}
              />
            </svg>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
