import { TrendingDown, TrendingUp } from "lucide-react"
import { Card, CardContent } from "@/core/components/ui/card"
import { cn } from "@/core/lib/utils"
import type { StatCardProps } from "../types"

export function StatCard({ label, value, icon: Icon, trend }: StatCardProps) {
  return (
    <Card className="transition-all duration-200 hover:-translate-y-px hover:shadow-md">
      <CardContent className="p-6">
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">{label}</p>
          {Icon && <Icon className="h-4 w-4 text-muted-foreground" />}
        </div>
        <p className="mt-2 text-2xl font-medium">{value}</p>
        {trend && (
          <div className="mt-1 flex items-center gap-1 text-xs">
            {trend.isPositive ? (
              <TrendingUp className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
            ) : (
              <TrendingDown className="h-3 w-3 text-red-600 dark:text-red-400" />
            )}
            <span
              className={cn(
                trend.isPositive
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-red-600 dark:text-red-400",
              )}
            >
              {trend.value}%
            </span>
            <span className="text-muted-foreground">from last period</span>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
