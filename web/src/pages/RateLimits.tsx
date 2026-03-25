import { useCallback, useEffect, useState } from 'react'
import { api, Account, RateLimitDef } from '../lib/api'

const PROVIDER_TYPES = [
  'groq',
  'google',
  'openrouter',
  'cerebras',
  'mistral',
  'github',
  'ollama',
  'openai-compatible',
]

const METRIC_DEFS: { key: string; label: string; window: number }[] = [
  { key: 'rpm', label: 'Requests per minute', window: 60 },
  { key: 'rpd', label: 'Requests per day', window: 86400 },
  { key: 'rpmo', label: 'Requests per month', window: 2592000 },
  { key: 'rps', label: 'Requests per second', window: 1 },
  { key: 'tpm', label: 'Tokens per minute', window: 60 },
  { key: 'tpd', label: 'Tokens per day', window: 86400 },
  { key: 'tpmo', label: 'Tokens per month', window: 2592000 },
]
const METRIC_WINDOW: Record<string, number> = Object.fromEntries(METRIC_DEFS.map((m) => [m.key, m.window]))
const METRIC_LABELS: Record<string, string> = Object.fromEntries(METRIC_DEFS.map((m) => [m.key, m.label]))

// ─── Add/Edit Def Row ─────────────────────────────────────────────────────────

interface DefFormState {
  model: string
  metric: string
  max_value: number
  window_secs: number
}

const EMPTY_FORM: DefFormState = { model: '', metric: 'rpm', max_value: 100, window_secs: 60 }

// ─── Provider Tab ─────────────────────────────────────────────────────────────

interface ProviderTabProps {
  provider: string
  accounts: Account[]
}

function ProviderTab({ provider, accounts }: ProviderTabProps) {
  const [defs, setDefs] = useState<RateLimitDef[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Inline add form
  const [addForm, setAddForm] = useState<DefFormState>({ ...EMPTY_FORM })
  const [addModel, setAddModel] = useState('')
  const [saving, setSaving] = useState(false)
  const [addError, setAddError] = useState('')

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
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load definitions')
    } finally {
      setLoading(false)
    }
  }, [provider])

  useEffect(() => {
    fetchDefs()
  }, [fetchDefs])

  async function handleAdd() {
    if (!addForm.metric || addForm.max_value < 1) return
    setSaving(true)
    setAddError('')
    try {
      await api.ratelimits.set({
        provider,
        model: addModel,
        metric: addForm.metric,
        max_value: addForm.max_value,
        window_secs: addForm.window_secs,
      })
      setAddForm({ ...EMPTY_FORM })
      setAddModel('')
      await fetchDefs()
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: number) {
    try {
      await api.ratelimits.delete(id)
      await fetchDefs()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete')
    }
  }

  async function handleRefreshModels() {
    if (!refreshAccountId) return
    const account = accounts.find((a) => a.id === refreshAccountId)
    if (!account) return
    setRefreshing(true)
    setRefreshError('')
    try {
      const result = await api.accounts.discover({
        type: account.type,
        base_url: account.base_url,
        api_key: '',
        free_only: false,
      })
      setKnownModels(result.models.map((m) => m.id))
    } catch (err) {
      setRefreshError(err instanceof Error ? err.message : 'Discovery failed')
    } finally {
      setRefreshing(false)
    }
  }

  // Group defs: provider-level (model === '') vs per-model
  const providerDefs = defs.filter((d) => d.model === '')
  const modelDefs = defs.filter((d) => d.model !== '')

  // Group model defs by model name
  const modelGroups: Record<string, RateLimitDef[]> = {}
  for (const d of modelDefs) {
    if (!modelGroups[d.model]) modelGroups[d.model] = []
    modelGroups[d.model].push(d)
  }

  // Model options for the add form: known models (from discovery) + any already in defs
  const allModelOptions = Array.from(new Set([
    ...knownModels,
    ...modelDefs.map((d) => d.model),
  ])).sort()

  if (loading) {
    return <div className="text-sm text-text-muted py-8 text-center">Loading…</div>
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="text-sm text-error bg-error/10 border border-error/30 rounded-md px-3 py-2">{error}</div>
      )}

      {/* ── Provider-level limits ── */}
      <div className="card p-4">
        <h3 className="text-sm font-semibold text-text-primary mb-3">Provider-level Defaults</h3>
        {providerDefs.length === 0 ? (
          <p className="text-sm text-text-muted mb-3">No provider-level limits defined.</p>
        ) : (
          <div className="space-y-2 mb-4">
            {providerDefs.map((d) => (
              <div key={d.id} className="flex items-center gap-3 bg-surface border border-border rounded-md px-3 py-2">
                <span className="badge-accent">{METRIC_LABELS[d.metric] ?? d.metric}</span>
                <span className="text-sm text-text-primary flex-1">
                  max <strong>{d.max_value}</strong> / {d.window_secs}s
                </span>
                <button
                  onClick={() => handleDelete(d.id)}
                  className="text-error hover:text-error/70 flex-shrink-0"
                  title="Delete"
                >
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z" />
                    <path fillRule="evenodd" d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4L4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Add provider-level limit form */}
        <div className="border-t border-border pt-3">
          <p className="text-xs font-medium text-text-secondary uppercase tracking-wide mb-2">Add provider limit</p>
          <div className="flex items-center gap-2 flex-wrap">
            <select
              className="input py-1.5 w-24"
              value={addModel === '' ? '__provider__' : addModel}
              onChange={() => setAddModel('')}
              onClick={() => setAddModel('')}
            >
              <option value="__provider__">provider</option>
            </select>
            <select
              className="input py-1.5 w-24"
              value={addForm.metric}
              onChange={(e) => {
                const metric = e.target.value
                setAddForm((f) => ({ ...f, metric, window_secs: METRIC_WINDOW[metric] ?? 60 }))
              }}
            >
              {METRIC_DEFS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
            </select>
            <span className="text-text-muted text-xs">max</span>
            <input
              type="number"
              className="input py-1.5 w-24"
              min={1}
              value={addForm.max_value}
              onChange={(e) => setAddForm((f) => ({ ...f, max_value: parseInt(e.target.value) || 1 }))}
            />
            <span className="text-text-muted text-xs">/{addForm.window_secs}s</span>
            <button
              type="button"
              onClick={handleAdd}
              disabled={saving}
              className="btn-primary text-xs px-3 py-1.5 disabled:opacity-50"
            >
              {saving ? 'Adding…' : '+ Add'}
            </button>
          </div>
          {addError && (
            <p className="text-xs text-error mt-1">{addError}</p>
          )}
        </div>
      </div>

      {/* ── Per-model overrides ── */}
      <div className="card p-4">
        <h3 className="text-sm font-semibold text-text-primary mb-3">Per-model Overrides</h3>

        {Object.keys(modelGroups).length === 0 ? (
          <p className="text-sm text-text-muted mb-3">No per-model overrides defined.</p>
        ) : (
          <div className="space-y-3 mb-4">
            {Object.entries(modelGroups).map(([model, mdefs]) => (
              <div key={model} className="border border-border rounded-md overflow-hidden">
                <div className="bg-surface-overlay px-3 py-1.5 border-b border-border">
                  <span className="text-xs font-mono text-text-primary">{model}</span>
                </div>
                <div className="divide-y divide-border">
                  {mdefs.map((d) => (
                    <div key={d.id} className="flex items-center gap-3 px-3 py-2 bg-surface">
                      <span className="badge-accent">{METRIC_LABELS[d.metric] ?? d.metric}</span>
                      <span className="text-sm text-text-primary flex-1">
                        max <strong>{d.max_value}</strong> / {d.window_secs}s
                      </span>
                      <button
                        onClick={() => handleDelete(d.id)}
                        className="text-error hover:text-error/70 flex-shrink-0"
                        title="Delete"
                      >
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                          <path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z" />
                          <path fillRule="evenodd" d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4L4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Add per-model limit form */}
        <div className="border-t border-border pt-3">
          <p className="text-xs font-medium text-text-secondary uppercase tracking-wide mb-2">Add model override</p>
          <div className="flex items-center gap-2 flex-wrap">
            {allModelOptions.length > 0 ? (
              <select
                className="input py-1.5 flex-1 min-w-[160px]"
                value={addModel}
                onChange={(e) => setAddModel(e.target.value)}
              >
                <option value="">— select model —</option>
                {allModelOptions.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            ) : (
              <input
                className="input py-1.5 flex-1 min-w-[160px] font-mono"
                placeholder="model-id (refresh models first)"
                value={addModel}
                onChange={(e) => setAddModel(e.target.value)}
              />
            )}
            <select
              className="input py-1.5 w-24"
              value={addForm.metric}
              onChange={(e) => {
                const metric = e.target.value
                setAddForm((f) => ({ ...f, metric, window_secs: METRIC_WINDOW[metric] ?? 60 }))
              }}
            >
              {METRIC_DEFS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
            </select>
            <span className="text-text-muted text-xs">max</span>
            <input
              type="number"
              className="input py-1.5 w-24"
              min={1}
              value={addForm.max_value}
              onChange={(e) => setAddForm((f) => ({ ...f, max_value: parseInt(e.target.value) || 1 }))}
            />
            <span className="text-text-muted text-xs">/{addForm.window_secs}s</span>
            <button
              type="button"
              onClick={() => {
                // Use the model from addModel state (per-model form)
                if (!addModel) {
                  setAddError('Select or enter a model name')
                  return
                }
                handleAdd()
              }}
              disabled={saving || !addModel}
              className="btn-primary text-xs px-3 py-1.5 disabled:opacity-50"
            >
              {saving ? 'Adding…' : '+ Add'}
            </button>
          </div>
          {addError && (
            <p className="text-xs text-error mt-1">{addError}</p>
          )}
        </div>
      </div>

      {/* ── Refresh models ── */}
      <div className="card p-4">
        <h3 className="text-sm font-semibold text-text-primary mb-3">Refresh Model List</h3>
        <p className="text-xs text-text-muted mb-3">
          Fetch available models from an existing account to populate the model override selector.
        </p>
        {providerAccounts.length === 0 ? (
          <p className="text-sm text-text-muted">No {provider} accounts configured.</p>
        ) : (
          <div className="flex items-center gap-2 flex-wrap">
            <select
              className="input py-1.5 flex-1 min-w-[200px]"
              value={refreshAccountId}
              onChange={(e) => setRefreshAccountId(e.target.value === '' ? '' : Number(e.target.value))}
            >
              <option value="">— select account —</option>
              {providerAccounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
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
              ) : 'Refresh Models'}
            </button>
            {knownModels.length > 0 && (
              <span className="text-xs text-success">{knownModels.length} models loaded</span>
            )}
          </div>
        )}
        {refreshError && (
          <p className="text-xs text-error mt-2">{refreshError}</p>
        )}
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
    api.accounts.list()
      .then((data) => setAccounts(data ?? []))
      .catch(() => setAccounts([]))
      .finally(() => setLoadingAccounts(false))
  }, [])

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold text-text-primary">Rate Limit Definitions</h1>
        <p className="text-sm text-text-secondary mt-0.5">
          Define default rate limits by provider and model. These are applied when creating new accounts.
        </p>
      </div>

      {/* Provider tabs */}
      <div className="border-b border-border">
        <nav className="-mb-px flex gap-0 overflow-x-auto">
          {PROVIDER_TYPES.map((p) => (
            <button
              key={p}
              onClick={() => setActiveTab(p)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                activeTab === p
                  ? 'border-accent text-accent'
                  : 'border-transparent text-text-secondary hover:text-text-primary hover:border-border'
              }`}
            >
              {p}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab content */}
      {loadingAccounts ? (
        <div className="text-sm text-text-muted py-8 text-center">Loading accounts…</div>
      ) : (
        <ProviderTab key={activeTab} provider={activeTab} accounts={accounts} />
      )}
    </div>
  )
}
