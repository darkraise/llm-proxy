import { useCallback, useEffect, useState } from 'react'
import { api, Account, AccountLimit, RateLimitDef } from '../lib/api'
import { RateLimitTable } from '../components/RateLimitTable'
import { Select } from '../components/ui/Select'

const PROVIDER_TYPES = [
  'groq',
  'google',
  'openrouter',
  'cerebras',
  'mistral',
  'github',
  'cohere',
  'ollama',
  'openai-compatible',
]

// ─── Provider Tab ─────────────────────────────────────────────────────────────

interface ProviderTabProps {
  provider: string
  accounts: Account[]
}

function ProviderTab({ provider, accounts }: ProviderTabProps) {
  const [defs, setDefs] = useState<RateLimitDef[]>([])
  const [pendingLimits, setPendingLimits] = useState<AccountLimit[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')

  // Model refresh
  const [refreshAccountId, setRefreshAccountId] = useState<number | ''>('')
  const [refreshing, setRefreshing] = useState(false)
  const [refreshError, setRefreshError] = useState('')
  const [knownModels, setKnownModels] = useState<string[]>([])

  const providerAccounts = accounts.filter((a) => a.type === provider)

  const fetchDefs = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await api.ratelimits.list(provider)
      setDefs(data ?? [])
      setPendingLimits(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load definitions')
    } finally {
      setLoading(false)
    }
  }, [provider])

  useEffect(() => {
    fetchDefs()
  }, [fetchDefs])

  // Convert RateLimitDef[] → AccountLimit[] for RateLimitTable
  function defsToLimits(defList: RateLimitDef[]): AccountLimit[] {
    return defList.map((d) => ({
      model: d.model,
      metric: d.metric,
      max_value: d.max_value,
      window_secs: d.window_secs,
    }))
  }

  const hasChanges = pendingLimits !== null

  function handleLimitsChange(newLimits: AccountLimit[]) {
    setPendingLimits(newLimits)
  }

  async function handleSave() {
    if (!pendingLimits) return
    setSaving(true)
    setSaveError('')
    try {
      const removed = defs.filter(
        (d) => !pendingLimits.some((l) => l.model === d.model && l.metric === d.metric),
      )

      const upserted = pendingLimits.filter((l) => {
        const existing = defs.find((d) => d.model === l.model && d.metric === l.metric)
        return !existing || existing.max_value !== l.max_value
      })

      await Promise.all([
        ...removed.map((d) => api.ratelimits.delete(d.id)),
        ...upserted.map((l) =>
          api.ratelimits.set({
            provider,
            model: l.model,
            metric: l.metric,
            max_value: l.max_value,
            window_secs: l.window_secs,
          }),
        ),
      ])

      await fetchDefs()
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  function handleDiscard() {
    setPendingLimits(null)
  }

  async function handleRefreshModels() {
    if (!refreshAccountId) return
    const account = accounts.find((a) => a.id === refreshAccountId)
    if (!account) return
    setRefreshing(true)
    setRefreshError('')
    try {
      const result = await api.accounts.discoverByAccount(account.id)
      setKnownModels(result.models.map((m) => m.id))
    } catch (err) {
      setRefreshError(err instanceof Error ? err.message : 'Discovery failed')
    } finally {
      setRefreshing(false)
    }
  }

  // Collect all model names: from known models + any already in defs
  const modelDefs = defs.filter((d) => d.model !== '')
  const allModels = Array.from(
    new Set([...knownModels, ...modelDefs.map((d) => d.model)]),
  ).sort()

  if (loading) {
    return <div className="text-text-muted py-8 text-center">Loading…</div>
  }

  const limitsForTable = defsToLimits(defs)

  return (
    <div className="space-y-6">
      {error && (
        <div className="text-error bg-error/10 border border-error/30 rounded-md px-3 py-2">
          {error}
        </div>
      )}

      {/* ── Spreadsheet table ── */}
      <div className="card p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-text-primary">Rate Limit Definitions</h3>
          <div className="flex items-center gap-2">
            {saving && (
              <span className="text-xs text-text-muted flex items-center gap-1.5">
                <svg className="animate-spin" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
                </svg>
                Saving…
              </span>
            )}
            {hasChanges && !saving && (
              <>
                <button onClick={handleDiscard} className="btn-secondary text-xs px-2.5 py-1">Discard</button>
                <button onClick={handleSave} className="btn-primary text-xs px-2.5 py-1">Save Changes</button>
              </>
            )}
          </div>
        </div>
        <RateLimitTable
          models={allModels}
          limits={pendingLimits ?? limitsForTable}
          onChange={handleLimitsChange}
          defaultRowLabel="Provider Default"
        />
        {saveError && (
          <p className="text-xs text-error mt-2">{saveError}</p>
        )}
      </div>

      {/* ── Refresh models ── */}
      <div className="card p-4">
        <h3 className="font-semibold text-text-primary mb-3">Refresh Model List</h3>
        <p className="text-xs text-text-muted mb-3">
          Fetch available models from an existing account to add model rows to the table above.
        </p>
        {providerAccounts.length === 0 ? (
          <p className="text-text-muted">No {provider} accounts configured.</p>
        ) : (
          <div className="flex items-center gap-2 flex-wrap">
            <Select
              value={String(refreshAccountId)}
              onChange={(v) => setRefreshAccountId(v === '' ? '' : Number(v))}
              options={[
                { value: '', label: '— select account —' },
                ...providerAccounts.map((a) => ({ value: String(a.id), label: a.name })),
              ]}
              className="flex-1 min-w-48"
            />
            <button
              type="button"
              onClick={handleRefreshModels}
              disabled={!refreshAccountId || refreshing}
              className="btn-secondary disabled:opacity-50"
            >
              {refreshing ? (
                <span className="flex items-center gap-2">
                  <svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
                  </svg>
                  Refreshing…
                </span>
              ) : (
                'Refresh Models'
              )}
            </button>
            {knownModels.length > 0 && (
              <span className="text-xs text-success">{knownModels.length} models loaded</span>
            )}
          </div>
        )}
        {refreshError && <p className="text-xs text-error mt-2">{refreshError}</p>}
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function RateLimits() {
  const [activeTab, setActiveTab] = useState(PROVIDER_TYPES[0])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loadingAccounts, setLoadingAccounts] = useState(true)

  useEffect(() => {
    api.accounts
      .list()
      .then((data) => setAccounts(data ?? []))
      .catch(() => setAccounts([]))
      .finally(() => setLoadingAccounts(false))
  }, [])

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold text-text-primary">Rate Limits</h1>
        <p className="text-sm text-text-secondary mt-0.5">
          Define default rate limits by provider and model. These are applied when creating new
          accounts.
        </p>
      </div>

      {/* Provider tabs */}
      <div className="border-b border-border">
        <nav className="flex gap-0 overflow-x-auto">
          {PROVIDER_TYPES.map((p) => (
            <button
              key={p}
              onClick={() => setActiveTab(p)}
              className={`px-4 py-2.5 font-medium transition-colors whitespace-nowrap ${
                activeTab === p
                  ? 'text-accent-light border-b-2 border-accent-light pb-2'
                  : 'text-text-secondary pb-2 hover:text-text-primary'
              }`}
            >
              {p}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab content */}
      {loadingAccounts ? (
        <div className="text-text-muted py-8 text-center">Loading accounts…</div>
      ) : (
        <ProviderTab key={activeTab} provider={activeTab} accounts={accounts} />
      )}
    </div>
  )
}
