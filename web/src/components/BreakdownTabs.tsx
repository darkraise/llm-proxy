import { useState } from 'react'
import { ModelName } from './ui/ModelName'

interface BreakdownTabsProps {
  providerStats: Array<{
    provider: string
    total_requests: number
    total_tokens: number
    error_count: number
  }>
  accountStats: Array<{
    account_name: string
    total_requests: number
  }>
  modelStats: Array<{
    model: string
    total_requests: number
    total_tokens: number
  }>
  onProviderFilter: (provider: string) => void
  selectedProvider: string
}

type Tab = 'provider' | 'account' | 'model'

function ProgressBar({
  name,
  value,
  max,
  secondary,
  isModel,
}: {
  name: string
  value: number
  max: number
  secondary?: string
  isModel?: boolean
}) {
  const pct = max > 0 ? (value / max) * 100 : 0

  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-text-secondary w-28 truncate flex-shrink-0">
        {isModel ? <ModelName name={name} className="text-xs" /> : name}
      </span>
      <div className="flex-1 h-2 rounded bg-[rgba(255,255,255,0.06)] overflow-hidden">
        <div
          className="h-full rounded bg-accent transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs text-text-muted w-20 text-right flex-shrink-0">
        {value.toLocaleString()}
        {secondary && (
          <span className="text-text-muted/60 ml-1">{secondary}</span>
        )}
      </span>
    </div>
  )
}

export default function BreakdownTabs({
  providerStats,
  accountStats,
  modelStats,
  onProviderFilter,
  selectedProvider,
}: BreakdownTabsProps) {
  const [tab, setTab] = useState<Tab>('provider')

  const tabs: { key: Tab; label: string }[] = [
    { key: 'provider', label: 'By Provider' },
    { key: 'account', label: 'By Account' },
    { key: 'model', label: 'By Model' },
  ]

  const providers = providerStats.map((p) => p.provider)

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-1">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={
                tab === t.key
                  ? 'text-accent-light bg-accent-muted rounded-md px-3 py-1.5 text-xs font-medium'
                  : 'text-text-secondary px-3 py-1.5 text-xs font-medium hover:text-text-primary transition-colors'
              }
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'model' && (
          <select
            value={selectedProvider}
            onChange={(e) => onProviderFilter(e.target.value)}
            className="text-xs bg-surface border border-border rounded-md px-2 py-1 text-text-secondary focus:outline-none focus:border-accent"
          >
            <option value="">All Providers</option>
            {providers.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="space-y-2.5">
        {tab === 'provider' && renderProvider()}
        {tab === 'account' && renderAccount()}
        {tab === 'model' && renderModel()}
      </div>
    </div>
  )

  function renderProvider() {
    if (providerStats.length === 0) return <EmptyState />
    const max = Math.max(...providerStats.map((p) => p.total_requests))
    return providerStats.map((p) => (
      <ProgressBar
        key={p.provider}
        name={p.provider}
        value={p.total_requests}
        max={max}
        secondary={p.error_count > 0 ? `${p.error_count} err` : undefined}
      />
    ))
  }

  function renderAccount() {
    if (accountStats.length === 0) return <EmptyState />
    const max = Math.max(...accountStats.map((a) => a.total_requests))
    return accountStats.map((a) => (
      <ProgressBar
        key={a.account_name}
        name={a.account_name}
        value={a.total_requests}
        max={max}
      />
    ))
  }

  function renderModel() {
    if (modelStats.length === 0) return <EmptyState />
    const max = Math.max(...modelStats.map((m) => m.total_requests))
    return modelStats.map((m) => (
      <ProgressBar
        key={m.model}
        name={m.model}
        value={m.total_requests}
        max={max}
        isModel
      />
    ))
  }
}

function EmptyState() {
  return (
    <p className="text-text-muted text-xs text-center py-6">No data yet</p>
  )
}
