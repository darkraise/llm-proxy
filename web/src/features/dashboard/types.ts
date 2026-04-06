import type { LucideIcon } from "lucide-react"

export interface StatCardProps {
  label: string
  value: string | number
  icon?: LucideIcon
  trend?: { value: number; isPositive: boolean }
}

export interface KPICardProps {
  label: string
  value: string | number
  comparison?: string
  sparklineData?: number[]
}

export interface ActivityItem {
  id: string
  user: { name: string; avatar?: string }
  action: string
  timestamp: string
}

export interface ProgressCardProps {
  label: string
  value: number
  target: number
  unit?: string
}
