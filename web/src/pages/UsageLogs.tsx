import { useCallback, useEffect, useState } from 'react'
import { api, Account, RequestLog } from '../lib/api'
import { Badge } from '../components/ui/Badge'
import { ModelName } from '../components/ui/ModelName'
import { LogDrawer } from '../components/LogDrawer'
import { useDateFormat } from '../hooks/useDateFormat'
import { Select } from '../components/ui/Select'

const PAGE_SIZES = [25, 50, 100]

const DATE_PRESETS = [
  { label: 'Last 24h', hours: 24 },
  { label: 'Last 7d', hours: 24 * 7 },
  { label: 'Last 30d', hours: 24 * 30 },
] as const

// formatTs is now handled by useDateFormat hook — see usage below

function statusVariant(code: number, status: string) {
  if (code >= 200 && code < 300) return 'success' as const
  if (code >= 400 || status === 'error') return 'error' as const
  if (code === 0 && status === 'success') return 'success' as const
  return 'warning' as const
}

function statusLabel(code: number, status: string) {
  if (code > 0) return code
  return status === 'error' ? 'ERR' : status
}

export default function UsageLogs() {
  const { fmt } = useDateFormat()
  const [logs, setLogs] = useState<RequestLog[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [accounts, setAccounts] = useState<Account[]>([])
  const [filterAccount, setFilterAccount] = useState('')
  const [filterModel, setFilterModel] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterDateRange, setFilterDateRange] = useState('')
  const [filterMinLatency, setFilterMinLatency] = useState('')
  const [pageSize, setPageSize] = useState(50)
  const [page, setPage] = useState(0)

  const [selectedLogId, setSelectedLogId] = useState<number | null>(null)

  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  function computeDateRange(): { from?: string; to?: string } {
    if (!filterDateRange) return {}
    const preset = DATE_PRESETS.find((p) => p.label === filterDateRange)
    if (!preset) return {}
    const to = new Date()
    const from = new Date(to.getTime() - preset.hours * 60 * 60 * 1000)
    return { from: from.toISOString(), to: to.toISOString() }
  }

  const fetchLogs = useCallback(async () => {
    setLoading(true)
    try {
      const dates = computeDateRange()
      const minLat = filterMinLatency ? Number(filterMinLatency) : undefined
      const res = await api.stats.requests({
        account: filterAccount || undefined,
        status: filterStatus || undefined,
        model: filterModel || undefined,
        from: dates.from,
        to: dates.to,
        min_latency: minLat && !isNaN(minLat) ? minLat : undefined,
        limit: pageSize,
        offset: page * pageSize,
      })
      setLogs(res.data ?? [])
      setTotal(res.total)
      setError('')
    } catch {
      setError('Failed to load logs.')
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterAccount, filterStatus, filterModel, filterDateRange, filterMinLatency, pageSize, page])

  useEffect(() => {
    api.accounts.list().then((data) => setAccounts(data ?? [])).catch(() => {})
  }, [])

  useEffect(() => {
    fetchLogs()
  }, [fetchLogs])

  function applyFilter() {
    setPage(0)
    fetchLogs()
  }

  const startIdx = page * pageSize + 1
  const endIdx = Math.min(page * pageSize + logs.length, total)

  const selectedLog = logs.find((l) => l.id === selectedLogId) ?? null

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold text-text-primary">Usage Logs</h1>
        <p className="text-sm text-text-secondary mt-0.5">Request history and details</p>
      </div>

      {/* Filter bar */}
      <div className="bg-surface-raised border border-border rounded-xl p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-32">
            <label className="label">Account</label>
            <Select
              value={filterAccount}
              onChange={setFilterAccount}
              options={[
                { value: '', label: 'All accounts' },
                ...accounts.map((p) => ({ value: p.name, label: p.name })),
              ]}
            />
          </div>

          <div className="flex-1 min-w-28">
            <label className="label">Model</label>
            <input
              className="input font-mono"
              placeholder="Type to filter"
              value={filterModel}
              onChange={(e) => setFilterModel(e.target.value)}
            />
          </div>

          <div className="flex-1 min-w-28">
            <label className="label">Status</label>
            <Select
              value={filterStatus}
              onChange={setFilterStatus}
              options={[
                { value: '', label: 'All' },
                { value: 'success', label: 'Success' },
                { value: 'error', label: 'Error' },
              ]}
            />
          </div>

          <div className="flex-1 min-w-32">
            <label className="label">Date Range</label>
            <Select
              value={filterDateRange}
              onChange={setFilterDateRange}
              options={[
                { value: '', label: 'All time' },
                ...DATE_PRESETS.map((p) => ({ value: p.label, label: p.label })),
              ]}
            />
          </div>

          <div className="min-w-24">
            <label className="label">Min Latency</label>
            <input
              className="input"
              type="number"
              placeholder="ms"
              value={filterMinLatency}
              onChange={(e) => setFilterMinLatency(e.target.value)}
            />
          </div>

          <button onClick={applyFilter} className="btn-primary">
            Apply
          </button>
        </div>
      </div>

      {error && (
        <div className="text-error bg-error/10 border border-error/30 rounded-md px-3 py-2">
          {error}
        </div>
      )}

      {/* Table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-surface">
                <th className="text-left px-4 py-2.5 text-xs font-medium text-text-secondary uppercase">
                  Timestamp
                </th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-text-secondary uppercase">
                  Account
                </th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-text-secondary uppercase">
                  Model
                </th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-text-secondary uppercase">
                  Endpoint
                </th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-text-secondary uppercase">
                  Status
                </th>
                <th className="text-right px-4 py-2.5 text-xs font-medium text-text-secondary uppercase">
                  Latency
                </th>
                <th className="text-right px-4 py-2.5 text-xs font-medium text-text-secondary uppercase">
                  Tokens
                </th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="text-center py-12 text-text-muted">
                    Loading...
                  </td>
                </tr>
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-12 text-text-muted">
                    No logs found.
                  </td>
                </tr>
              ) : (
                logs.map((log) => (
                  <tr
                    key={log.id}
                    onClick={() => setSelectedLogId(log.id)}
                    className={`border-b border-border/50 cursor-pointer transition-colors hover:bg-[rgba(255,255,255,0.02)] ${
                      selectedLogId === log.id ? 'bg-accent-muted/50' : ''
                    }`}
                  >
                    <td className="px-4 py-2.5 text-xs text-text-muted whitespace-nowrap font-mono">
                      {fmt(log.timestamp)}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-text-primary">
                      {log.account_name
                        ? accounts.some((a) => a.name === log.account_name)
                          ? log.account_name
                          : <span className="text-text-muted">{log.provider_type || log.account_name} <span className="text-xs">(deleted)</span></span>
                        : '\u2014'}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-text-secondary max-w-32 truncate">
                      {log.model ? <ModelName name={log.model} className="truncate" /> : '\u2014'}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-text-muted">
                      {log.endpoint || '\u2014'}
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge variant={statusVariant(log.status_code, log.status)}>
                        {statusLabel(log.status_code, log.status)}
                      </Badge>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-text-secondary text-right whitespace-nowrap">
                      {log.latency_ms} ms
                    </td>
                    <td className="px-4 py-2.5 text-xs text-text-muted text-right whitespace-nowrap">
                      {log.prompt_tokens + log.completion_tokens}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-border">
          <p className="text-xs text-text-muted">
            {total > 0
              ? `Showing ${startIdx}\u2013${endIdx} of ${total} requests`
              : '0 requests'}
          </p>

          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage(0)}
              disabled={page === 0}
              className="btn-secondary px-2 py-1 text-xs disabled:opacity-40"
            >
              &laquo;
            </button>
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="btn-secondary px-2 py-1 text-xs disabled:opacity-40"
            >
              &lsaquo;
            </button>
            <span className="text-xs text-text-secondary px-2">
              {page + 1} / {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              className="btn-secondary px-2 py-1 text-xs disabled:opacity-40"
            >
              &rsaquo;
            </button>
            <button
              onClick={() => setPage(totalPages - 1)}
              disabled={page >= totalPages - 1}
              className="btn-secondary px-2 py-1 text-xs disabled:opacity-40"
            >
              &raquo;
            </button>
          </div>

          <div className="flex items-center gap-2">
            <label className="text-xs text-text-muted">Per page</label>
            <Select
              value={String(pageSize)}
              onChange={(v) => {
                setPageSize(Number(v))
                setPage(0)
              }}
              options={PAGE_SIZES.map((n) => ({ value: String(n), label: String(n) }))}
              className="w-16"
            />
          </div>
        </div>
      </div>

      {/* Detail drawer */}
      <LogDrawer log={selectedLog} onClose={() => setSelectedLogId(null)} />
    </div>
  )
}
