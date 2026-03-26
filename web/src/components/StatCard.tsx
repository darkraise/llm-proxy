import React from 'react'

interface StatCardProps {
  label: string
  value: string | number
  subtitle?: string
  trend?: 'up' | 'down' | 'neutral'
  trendValue?: string
  icon?: React.ComponentType<{ size?: number | string; className?: string }>
}

export default function StatCard({
  label,
  value,
  subtitle,
  trend,
  trendValue,
  icon: Icon,
}: StatCardProps) {
  const trendColor =
    trend === 'up'
      ? 'text-success'
      : trend === 'down'
        ? 'text-error'
        : 'text-text-muted'

  return (
    <div className="bg-surface border border-border rounded-xl p-4">
      <div className="flex items-center gap-1.5 mb-2">
        {Icon && <Icon size={14} className="text-text-secondary" />}
        <span className="text-xs uppercase tracking-wide text-text-secondary font-medium">
          {label}
        </span>
      </div>
      <p className="text-2xl font-semibold text-text-primary leading-tight">
        {value}
      </p>
      {(subtitle || trendValue) && (
        <div className="flex items-center gap-2 mt-1">
          {trendValue && (
            <span className={`text-xs font-medium ${trendColor}`}>
              {trend === 'up' ? '↑ ' : trend === 'down' ? '↓ ' : ''}
              {trendValue}
            </span>
          )}
          {subtitle && !trendValue && (
            <span className="text-xs text-text-secondary">{subtitle}</span>
          )}
        </div>
      )}
    </div>
  )
}
