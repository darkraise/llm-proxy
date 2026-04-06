import type { ReactNode } from "react"

export interface ChartCardProps {
  title: string
  description?: string
  actions?: ReactNode
  children: ReactNode
  className?: string
}
