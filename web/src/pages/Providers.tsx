import { ChangeEvent, FormEvent, useCallback, useEffect, useRef, useState } from 'react'
import { api, Provider, ProviderInput, ProviderLimit, TestResult } from '../lib/api'

const PROVIDER_TYPES = ['openai', 'anthropic', 'google', 'ollama', 'openai-compatible']

const DEFAULT_INPUT: ProviderInput = {
  name: '',
  type: 'openai',
  base_url: '',
  api_key: '',
  models: [],
  priority: 0,
  enabled: true,
  limits: [],
}

function parseModels(raw: string): string[] {
  return raw
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

function formatModels(models: string[]): string {
  return models.join('\n')
}

function parseProviderModels(modelsJSON: string): string[] {
  try {
    return JSON.parse(modelsJSON) as string[]
  } catch {
    return []
  }
}

// ─── Modal ───────────────────────────────────────────────────────────────────

interface ProviderModalProps {
  initial?: Provider | null
  onClose: () => void
  onSave: () => void
}

function ProviderModal({ initial, onClose, onSave }: ProviderModalProps) {
  const [form, setForm] = useState<ProviderInput>(() => {
    if (initial) {
      return {
        name: initial.name,
        type: initial.type,
        base_url: initial.base_url,
        api_key: '',
        models: parseProviderModels(initial.models),
        priority: initial.priority,
        enabled: initial.enabled,
        limits: initial.limits ?? [],
      }
    }
    return { ...DEFAULT_INPUT }
  })
  const [modelsRaw, setModelsRaw] = useState(
    formatModels(initial ? parseProviderModels(initial.models) : []),
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function set<K extends keyof ProviderInput>(k: K, v: ProviderInput[K]) {
    setForm((f) => ({ ...f, [k]: v }))
  }

  function addLimit() {
    set('limits', [...form.limits, { metric: 'requests', max_value: 100, window_secs: 60 }])
  }

  function updateLimit(idx: number, partial: Partial<ProviderLimit>) {
    set(
      'limits',
      form.limits.map((l, i) => (i === idx ? { ...l, ...partial } : l)),
    )
  }

  function removeLimit(idx: number) {
    set(
      'limits',
      form.limits.filter((_, i) => i !== idx),
    )
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')
    const payload: ProviderInput = {
      ...form,
      models: parseModels(modelsRaw),
    }
    try {
      if (initial) {
        await api.providers.update(initial.id, payload)
      } else {
        await api.providers.create(payload)
      }
      onSave()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
      <div className="card w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-base font-semibold text-text-primary">
            {initial ? 'Edit Provider' : 'Add Provider'}
          </h2>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-text-primary transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-5 py-4 space-y-4">
          {/* Name */}
          <div>
            <label className="label">Name</label>
            <input
              className="input"
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="my-openai"
              required
            />
          </div>

          {/* Type */}
          <div>
            <label className="label">Type</label>
            <select
              className="input"
              value={form.type}
              onChange={(e) => set('type', e.target.value)}
            >
              {PROVIDER_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>

          {/* Base URL */}
          <div>
            <label className="label">Base URL</label>
            <input
              className="input"
              value={form.base_url}
              onChange={(e) => set('base_url', e.target.value)}
              placeholder="https://api.openai.com/v1"
            />
          </div>

          {/* API Key */}
          <div>
            <label className="label">
              API Key {initial && <span className="text-text-muted normal-case">(leave blank to keep current)</span>}
            </label>
            <input
              className="input font-mono"
              type="password"
              value={form.api_key}
              onChange={(e) => set('api_key', e.target.value)}
              placeholder={initial ? '••••••••' : 'sk-...'}
              autoComplete="off"
            />
          </div>

          {/* Models */}
          <div>
            <label className="label">Models (one per line or comma-separated)</label>
            <textarea
              className="input font-mono resize-none"
              rows={3}
              value={modelsRaw}
              onChange={(e) => setModelsRaw(e.target.value)}
              placeholder="gpt-4o&#10;gpt-4o-mini"
            />
          </div>

          {/* Priority */}
          <div>
            <label className="label">Priority (lower = higher priority)</label>
            <input
              className="input"
              type="number"
              min={0}
              value={form.priority}
              onChange={(e) => set('priority', parseInt(e.target.value) || 0)}
            />
          </div>

          {/* Enabled */}
          <div className="flex items-center gap-2">
            <input
              id="enabled"
              type="checkbox"
              className="rounded border-border bg-surface"
              checked={form.enabled}
              onChange={(e) => set('enabled', e.target.checked)}
            />
            <label htmlFor="enabled" className="text-sm text-text-primary">
              Enabled
            </label>
          </div>

          {/* Rate limits */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="label mb-0">Rate Limits</label>
              <button type="button" onClick={addLimit} className="btn-secondary text-xs px-2 py-1">
                + Add limit
              </button>
            </div>
            <div className="space-y-2">
              {form.limits.map((l, i) => (
                <div key={i} className="flex items-center gap-2 bg-surface p-2 rounded-md border border-border">
                  <select
                    className="input py-1 flex-1 min-w-0"
                    value={l.metric}
                    onChange={(e) => updateLimit(i, { metric: e.target.value })}
                  >
                    <option value="requests">requests</option>
                    <option value="tokens">tokens</option>
                  </select>
                  <span className="text-text-muted text-xs flex-shrink-0">max</span>
                  <input
                    type="number"
                    className="input py-1 w-20 flex-shrink-0"
                    value={l.max_value}
                    min={1}
                    onChange={(e) =>
                      updateLimit(i, { max_value: parseInt(e.target.value) || 1 })
                    }
                  />
                  <span className="text-text-muted text-xs flex-shrink-0">per</span>
                  <input
                    type="number"
                    className="input py-1 w-20 flex-shrink-0"
                    value={l.window_secs}
                    min={1}
                    onChange={(e) =>
                      updateLimit(i, { window_secs: parseInt(e.target.value) || 1 })
                    }
                  />
                  <span className="text-text-muted text-xs flex-shrink-0">s</span>
                  <button
                    type="button"
                    onClick={() => removeLimit(i)}
                    className="text-error hover:text-error/70 flex-shrink-0"
                  >
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                      <path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z" />
                      <path
                        fillRule="evenodd"
                        d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4L4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z"
                      />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          </div>

          {error && (
            <p className="text-sm text-error bg-error/10 border border-error/30 rounded-md px-3 py-2">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-2 border-t border-border">
            <button type="button" onClick={onClose} className="btn-secondary">
              Cancel
            </button>
            <button type="submit" disabled={saving} className="btn-primary disabled:opacity-50">
              {saving ? 'Saving…' : initial ? 'Update' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function Providers() {
  const [providers, setProviders] = useState<Provider[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Provider | null>(null)
  const [testResults, setTestResults] = useState<Record<number, TestResult | 'testing'>>({})
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null)
  const importRef = useRef<HTMLInputElement>(null)

  const fetchProviders = useCallback(async () => {
    try {
      const data = await api.providers.list()
      setProviders(data ?? [])
      setError('')
    } catch {
      setError('Failed to load providers.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchProviders()
  }, [fetchProviders])

  async function handleDelete(id: number) {
    try {
      await api.providers.delete(id)
      setDeleteConfirm(null)
      fetchProviders()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed')
    }
  }

  async function handleTest(id: number) {
    setTestResults((r) => ({ ...r, [id]: 'testing' }))
    try {
      const result = await api.providers.test(id)
      setTestResults((r) => ({ ...r, [id]: result }))
    } catch {
      setTestResults((r) => ({
        ...r,
        [id]: { success: false, error: 'Request failed' },
      }))
    }
  }

  async function handleImport(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const text = await file.text()
    try {
      const res = await api.config.import(text)
      alert(`Imported ${res.imported} provider(s).`)
      fetchProviders()
    } catch (err) {
      alert('Import failed: ' + (err instanceof Error ? err.message : 'unknown'))
    }
    e.target.value = ''
  }

  function openAdd() {
    setEditing(null)
    setModalOpen(true)
  }

  function openEdit(p: Provider) {
    setEditing(p)
    setModalOpen(true)
  }

  function closeModal() {
    setModalOpen(false)
    setEditing(null)
  }

  function handleSaved() {
    closeModal()
    fetchProviders()
  }

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-text-primary">Providers</h1>
          <p className="text-sm text-text-secondary mt-0.5">Manage LLM backend providers</p>
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={importRef}
            type="file"
            accept=".yml,.yaml"
            className="hidden"
            onChange={handleImport}
          />
          <button
            onClick={() => importRef.current?.click()}
            className="btn-secondary"
          >
            Import YAML
          </button>
          <a href={api.config.exportUrl()} download className="btn-secondary">
            Export YAML
          </a>
          <button onClick={openAdd} className="btn-primary">
            Add Provider
          </button>
        </div>
      </div>

      {error && (
        <div className="text-sm text-error bg-error/10 border border-error/30 rounded-md px-3 py-2">
          {error}
        </div>
      )}

      {/* Provider list */}
      {loading ? (
        <div className="text-sm text-text-muted text-center py-16">Loading…</div>
      ) : providers.length === 0 ? (
        <div className="card p-10 text-center">
          <p className="text-text-secondary mb-3">No providers configured yet.</p>
          <button onClick={openAdd} className="btn-primary">
            Add your first provider
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {providers.map((p) => {
            const models = parseProviderModels(p.models)
            const available = p.status?.available ?? p.enabled
            const rateLimited = p.status?.rate_limited ?? false
            const testRes = testResults[p.id]

            return (
              <div key={p.id} className="card p-4">
                <div className="flex items-start gap-3">
                  {/* Status dot */}
                  <div className="mt-1 flex-shrink-0">
                    <span
                      className={`w-2.5 h-2.5 rounded-full block ${
                        !p.enabled
                          ? 'bg-text-muted'
                          : rateLimited
                            ? 'bg-warning'
                            : available
                              ? 'bg-success'
                              : 'bg-error'
                      }`}
                      title={
                        !p.enabled
                          ? 'Disabled'
                          : rateLimited
                            ? 'Rate limited'
                            : available
                              ? 'Available'
                              : 'Unavailable'
                      }
                    />
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-text-primary">{p.name}</span>
                      <span className="badge-neutral">{p.type}</span>
                      {!p.enabled && <span className="badge-warning">disabled</span>}
                      {rateLimited && <span className="badge-warning">rate limited</span>}
                    </div>
                    <p className="text-xs text-text-muted mt-0.5 truncate">{p.base_url || 'No URL'}</p>

                    {models.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {models.map((m) => (
                          <span key={m} className="badge-accent font-mono text-xs">
                            {m}
                          </span>
                        ))}
                      </div>
                    )}

                    {p.limits && p.limits.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {p.limits.map((l, i) => (
                          <span key={i} className="badge-neutral">
                            {l.max_value} {l.metric}/{l.window_secs}s
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Rate limit usage */}
                    {p.status && (
                      <div className="flex gap-4 mt-2 text-xs text-text-muted">
                        <span>Requests today: {p.status.requests_today}</span>
                        <span>Tokens today: {p.status.tokens_today}</span>
                        {p.status.last_error && (
                          <span className="text-error truncate max-w-xs">
                            Last error: {p.status.last_error}
                          </span>
                        )}
                      </div>
                    )}

                    {/* Test result */}
                    {testRes && testRes !== 'testing' && (
                      <div
                        className={`mt-2 text-xs px-2 py-1 rounded inline-flex items-center gap-1 ${
                          testRes.success
                            ? 'bg-success/10 text-success'
                            : 'bg-error/10 text-error'
                        }`}
                      >
                        {testRes.success
                          ? `Connected (HTTP ${testRes.status_code})`
                          : `Failed: ${testRes.error}`}
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <button
                      onClick={() => handleTest(p.id)}
                      disabled={testRes === 'testing'}
                      className="btn-secondary text-xs px-2 py-1"
                      title="Test connectivity"
                    >
                      {testRes === 'testing' ? 'Testing…' : 'Test'}
                    </button>
                    <button
                      onClick={() => openEdit(p)}
                      className="btn-secondary text-xs px-2 py-1"
                    >
                      Edit
                    </button>
                    {deleteConfirm === p.id ? (
                      <>
                        <button
                          onClick={() => handleDelete(p.id)}
                          className="btn-danger text-xs px-2 py-1"
                        >
                          Confirm
                        </button>
                        <button
                          onClick={() => setDeleteConfirm(null)}
                          className="btn-secondary text-xs px-2 py-1"
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => setDeleteConfirm(p.id)}
                        className="btn-danger text-xs px-2 py-1"
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Modal */}
      {modalOpen && (
        <ProviderModal initial={editing} onClose={closeModal} onSave={handleSaved} />
      )}
    </div>
  )
}
