import { useCallback, useEffect, useState } from 'react'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import { Activity, Coins, AlertCircle, RefreshCw } from 'lucide-react'
import {
  api,
  OverviewStats,
  AccountStats,
  ProviderStats,
  ModelStats,
  Account,
} from '../lib/api'
import StatCard from '../components/StatCard'
import BreakdownTabs from '../components/BreakdownTabs'
import { ToggleSwitch } from '../components/ui/ToggleSwitch'
import { StatusDot } from '../components/ui/StatusDot'

// ─── Helpers ────────────────────────────────────────────────────────────────

interface HourBucket {
  hour: string
  requests: number
}

function buildHourlyBuckets(logs: { timestamp: string }[]): HourBucket[] {
  const now = new Date()
  const buckets: Record<string, number> = {}

  for (let i = 23; i >= 0; i--) {
    const d = new Date(now)
    d.setHours(d.getHours() - i, 0, 0, 0)
    const key = d.getHours().toString().padStart(2, '0') + ':00'
    buckets[key] = 0
  }

  for (const log of logs) {
    const d = new Date(log.timestamp)
    const key = d.getHours().toString().padStart(2, '0') + ':00'
    if (key in buckets) {
      buckets[key]++
    }
  }

  return Object.entries(buckets).map(([hour, requests]) => ({ hour, requests }))
}

function formatCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toString()
}

function calcTrend(
  current: number,
  yesterday: number,
): { direction: 'up' | 'down' | 'neutral'; value: string } {
  if (yesterday === 0) return { direction: 'neutral', value: '' }
  const pct = ((current - yesterday) / yesterday) * 100
  return {
    direction: pct > 0 ? 'up' : pct < 0 ? 'down' : 'neutral',
    value: `${pct > 0 ? '+' : ''}${pct.toFixed(0)}% vs yesterday`,
  }
}

function getAccountStatus(
  account: Account,
): 'healthy' | 'rate-limited' | 'error' | 'disabled' {
  if (!account.enabled) return 'disabled'
  if (account.status?.reason?.includes('exhausted')) return 'rate-limited'
  if (account.status?.available === false) return 'error'
  return 'healthy'
}

const statusLabel: Record<string, string> = {
  healthy: 'Healthy',
  'rate-limited': 'Rate limited',
  error: 'Error',
  disabled: 'Disabled',
}

const TICK_STYLE = { fill: '#8b949e', fontSize: 11 }

// ─── Component ──────────────────────────────────────────────────────────────

export default function Dashboard() {
  const [overview, setOverview] = useState<OverviewStats | null>(null)
  const [accountStats, setAccountStats] = useState<AccountStats[]>([])
  const [providerStats, setProviderStats] = useState<ProviderStats[]>([])
  const [modelStats, setModelStats] = useState<ModelStats[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [hourlyData, setHourlyData] = useState<HourBucket[]>([])
  const [autoRefresh, setAutoRefresh] = useState(false)
  const [selectedProvider, setSelectedProvider] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const fetchAll = useCallback(async () => {
    try {
      const [ov, as, ps, ms, accts, logs] = await Promise.all([
        api.stats.overview(),
        api.stats.accounts(),
        api.stats.providers(),
        api.stats.models(selectedProvider || undefined),
        api.accounts.list(),
        api.stats.requests({ limit: 500 }),
      ])
      setOverview(ov)
      setAccountStats(as ?? [])
      setProviderStats(ps ?? [])
      setModelStats(ms ?? [])
      setAccounts(accts ?? [])
      setHourlyData(buildHourlyBuckets(logs.data ?? []))
      setError('')
    } catch {
      setError('Failed to load dashboard data.')
    } finally {
      setLoading(false)
    }
  }, [selectedProvider])

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

  // Trends
  const requestTrend = overview
    ? calcTrend(overview.total_requests, overview.yesterday_requests)
    : { direction: 'neutral' as const, value: '' }

  const latencyTrend = overview
    ? calcTrend(overview.avg_latency_ms, overview.yesterday_avg_latency_ms)
    : { direction: 'neutral' as const, value: '' }

  const errorRate =
    overview && overview.total_requests > 0
      ? ((overview.error_count / overview.total_requests) * 100).toFixed(1)
      : '0'

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
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-[20px] font-semibold text-text-primary">
            Dashboard
          </h1>
          <p className="text-[13px] text-text-secondary mt-0.5">
            Overview of your LLM proxy
          </p>
        </div>
        <div className="flex items-center gap-2 bg-[rgba(255,255,255,0.04)] border border-border rounded-lg px-3 py-1.5">
          <RefreshCw size={12} className="text-text-secondary" />
          <span className="text-xs text-text-secondary">Auto-refresh</span>
          <ToggleSwitch checked={autoRefresh} onChange={setAutoRefresh} />
        </div>
      </div>

      {error && (
        <div className="text-error bg-error/10 border border-error/30 rounded-md px-3 py-2 text-sm">
          {error}
        </div>
      )}

      {/* Stats Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          label="Requests"
          icon={Activity}
          value={overview?.total_requests ?? 0}
          trend={requestTrend.direction}
          trendValue={requestTrend.value}
        />
        <StatCard
          label="Tokens"
          icon={Coins}
          value={formatCompact(overview?.total_tokens ?? 0)}
          subtitle={`${formatCompact(overview?.prompt_tokens ?? 0)} in / ${formatCompact(overview?.completion_tokens ?? 0)} out`}
        />
        <StatCard
          label="Errors"
          icon={AlertCircle}
          value={overview?.error_count ?? 0}
          subtitle={`${errorRate}% error rate`}
        />
        <StatCard
          label="Avg Latency"
          icon={Activity}
          value={overview ? `${overview.avg_latency_ms.toFixed(0)}ms` : '—'}
          trend={latencyTrend.direction}
          trendValue={latencyTrend.value}
        />
      </div>

      {/* Chart + Account Status */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-3">
        {/* Request Volume Chart */}
        <div className="bg-surface border border-border rounded-xl p-4 lg:col-span-3">
          <p className="text-sm font-medium text-text-primary mb-3">
            Request Volume (24h)
          </p>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={hourlyData} barSize={10}>
              <XAxis
                dataKey="hour"
                tick={TICK_STYLE}
                tickLine={false}
                axisLine={false}
                interval={3}
              />
              <YAxis
                tick={TICK_STYLE}
                tickLine={false}
                axisLine={false}
                width={28}
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
              <Bar dataKey="requests" fill="#7c5bf0" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Account Status */}
        <div className="bg-surface border border-border rounded-xl p-4 lg:col-span-2">
          <p className="text-sm font-medium text-text-primary mb-3">
            Account Status
          </p>
          {accounts.length === 0 ? (
            <p className="text-text-muted text-xs text-center py-8">
              No accounts configured
            </p>
          ) : (
            <div className="space-y-2">
              {accounts.map((acct) => {
                const st = getAccountStatus(acct)
                const acctStat = accountStats.find(
                  (a) => a.account_name === acct.name,
                )
                return (
                  <div
                    key={acct.id}
                    className="flex items-center gap-2.5 py-1.5"
                  >
                    <StatusDot status={st} />
                    <span className="text-xs text-text-primary truncate flex-1">
                      {acct.name}
                    </span>
                    <span className="text-[11px] text-text-muted flex-shrink-0">
                      {acctStat
                        ? `${acctStat.total_requests} req`
                        : statusLabel[st]}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
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
