import { useCallback, useEffect, useState } from 'react'
import { api, Account, RequestLog } from '../lib/api'

const PAGE_SIZES = [25, 50, 100]

function StatusBadge({ status }: { status: string }) {
  if (status === 'success') return <span className="badge-success">{status}</span>
  if (status === 'error') return <span className="badge-error">{status}</span>
  return <span className="badge-warning">{status}</span>
}

function formatTs(ts: string): string {
  const d = new Date(ts)
  return d.toLocaleString(undefined, {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
}

export default function UsageLogs() {
  const [logs, setLogs] = useState<RequestLog[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [accounts, setAccounts] = useState<Account[]>([])
  const [filterAccount, setFilterAccount] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [pageSize, setPageSize] = useState(50)
  const [page, setPage] = useState(0)

  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  const fetchLogs = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.stats.requests({
        account: filterAccount || undefined,
        status: filterStatus || undefined,
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
  }, [filterAccount, filterStatus, pageSize, page])

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

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold text-text-primary">Usage Logs</h1>
        <p className="text-sm text-text-secondary mt-0.5">Per-request log of all proxied calls</p>
      </div>

      {/* Filter bar */}
      <div className="card p-3 flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-32">
          <label className="label">Account</label>
          <select
            className="input"
            value={filterAccount}
            onChange={(e) => {
              setFilterAccount(e.target.value)
              setPage(0)
            }}
          >
            <option value="">All accounts</option>
            {accounts.map((p) => (
              <option key={p.id} value={p.name}>
                {p.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex-1 min-w-28">
          <label className="label">Status</label>
          <select
            className="input"
            value={filterStatus}
            onChange={(e) => {
              setFilterStatus(e.target.value)
              setPage(0)
            }}
          >
            <option value="">All statuses</option>
            <option value="success">success</option>
            <option value="error">error</option>
          </select>
        </div>

        <div className="min-w-20">
          <label className="label">Page size</label>
          <select
            className="input"
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value))
              setPage(0)
            }}
          >
            {PAGE_SIZES.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>

        <button onClick={applyFilter} className="btn-primary">
          Apply
        </button>
      </div>

      {error && (
        <div className="text-sm text-error bg-error/10 border border-error/30 rounded-md px-3 py-2">
          {error}
        </div>
      )}

      {/* Table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface">
                <th className="text-left px-4 py-2.5 text-xs font-medium text-text-secondary">
                  Timestamp
                </th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-text-secondary">
                  Account
                </th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-text-secondary">
                  Model
                </th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-text-secondary">
                  Endpoint
                </th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-text-secondary">
                  Status
                </th>
                <th className="text-right px-4 py-2.5 text-xs font-medium text-text-secondary">
                  Latency
                </th>
                <th className="text-right px-4 py-2.5 text-xs font-medium text-text-secondary">
                  Tokens
                </th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="text-center py-12 text-text-muted">
                    Loading…
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
                    className="border-b border-border/50 hover:bg-surface-overlay/50 transition-colors"
                  >
                    <td className="px-4 py-2.5 text-xs text-text-muted whitespace-nowrap font-mono">
                      {formatTs(log.timestamp)}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-text-primary">
                      {log.account_name || '—'}
                    </td>
                    <td className="px-4 py-2.5 text-xs font-mono text-text-secondary max-w-32 truncate">
                      {log.model || '—'}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-text-muted">
                      {log.endpoint || '—'}
                    </td>
                    <td className="px-4 py-2.5">
                      <StatusBadge status={log.status} />
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
            {total} total record{total !== 1 ? 's' : ''}
          </p>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage(0)}
              disabled={page === 0}
              className="btn-secondary px-2 py-1 text-xs disabled:opacity-40"
            >
              «
            </button>
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="btn-secondary px-2 py-1 text-xs disabled:opacity-40"
            >
              ‹
            </button>
            <span className="text-xs text-text-secondary px-2">
              {page + 1} / {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              className="btn-secondary px-2 py-1 text-xs disabled:opacity-40"
            >
              ›
            </button>
            <button
              onClick={() => setPage(totalPages - 1)}
              disabled={page >= totalPages - 1}
              className="btn-secondary px-2 py-1 text-xs disabled:opacity-40"
            >
              »
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
