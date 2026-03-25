import { useCallback, useEffect, useState } from 'react'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import { api, OverviewStats, AccountStats, Account } from '../lib/api'
import StatCard from '../components/StatCard'

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

const TICK_STYLE = { fill: '#8b949e', fontSize: 11 }

export default function Dashboard() {
  const [overview, setOverview] = useState<OverviewStats | null>(null)
  const [accountStats, setAccountStats] = useState<AccountStats[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [hourlyData, setHourlyData] = useState<HourBucket[]>([])
  const [error, setError] = useState('')

  const fetchAll = useCallback(async () => {
    try {
      const [ov, ps, pv, logs] = await Promise.all([
        api.stats.overview(),
        api.stats.accounts(),
        api.accounts.list(),
        api.stats.requests({ limit: 200 }),
      ])
      setOverview(ov)
      setAccountStats(ps ?? [])
      setAccounts(pv ?? [])
      setHourlyData(buildHourlyBuckets(logs.data ?? []))
      setError('')
    } catch {
      setError('Failed to load dashboard data.')
    }
  }, [])

  useEffect(() => {
    fetchAll()
    const id = setInterval(fetchAll, 5000)
    return () => clearInterval(id)
  }, [fetchAll])

  const errorRate =
    overview && overview.total_requests > 0
      ? ((overview.error_count / overview.total_requests) * 100).toFixed(1) + '%'
      : '0%'

  const maxRequests = Math.max(...accountStats.map((p) => p.total_requests), 1)

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-text-primary">Dashboard</h1>
        <p className="text-sm text-text-secondary mt-0.5">Live overview — refreshes every 5 seconds</p>
      </div>

      {error && (
        <div className="text-sm text-error bg-error/10 border border-error/30 rounded-md px-3 py-2">
          {error}
        </div>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Requests Today"
          value={overview?.total_requests ?? '—'}
          subtitle={`${overview?.success_count ?? 0} successful`}
        />
        <StatCard
          label="Active Accounts"
          value={
            overview
              ? `${overview.active_accounts}/${overview.total_accounts}`
              : '—'
          }
          subtitle="available"
        />
        <StatCard
          label="Avg Latency"
          value={
            overview
              ? Math.round(overview.avg_latency_ms) + ' ms'
              : '—'
          }
        />
        <StatCard
          label="Error Rate"
          value={errorRate}
          subtitle={`${overview?.error_count ?? 0} errors`}
          trend={
            overview && overview.total_requests > 0
              ? overview.error_count / overview.total_requests > 0.05
                ? 'down'
                : 'neutral'
              : 'neutral'
          }
        />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Hourly bar chart */}
        <div className="card p-4 lg:col-span-2">
          <p className="text-sm font-medium text-text-primary mb-3">
            Request Volume (24h)
          </p>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={hourlyData} barSize={8}>
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
              <Bar dataKey="requests" fill="#1f6feb" radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Per-account breakdown */}
        <div className="card p-4">
          <p className="text-sm font-medium text-text-primary mb-3">
            Account Breakdown (Today)
          </p>
          {accountStats.length === 0 ? (
            <p className="text-sm text-text-muted text-center py-8">
              No requests yet
            </p>
          ) : (
            <div className="space-y-3">
              {accountStats.slice(0, 6).map((ps) => {
                const pct = Math.round((ps.total_requests / maxRequests) * 100)
                return (
                  <div key={ps.account_name}>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-text-secondary truncate max-w-[70%]">
                        {ps.account_name}
                      </span>
                      <span className="text-text-muted">{ps.total_requests}</span>
                    </div>
                    <div className="h-1.5 bg-surface rounded-full overflow-hidden">
                      <div
                        className="h-full bg-accent rounded-full transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Account status strip */}
      <div className="card p-4">
        <p className="text-sm font-medium text-text-primary mb-3">Account Status</p>
        {accounts.length === 0 ? (
          <p className="text-sm text-text-muted">No accounts configured.</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-2">
            {accounts.map((p) => {
              const available = p.status?.available ?? p.enabled
              const rateLimited = p.status?.reason?.includes('exhausted') ?? false
              const models = (() => {
                try {
                  const arr = JSON.parse(p.models) as string[]
                  return arr.slice(0, 2).join(', ')
                } catch {
                  return p.models
                }
              })()

              return (
                <div
                  key={p.id}
                  className="bg-surface border border-border rounded-md p-2.5 space-y-1.5"
                >
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`w-2 h-2 rounded-full flex-shrink-0 ${
                        !p.enabled
                          ? 'bg-text-muted'
                          : rateLimited
                            ? 'bg-warning'
                            : available
                              ? 'bg-success'
                              : 'bg-error'
                      }`}
                    />
                    <span className="text-xs font-medium text-text-primary truncate">
                      {p.name}
                    </span>
                  </div>
                  <p className="text-xs text-text-muted truncate">{models}</p>
                  <span className="badge-neutral text-xs">{p.type}</span>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Token usage */}
      {accountStats.length > 0 && (
        <div className="card p-4">
          <p className="text-sm font-medium text-text-primary mb-3">
            Token Usage by Account (Today)
          </p>
          <ResponsiveContainer width="100%" height={120}>
            <BarChart
              data={accountStats}
              layout="vertical"
              margin={{ left: 80, right: 20 }}
            >
              <XAxis
                type="number"
                tick={TICK_STYLE}
                tickLine={false}
                axisLine={false}
                allowDecimals={false}
              />
              <YAxis
                type="category"
                dataKey="account_name"
                tick={TICK_STYLE}
                tickLine={false}
                axisLine={false}
                width={80}
              />
              <Tooltip
                contentStyle={{
                  background: '#161b22',
                  border: '1px solid #30363d',
                  borderRadius: 6,
                  color: '#e1e4e8',
                  fontSize: 12,
                }}
              />
              <Bar
                dataKey="prompt_tokens"
                name="Prompt"
                stackId="t"
                fill="#1f6feb"
                radius={[0, 0, 0, 0]}
              />
              <Bar
                dataKey="completion_tokens"
                name="Completion"
                stackId="t"
                fill="#388bfd"
                radius={[0, 2, 2, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
