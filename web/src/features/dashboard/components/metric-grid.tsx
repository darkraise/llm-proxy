import { cn } from "darkraise-ui/lib"
import type { ReactNode } from "react"

interface MetricGridProps {
  children: ReactNode
  columns?: 2 | 3 | 4
  className?: string
}

export function MetricGrid({
  children,
  columns = 4,
  className,
}: MetricGridProps) {
  return (
    <div
      className={cn(
        "grid gap-4",
        columns === 2 && "md:grid-cols-2",
        columns === 3 && "md:grid-cols-2 lg:grid-cols-3",
        columns === 4 && "md:grid-cols-2 lg:grid-cols-4",
        className,
      )}
    >
      {children}
    </div>
  )
}
