import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from 'recharts'
import { RefreshCw } from 'lucide-react'
import {
  api,
  AccountStats,
  ProviderStats,
  ModelStats,
  Account,
  RequestLog,
} from '../lib/api'
import BreakdownTabs from '../components/BreakdownTabs'
import { ToggleSwitch } from '../components/ui/ToggleSwitch'
import { ProviderBadge } from '../components/ui/Badge'
import { StatusDot } from '../components/ui/StatusDot'

// ─── Provider chart colors (hex values extracted from Badge providerColors) ──

const PROVIDER_CHART_COLORS: Record<string, string> = {
  google: '#5b9cf5',
  groq: '#f4932a',
  openrouter: '#6ecfb0',
  cerebras: '#e54b4b',
  mistral: '#ff7a00',
  github: '#c8c8d2',
  cohere: '#395cdf',
  nvidia: '#76b900',
  llm7: '#00c8ff',
  ollama: '#e0e0e8',
  'openai-compatible': '#10a37f',
}

const FALLBACK_COLORS = [
  '#7c5bf0', '#e06c75', '#61afef', '#98c379',
  '#c678dd', '#56b6c2', '#d19a66', '#be5046',
]

function getProviderChartColor(provider: string, idx: number): string {
  return PROVIDER_CHART_COLORS[provider] ?? FALLBACK_COLORS[idx % FALLBACK_COLORS.length]
}

// ─── Date Range ──────────────────────────────────────────────────────────────

type RangePreset = '1h' | '24h' | '7d' | '30d' | '365d' | 'custom'

function computeRange(preset: RangePreset, customFrom: string, customTo: string): { from: string; to: string } {
  const now = new Date()
  const to = now.toISOString()

  if (preset === 'custom') {
    const f = customFrom ? new Date(customFrom + 'T00:00:00').toISOString() : new Date(now.getTime() - 86400000).toISOString()
    const t = customTo ? new Date(customTo + 'T23:59:59').toISOString() : to
    return { from: f, to: t }
  }

  const offsets: Record<string, number> = {
    '1h': 3600000,
    '24h': 86400000,
    '7d': 7 * 86400000,
    '30d': 30 * 86400000,
    '365d': 365 * 86400000,
  }
  return { from: new Date(now.getTime() - offsets[preset]).toISOString(), to }
}

// ─── Bucketing ───────────────────────────────────────────────────────────────

interface ChartBucket {
  label: string
  [provider: string]: string | number
}

function getBucketInterval(preset: RangePreset): number {
  switch (preset) {
    case '1h': return 60 * 1000          // 1 minute
    case '24h': return 3600 * 1000       // 1 hour
    case '7d': return 6 * 3600 * 1000    // 6 hours
    case '30d': return 86400 * 1000      // 1 day
    case '365d': return 86400 * 1000     // 1 day
    case 'custom': return 3600 * 1000    // 1 hour default
  }
}

function formatBucketLabel(date: Date, preset: RangePreset): string {
  switch (preset) {
    case '1h':
      return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`
    case '24h':
      return `${date.getHours().toString().padStart(2, '0')}:00`
    case '7d':
      return `${(date.getMonth() + 1)}/${date.getDate()} ${date.getHours().toString().padStart(2, '0')}h`
    default:
      return `${(date.getMonth() + 1)}/${date.getDate()}`
  }
}

function buildProviderBuckets(
  logs: RequestLog[],
  providers: string[],
  preset: RangePreset,
  fromISO: string,
  toISO: string,
): ChartBucket[] {
  const fromMs = new Date(fromISO).getTime()
  const toMs = new Date(toISO).getTime()
  const interval = getBucketInterval(preset)

  // Create empty buckets
  const bucketMap = new Map<number, ChartBucket>()
  for (let t = fromMs; t <= toMs; t += interval) {
    const d = new Date(t)
    bucketMap.set(t, { label: formatBucketLabel(d, preset) })
  }

  // Fill buckets
  for (const log of logs) {
    const ts = new Date(log.timestamp).getTime()
    // Find the bucket this timestamp belongs to
    const bucketKey = fromMs + Math.floor((ts - fromMs) / interval) * interval
    const bucket = bucketMap.get(bucketKey)
    if (bucket) {
      const prov = log.provider_type || 'unknown'
      bucket[prov] = ((bucket[prov] as number) || 0) + 1
    }
  }

  // Ensure all providers have 0 in all buckets
  const result = Array.from(bucketMap.values())
  for (const bucket of result) {
    for (const p of providers) {
      if (!(p in bucket)) bucket[p] = 0
    }
  }

  return result
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toString()
}

const TICK_STYLE = { fill: '#8b949e', fontSize: 11 }

// ─── Component ───────────────────────────────────────────────────────────────

export default function Dashboard() {
  const [accountStats, setAccountStats] = useState<AccountStats[]>([])
  const [providerStats, setProviderStats] = useState<ProviderStats[]>([])
  const [modelStats, setModelStats] = useState<ModelStats[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [requestLogs, setRequestLogs] = useState<RequestLog[]>([])
  const [autoRefresh, setAutoRefresh] = useState(false)
  const [selectedProvider, setSelectedProvider] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  // Date range state
  const [rangePreset, setRangePreset] = useState<RangePreset>('24h')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')

  // Chart legend toggles
  const [hiddenProviders, setHiddenProviders] = useState<Set<string>>(new Set())

  const { from, to } = useMemo(
    () => computeRange(rangePreset, customFrom, customTo),
    [rangePreset, customFrom, customTo],
  )

  const fetchAll = useCallback(async () => {
    try {
      const [as, ps, ms, accts, logs] = await Promise.all([
        api.stats.accounts(from, to),
        api.stats.providers(from, to),
        api.stats.models(selectedProvider || undefined, from, to),
        api.accounts.list(),
        api.stats.requests({ from, to, limit: 200 }),
      ])
      setAccountStats(as ?? [])
      setProviderStats(ps ?? [])
      setModelStats(ms ?? [])
      setAccounts(accts ?? [])
      setRequestLogs(logs.data ?? [])
      setError('')
    } catch {
      setError('Failed to load dashboard data.')
    } finally {
      setLoading(false)
    }
  }, [from, to, selectedProvider])

  useEffect(() => {
    fetchAll()
  }, [fetchAll])

  useEffect(() => {
    if (!autoRefresh) return
    const id = setInterval(fetchAll, 5000)
    return () => clearInterval(id)
  }, [autoRefresh, fetchAll])

  const handleProviderFilter = useCallback((provider: string) => {
    setSelectedProvider(provider)
  }, [])

  // Derive unique providers from request logs for chart
  const chartProviders = useMemo(() => {
    const set = new Set<string>()
    for (const log of requestLogs) {
      if (log.provider_type) set.add(log.provider_type)
    }
    // Also include providers from stats to ensure consistency
    for (const ps of providerStats) {
      set.add(ps.provider)
    }
    return Array.from(set).sort()
  }, [requestLogs, providerStats])

  // Build chart data
  const chartData = useMemo(
    () => buildProviderBuckets(requestLogs, chartProviders, rangePreset, from, to),
    [requestLogs, chartProviders, rangePreset, from, to],
  )

  // Compute tick interval for chart
  const chartTickInterval = useMemo(() => {
    const len = chartData.length
    if (len <= 24) return 0
    if (len <= 48) return 1
    if (len <= 96) return 3
    return Math.floor(len / 20)
  }, [chartData])

  // Provider summary: group accounts by provider type
  const providerSummary = useMemo(() => {
    const grouped: Record<string, { total: number; active: number }> = {}
    for (const acct of accounts) {
      if (!grouped[acct.type]) grouped[acct.type] = { total: 0, active: 0 }
      grouped[acct.type].total++
      if (acct.enabled && acct.status?.available !== false) {
        grouped[acct.type].active++
      }
    }
    return Object.entries(grouped)
      .map(([provider, counts]) => ({ provider, ...counts }))
      .sort((a, b) => a.provider.localeCompare(b.provider))
  }, [accounts])

  // Toggle chart legend
  function toggleProvider(provider: string) {
    setHiddenProviders((prev) => {
      const next = new Set(prev)
      if (next.has(provider)) next.delete(provider)
      else next.add(provider)
      return next
    })
  }

  const presets: { key: RangePreset; label: string }[] = [
    { key: '1h', label: '1h' },
    { key: '24h', label: '24h' },
    { key: '7d', label: '7d' },
    { key: '30d', label: '30d' },
    { key: '365d', label: '365d' },
    { key: 'custom', label: 'Custom' },
  ]

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw size={20} className="animate-spin text-text-muted" />
      </div>
    )
  }

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-text-primary">Dashboard</h1>
          <p className="text-sm text-text-secondary mt-0.5">
            Overview of your LLM proxy
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {/* Date Range Selector */}
          <div className="flex items-center bg-[rgba(255,255,255,0.04)] border border-border rounded-lg overflow-hidden">
            {presets.map((p) => (
              <button
                key={p.key}
                onClick={() => setRangePreset(p.key)}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                  rangePreset === p.key
                    ? 'bg-accent-muted text-accent-light'
                    : 'text-text-secondary hover:text-text-primary'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* Custom date inputs */}
          {rangePreset === 'custom' && (
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="bg-surface border border-border rounded-md px-2 py-1 text-xs text-text-primary"
              />
              <span className="text-xs text-text-muted">to</span>
              <input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className="bg-surface border border-border rounded-md px-2 py-1 text-xs text-text-primary"
              />
            </div>
          )}

          {/* Auto-refresh */}
          <div className="flex items-center gap-2 bg-[rgba(255,255,255,0.04)] border border-border rounded-lg px-3 py-1.5">
            <RefreshCw size={12} className="text-text-secondary" />
            <span className="text-xs text-text-secondary">Auto-refresh</span>
            <ToggleSwitch checked={autoRefresh} onChange={setAutoRefresh} />
          </div>
        </div>
      </div>

      {error && (
        <div className="text-error bg-error/10 border border-error/30 rounded-md px-3 py-2 text-sm">
          {error}
        </div>
      )}

      {/* Per-Provider Stats Table + Provider Summary */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {/* Per-Provider Stats Table */}
        <div className="bg-surface border border-border rounded-xl p-4 lg:col-span-2 overflow-x-auto">
          <p className="text-sm font-medium text-text-primary mb-3">
            Provider Stats
          </p>
          {providerStats.length === 0 ? (
            <p className="text-text-muted text-xs text-center py-6">No data yet</p>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-text-secondary border-b border-border">
                  <th className="text-left py-2 pr-3 font-medium">Provider</th>
                  <th className="text-right py-2 px-3 font-medium">Requests</th>
                  <th className="text-right py-2 px-3 font-medium">Tokens</th>
                  <th className="text-right py-2 px-3 font-medium">Errors</th>
                  <th className="text-right py-2 px-3 font-medium">Avg Latency</th>
                  <th className="text-right py-2 pl-3 font-medium">Accounts</th>
                </tr>
              </thead>
              <tbody>
                {providerStats.map((ps) => {
                  const summary = providerSummary.find((s) => s.provider === ps.provider)
                  return (
                    <tr key={ps.provider} className="border-b border-border-muted last:border-0">
                      <td className="py-2 pr-3">
                        <ProviderBadge provider={ps.provider} />
                      </td>
                      <td className="text-right py-2 px-3 text-text-primary tabular-nums">
                        {ps.total_requests.toLocaleString()}
                      </td>
                      <td className="text-right py-2 px-3 text-text-primary tabular-nums">
                        {formatCompact(ps.total_tokens)}
                      </td>
                      <td className="text-right py-2 px-3 tabular-nums">
                        <span className={ps.error_count > 0 ? 'text-error' : 'text-text-muted'}>
                          {ps.error_count.toLocaleString()}
                        </span>
                      </td>
                      <td className="text-right py-2 px-3 text-text-primary tabular-nums">
                        {ps.avg_latency_ms > 0 ? `${ps.avg_latency_ms.toFixed(0)}ms` : '\u2014'}
                      </td>
                      <td className="text-right py-2 pl-3 text-text-secondary tabular-nums">
                        {summary ? `${summary.active}/${summary.total} active` : '\u2014'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Provider Account Summary */}
        <div className="bg-surface border border-border rounded-xl p-4 flex flex-col">
          <p className="text-sm font-medium text-text-primary mb-3 flex-shrink-0">
            Provider Status
          </p>
          {providerSummary.length === 0 ? (
            <p className="text-text-muted text-xs text-center py-8">
              No accounts configured
            </p>
          ) : (
            <div className="space-y-2.5 overflow-y-auto flex-1" style={{ maxHeight: '220px' }}>
              {providerSummary.map((ps) => {
                const status: 'healthy' | 'rate-limited' | 'error' | 'disabled' =
                  ps.active === ps.total
                    ? 'healthy'
                    : ps.active > 0
                      ? 'rate-limited'
                      : 'disabled'
                return (
                  <div key={ps.provider} className="flex items-center gap-2.5 py-1.5">
                    <StatusDot status={status} />
                    <ProviderBadge provider={ps.provider} />
                    <span className="flex-1" />
                    <span className="text-xs text-text-secondary tabular-nums flex-shrink-0">
                      {ps.active}/{ps.total} active
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Request Volume Chart — Full Width */}
      <div className="bg-surface border border-border rounded-xl p-4">
        <p className="text-sm font-medium text-text-primary mb-3">
          Request Volume
        </p>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={chartData} barSize={rangePreset === '1h' ? 6 : 10}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
            <XAxis
              dataKey="label"
              tick={TICK_STYLE}
              tickLine={false}
              axisLine={false}
              interval={chartTickInterval}
            />
            <YAxis
              tick={TICK_STYLE}
              tickLine={false}
              axisLine={false}
              width={32}
              allowDecimals={false}
            />
            <Tooltip
              contentStyle={{
                background: '#161b22',
                border: '1px solid #30363d',
                borderRadius: 6,
                color: '#e1e4e8',
                fontSize: 12,
              }}
              cursor={{ fill: 'rgba(255,255,255,0.04)' }}
            />
            <Legend content={() => null} />
            {chartProviders.map((provider, idx) =>
              hiddenProviders.has(provider) ? null : (
                <Bar
                  key={provider}
                  dataKey={provider}
                  stackId="a"
                  fill={getProviderChartColor(provider, idx)}
                  radius={idx === chartProviders.filter(p => !hiddenProviders.has(p)).length - 1 ? [3, 3, 0, 0] : [0, 0, 0, 0]}
                />
              ),
            )}
          </BarChart>
        </ResponsiveContainer>

        {/* Custom Legend Toggles */}
        {chartProviders.length > 0 && (
          <div className="flex items-center gap-3 mt-3 flex-wrap">
            {chartProviders.map((provider, idx) => (
              <button
                key={provider}
                onClick={() => toggleProvider(provider)}
                className={`flex items-center gap-1.5 text-xs transition-opacity ${
                  hiddenProviders.has(provider) ? 'opacity-40' : 'opacity-100'
                }`}
              >
                <span
                  className="w-2.5 h-2.5 rounded-sm flex-shrink-0"
                  style={{ backgroundColor: getProviderChartColor(provider, idx) }}
                />
                <span className="text-text-secondary">{provider}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Breakdown Tabs */}
      <div className="bg-surface border border-border rounded-xl p-4">
        <BreakdownTabs
          providerStats={providerStats}
          accountStats={accountStats.map((a) => ({
            account_name: a.account_name,
            total_requests: a.total_requests,
          }))}
          modelStats={modelStats}
          onProviderFilter={handleProviderFilter}
          selectedProvider={selectedProvider}
        />
      </div>
    </div>
  )
}
