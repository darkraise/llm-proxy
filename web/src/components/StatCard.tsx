interface StatCardProps {
  label: string
  value: string | number
  subtitle?: string
  trend?: 'up' | 'down' | 'neutral'
  trendValue?: string
  accent?: boolean
}

export default function StatCard({
  label,
  value,
  subtitle,
  trend,
  trendValue,
  accent,
}: StatCardProps) {
  return (
    <div className={`card p-4 ${accent ? 'border-accent/30' : ''}`}>
      <p className="label">{label}</p>
      <p className="text-2xl font-bold text-text-primary mt-1">{value}</p>
      {(subtitle || trendValue) && (
        <div className="flex items-center gap-2 mt-1">
          {trendValue && (
            <span
              className={`text-xs font-medium ${
                trend === 'up'
                  ? 'text-success'
                  : trend === 'down'
                    ? 'text-error'
                    : 'text-text-muted'
              }`}
            >
              {trend === 'up' ? '↑' : trend === 'down' ? '↓' : ''}
              {trendValue}
            </span>
          )}
          {subtitle && (
            <span className="text-xs text-text-muted">{subtitle}</span>
          )}
        </div>
      )}
    </div>
  )
}
