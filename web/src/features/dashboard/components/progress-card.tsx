import { Card, CardContent } from "@/core/components/ui/card"
import type { ProgressCardProps } from "../types"

export function ProgressCard({
  label,
  value,
  target,
  unit = "",
}: ProgressCardProps) {
  const percentage = Math.min((value / target) * 100, 100)

  return (
    <Card>
      <CardContent className="p-6">
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="text-xs text-muted-foreground">
            {value}
            {unit} / {target}
            {unit}
          </p>
        </div>
        <div className="mt-3 h-2 w-full rounded-full bg-secondary">
          <div
            className="h-2 rounded-full bg-primary transition-all duration-300"
            style={{ width: `${percentage}%` }}
          />
        </div>
      </CardContent>
    </Card>
  )
}
