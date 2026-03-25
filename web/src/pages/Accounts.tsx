import { ChangeEvent, FormEvent, useCallback, useEffect, useRef, useState } from 'react'
import { api, Account, AccountInput, AccountLimit, TestResult } from '../lib/api'
import { RateLimitTable, formatCompact } from '../components/RateLimitTable'

const PROVIDER_TYPES = ['groq', 'google', 'openrouter', 'cerebras', 'mistral', 'github', 'ollama', 'openai-compatible']

const PROVIDER_TYPE_URLS: Record<string, string> = {
  groq: 'https://api.groq.com/openai/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  cerebras: 'https://api.cerebras.ai/v1',
  mistral: 'https://api.mistral.ai/v1',
  github: 'https://models.inference.ai.azure.com',
  ollama: 'http://localhost:11434/v1',
  google: '',
  'openai-compatible': '',
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

function parseAccountModels(modelsJSON: string): string[] {
  try {
    return JSON.parse(modelsJSON) as string[]
  } catch {
    return []
  }
}

// ─── Edit Modal (existing accounts) ──────────────────────────────────────────

interface AccountModalProps {
  initial: Account
  onClose: () => void
  onSave: () => void
}

function AccountEditModal({ initial, onClose, onSave }: AccountModalProps) {
  const [form, setForm] = useState<AccountInput>(() => ({
    name: initial.name,
    type: initial.type,
    base_url: initial.base_url,
    api_key: '',
    models: parseAccountModels(initial.models),
    priority: initial.priority,
    enabled: initial.enabled,
    default_model: initial.default_model ?? '',
    limits: initial.limits ?? [],
  }))
  const [modelsRaw, setModelsRaw] = useState(formatModels(parseAccountModels(initial.models)))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function set<K extends keyof AccountInput>(k: K, v: AccountInput[K]) {
    setForm((f) => {
      const next = { ...f, [k]: v }
      if (k === 'type') {
        const typeStr = v as string
        const defaultUrl = PROVIDER_TYPE_URLS[typeStr] ?? ''
        const allDefaults = Object.values(PROVIDER_TYPE_URLS)
        if (!next.base_url || allDefaults.includes(next.base_url)) {
          next.base_url = defaultUrl
        }
      }
      return next
    })
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')
    const payload: AccountInput = { ...form, models: parseModels(modelsRaw) }
    try {
      await api.accounts.update(initial.id, payload)
      onSave()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const parsedModels = parseModels(modelsRaw)

  const hasChanges = (() => {
    if (form.api_key) return true // new API key entered
    if (form.name !== initial.name) return true
    if (form.type !== initial.type) return true
    if (form.base_url !== initial.base_url) return true
    if (form.priority !== initial.priority) return true
    if (form.enabled !== initial.enabled) return true
    if (form.default_model !== (initial.default_model ?? '')) return true
    if (JSON.stringify(parsedModels) !== JSON.stringify(parseAccountModels(initial.models))) return true
    if (JSON.stringify(form.limits) !== JSON.stringify(initial.limits ?? [])) return true
    return false
  })()

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
      <div className="card w-full max-w-4xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border flex-shrink-0">
          <h2 className="font-semibold text-text-primary">Edit Account</h2>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary transition-colors">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">Name</label>
                <input className="input" value={form.name} onChange={(e) => set('name', e.target.value)} required />
              </div>
              <div>
                <label className="label">Provider</label>
                <select className="input" value={form.type} onChange={(e) => set('type', e.target.value)}>
                  {PROVIDER_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">Base URL</label>
                <input className="input" value={form.base_url} onChange={(e) => set('base_url', e.target.value)} />
              </div>
              <div>
                <label className="label">
                  API Key <span className="text-text-muted normal-case">(blank = keep current)</span>
                </label>
                <input
                  className="input font-mono"
                  type="password"
                  value={form.api_key}
                  onChange={(e) => set('api_key', e.target.value)}
                  placeholder="••••••••"
                  autoComplete="off"
                />
              </div>
            </div>

            <div>
              <label className="label">Models (one per line or comma-separated)</label>
              <textarea
                className="input font-mono resize-none"
                rows={2}
                value={modelsRaw}
                onChange={(e) => setModelsRaw(e.target.value)}
                placeholder="gpt-4o&#10;gpt-4o-mini"
              />
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="label">Default Model</label>
                <select className="input" value={form.default_model} onChange={(e) => set('default_model', e.target.value)}>
                  <option value="">(none)</option>
                  {parsedModels.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Priority</label>
                <input
                  className="input"
                  type="number"
                  min={0}
                  value={form.priority}
                  onChange={(e) => set('priority', parseInt(e.target.value) || 0)}
                />
              </div>
              <div className="flex items-end pb-1">
                <div className="flex items-center gap-2">
                  <input
                    id="edit-enabled"
                    type="checkbox"
                    className="checkbox"
                    checked={form.enabled}
                    onChange={(e) => set('enabled', e.target.checked)}
                  />
                  <label htmlFor="edit-enabled" className="text-text-primary">Enabled</label>
                </div>
              </div>
            </div>

            <div>
              <label className="label mb-2">Rate Limits</label>
              <RateLimitTable
                models={parsedModels}
                limits={form.limits}
                onChange={(newLimits) => set('limits', newLimits)}
              />
            </div>

            {error && (
              <p className="text-error bg-error/10 border border-error/30 rounded-md px-3 py-2">{error}</p>
            )}
          </div>

          <div className="flex justify-end gap-2 px-5 py-3 border-t border-border flex-shrink-0">
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={saving || !hasChanges} className="btn-primary disabled:opacity-50">
              {saving ? 'Saving…' : 'Update'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Add Account Wizard ───────────────────────────────────────────────────────

interface WizardProps {
  onClose: () => void
  onSave: () => void
}

interface WizardStep1 {
  name: string
  type: string
  base_url: string
  api_key: string
}

function AccountWizard({ onClose, onSave }: WizardProps) {
  const [step, setStep] = useState<1 | 2 | 3>(1)

  // Step 1 state
  const [s1, setS1] = useState<WizardStep1>({
    name: '',
    type: 'groq',
    base_url: PROVIDER_TYPE_URLS['groq'],
    api_key: '',
  })

  // Step 2 state
  const [freeOnly, setFreeOnly] = useState(true)
  const [discovering, setDiscovering] = useState(false)
  const [discoverError, setDiscoverError] = useState('')
  const [availableModels, setAvailableModels] = useState<string[]>([])
  const [selectedModels, setSelectedModels] = useState<Set<string>>(new Set())
  const [defaultModel, setDefaultModel] = useState('')
  const [discovered, setDiscovered] = useState(false)

  // Step 3 state
  const [limits, setLimits] = useState<AccountLimit[]>([])
  const [priority, setPriority] = useState(0)
  const [enabled, setEnabled] = useState(true)
  const [loadingDefaults, setLoadingDefaults] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')

  function setS1Field<K extends keyof WizardStep1>(k: K, v: WizardStep1[K]) {
    setS1((prev) => {
      const next = { ...prev, [k]: v }
      if (k === 'type') {
        const typeStr = v as string
        const defaultUrl = PROVIDER_TYPE_URLS[typeStr] ?? ''
        const allDefaults = Object.values(PROVIDER_TYPE_URLS)
        if (!next.base_url || allDefaults.includes(next.base_url)) {
          next.base_url = defaultUrl
        }
      }
      return next
    })
  }

  async function handleDiscover() {
    setDiscovering(true)
    setDiscoverError('')
    try {
      const result = await api.accounts.discover({
        type: s1.type,
        base_url: s1.base_url,
        api_key: s1.api_key,
        free_only: freeOnly,
      })
      const ids = result.models.map((m) => m.id)
      setAvailableModels(ids)
      setSelectedModels(new Set(ids))
      setDefaultModel(ids[0] ?? '')
      setDiscovered(true)
    } catch (err) {
      setDiscoverError(err instanceof Error ? err.message : 'Discovery failed')
    } finally {
      setDiscovering(false)
    }
  }

  async function goToStep3() {
    const models = Array.from(selectedModels)
    setLoadingDefaults(true)
    try {
      // Load admin-defined rate limit defaults for the selected models.
      const defaults = await api.ratelimits.defaults(s1.type, models)
      setLimits(defaults ?? [])
    } catch {
      setLimits([])
    } finally {
      setLoadingDefaults(false)
    }
    setStep(3)
  }

  function toggleModel(id: string) {
    setSelectedModels((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
        if (defaultModel === id) setDefaultModel('')
      } else {
        next.add(id)
      }
      return next
    })
  }

  function toggleAll() {
    if (selectedModels.size === availableModels.length) {
      setSelectedModels(new Set())
      setDefaultModel('')
    } else {
      setSelectedModels(new Set(availableModels))
      if (!defaultModel && availableModels.length > 0) setDefaultModel(availableModels[0])
    }
  }

  async function handleSave() {
    setSaving(true)
    setSaveError('')
    const payload: AccountInput = {
      name: s1.name,
      type: s1.type,
      base_url: s1.base_url,
      api_key: s1.api_key,
      models: Array.from(selectedModels),
      priority,
      enabled,
      default_model: defaultModel,
      limits,
    }
    try {
      await api.accounts.create(payload)
      onSave()
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const selectedList = Array.from(selectedModels)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
      <div className="card w-full max-w-4xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div>
            <h2 className="font-semibold text-text-primary">Add Account</h2>
            <p className="text-xs text-text-muted mt-0.5">
              Step {step} of 3 — {step === 1 ? 'Credentials' : step === 2 ? 'Discover Models' : 'Rate Limits & Confirm'}
            </p>
          </div>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary transition-colors">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z" />
            </svg>
          </button>
        </div>

        {/* Step indicator */}
        <div className="px-5 pt-3 flex items-center gap-1">
          {[1, 2, 3].map((n) => (
            <div key={n} className="flex items-center gap-1">
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium ${
                n < step ? 'bg-success text-white' : n === step ? 'bg-accent text-white' : 'bg-surface-overlay text-text-muted'
              }`}>
                {n < step ? (
                  <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M13.485 1.431a1.473 1.473 0 0 1 2.104 2.062l-7.84 9.801a1.473 1.473 0 0 1-2.12.04L.431 8.138a1.473 1.473 0 0 1 2.084-2.083l4.111 4.112 6.82-8.69a.486.486 0 0 1 .04-.046z" />
                  </svg>
                ) : n}
              </div>
              {n < 3 && <div className={`h-px w-8 ${n < step ? 'bg-success' : 'bg-border'}`} />}
            </div>
          ))}
        </div>

        <div className="px-5 py-4 space-y-4">
          {/* ── Step 1: Credentials ── */}
          {step === 1 && (
            <>
              <div>
                <label className="label">Name</label>
                <input
                  className="input"
                  value={s1.name}
                  onChange={(e) => setS1Field('name', e.target.value)}
                  placeholder="my-groq-1"
                />
              </div>

              <div>
                <label className="label">Provider</label>
                <select
                  className="input"
                  value={s1.type}
                  onChange={(e) => setS1Field('type', e.target.value)}
                >
                  {PROVIDER_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>

              <div>
                <label className="label">Base URL</label>
                <input
                  className="input"
                  value={s1.base_url}
                  onChange={(e) => setS1Field('base_url', e.target.value)}
                  placeholder="https://api.openai.com/v1"
                />
              </div>

              <div>
                <label className="label">API Key</label>
                <input
                  className="input font-mono"
                  type="password"
                  value={s1.api_key}
                  onChange={(e) => setS1Field('api_key', e.target.value)}
                  placeholder="sk-..."
                  autoComplete="off"
                />
              </div>

              <div className="flex justify-end pt-2 border-t border-border">
                <button
                  type="button"
                  disabled={!s1.name || !s1.api_key}
                  onClick={() => setStep(2)}
                  className="btn-primary disabled:opacity-50"
                >
                  Next
                </button>
              </div>
            </>
          )}

          {/* ── Step 2: Discovery ── */}
          {step === 2 && (
            <>
              <div className="flex items-center gap-2">
                <input
                  id="free-only"
                  type="checkbox"
                  className="checkbox"
                  checked={freeOnly}
                  onChange={(e) => setFreeOnly(e.target.checked)}
                />
                <label htmlFor="free-only" className="text-text-primary">
                  Free models only
                  <span className="text-text-muted ml-1">(OpenRouter)</span>
                </label>
              </div>

              <button
                type="button"
                onClick={handleDiscover}
                disabled={discovering}
                className="btn-secondary w-full"
              >
                {discovering ? (
                  <span className="flex items-center gap-2">
                    <svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
                    </svg>
                    Discovering…
                  </span>
                ) : 'Discover Models'}
              </button>

              {discoverError && (
                <p className="text-error bg-error/10 border border-error/30 rounded-md px-3 py-2">{discoverError}</p>
              )}

              {discovered && availableModels.length > 0 && (
                <>
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="label mb-0">Available Models ({selectedModels.size}/{availableModels.length} selected)</label>
                      <button type="button" onClick={toggleAll} className="btn-secondary text-xs px-2 py-1">
                        {selectedModels.size === availableModels.length ? 'Deselect all' : 'Select all'}
                      </button>
                    </div>
                    <div className="max-h-48 overflow-y-auto border border-border rounded-md divide-y divide-border">
                      {availableModels.map((id) => (
                        <label key={id} className="flex items-center gap-2.5 px-3 py-2 hover:bg-surface-overlay cursor-pointer">
                          <input
                            type="checkbox"
                            checked={selectedModels.has(id)}
                            onChange={() => toggleModel(id)}
                            className="rounded border-border bg-surface flex-shrink-0"
                          />
                          <span className="text-text-primary font-mono truncate">{id}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="label">Default Model</label>
                    <select
                      className="input"
                      value={defaultModel}
                      onChange={(e) => setDefaultModel(e.target.value)}
                    >
                      <option value="">(none)</option>
                      {selectedList.map((m) => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </div>
                </>
              )}

              {discovered && availableModels.length === 0 && (
                <p className="text-text-muted text-center py-4">No models found.</p>
              )}

              <div className="flex justify-between pt-2 border-t border-border">
                <button type="button" onClick={() => setStep(1)} className="btn-secondary">Back</button>
                <button
                  type="button"
                  disabled={loadingDefaults}
                  onClick={goToStep3}
                  className="btn-primary disabled:opacity-50"
                >
                  {loadingDefaults ? 'Loading…' : 'Next'}
                </button>
              </div>
            </>
          )}

          {/* ── Step 3: Rate Limits & Confirm ── */}
          {step === 3 && (
            <>
              <div>
                <label className="label">Priority (lower = higher priority)</label>
                <input
                  className="input"
                  type="number"
                  min={0}
                  value={priority}
                  onChange={(e) => setPriority(parseInt(e.target.value) || 0)}
                />
              </div>

              <div className="flex items-center gap-2">
                <input
                  id="wizard-enabled"
                  type="checkbox"
                  className="checkbox"
                  checked={enabled}
                  onChange={(e) => setEnabled(e.target.checked)}
                />
                <label htmlFor="wizard-enabled" className="text-text-primary">Enabled</label>
              </div>

              <div>
                <label className="label mb-2">Rate Limits</label>
                <RateLimitTable
                  models={selectedList}
                  limits={limits}
                  onChange={setLimits}
                />
              </div>

              {/* Summary */}
              <div className="bg-surface border border-border rounded-md px-4 py-3 space-y-1">
                <p className="text-text-secondary">
                  <span className="text-text-muted">Provider:</span>{' '}
                  <span className="text-text-primary font-medium">{s1.type}</span>
                </p>
                <p className="text-text-secondary">
                  <span className="text-text-muted">Models:</span>{' '}
                  <span className="text-text-primary">{selectedList.length === 0 ? 'none' : selectedList.join(', ')}</span>
                </p>
                {defaultModel && (
                  <p className="text-text-secondary">
                    <span className="text-text-muted">Default model:</span>{' '}
                    <span className="text-text-primary font-mono">{defaultModel}</span>
                  </p>
                )}
              </div>

              {saveError && (
                <p className="text-error bg-error/10 border border-error/30 rounded-md px-3 py-2">{saveError}</p>
              )}

              <div className="flex justify-between pt-2 border-t border-border">
                <button type="button" onClick={() => setStep(2)} className="btn-secondary">Back</button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={handleSave}
                  className="btn-primary disabled:opacity-50"
                >
                  {saving ? 'Saving…' : 'Save Account'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Models Accordion (collapsed by default) ────────────────────────────────

function ModelsAccordion({ models, defaultModel }: { models: string[]; defaultModel: string }) {
  const [open, setOpen] = useState(false)
  if (models.length === 0) return null
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 text-xs text-text-secondary hover:text-text-primary transition-colors"
      >
        <span className={`transition-transform ${open ? 'rotate-90' : ''}`}>&#9654;</span>
        Models ({models.length})
      </button>
      {open && (
        <div className="flex flex-wrap gap-1 mt-1.5">
          {models.map((m) => (
            <span
              key={m}
              className={`badge-accent font-mono text-xs ${defaultModel === m ? 'ring-1 ring-accent' : ''}`}
              title={defaultModel === m ? 'Default model' : undefined}
            >
              {m}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Rate Limit Popover (read-only) ──────────────────────────────────────────

function RateLimitPopover({ limits, models }: { limits: AccountLimit[]; models: string[] }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 text-xs text-text-secondary hover:text-text-primary transition-colors"
      >
        <span className={`transition-transform ${open ? 'rotate-90' : ''}`}>&#9654;</span>
        Rate Limits ({limits.length})
      </button>
      {open && (
        <div className="absolute z-50 left-0 top-full mt-1 w-max shadow-lg rounded-lg border border-border bg-surface-raised">
          <RateLimitTable
            models={models}
            limits={limits}
            onChange={() => {}}
            defaultRowLabel="Account Default"
            readOnly
          />
        </div>
      )}
    </div>
  )
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function Accounts() {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [wizardOpen, setWizardOpen] = useState(false)
  const [editing, setEditing] = useState<Account | null>(null)
  const [testResults, setTestResults] = useState<Record<number, TestResult | 'testing'>>({})
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null)
  const importRef = useRef<HTMLInputElement>(null)

  const fetchAccounts = useCallback(async () => {
    try {
      const data = await api.accounts.list()
      setAccounts(data ?? [])
      setError('')
    } catch {
      setError('Failed to load accounts.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchAccounts()
  }, [fetchAccounts])

  async function handleDelete(id: number) {
    try {
      await api.accounts.delete(id)
      setDeleteConfirm(null)
      fetchAccounts()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed')
    }
  }

  async function handleTest(id: number) {
    setTestResults((r) => ({ ...r, [id]: 'testing' }))
    try {
      const result = await api.accounts.test(id)
      setTestResults((r) => ({ ...r, [id]: result }))
    } catch {
      setTestResults((r) => ({ ...r, [id]: { success: false, error: 'Request failed' } }))
    }
  }

  async function handleImport(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const text = await file.text()
    try {
      const res = await api.config.import(text)
      alert(`Imported ${res.imported} account(s).`)
      fetchAccounts()
    } catch (err) {
      alert('Import failed: ' + (err instanceof Error ? err.message : 'unknown'))
    }
    e.target.value = ''
  }

  function openEdit(p: Account) {
    setEditing(p)
  }

  function closeEdit() {
    setEditing(null)
  }

  function handleSaved() {
    setWizardOpen(false)
    setEditing(null)
    fetchAccounts()
  }

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-text-primary">Accounts</h1>
          <p className="text-sm text-text-secondary mt-0.5">Manage LLM backend accounts</p>
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={importRef}
            type="file"
            accept=".yml,.yaml"
            className="hidden"
            onChange={handleImport}
          />
          <button onClick={() => importRef.current?.click()} className="btn-secondary">
            Import YAML
          </button>
          <a href={api.config.exportUrl()} download className="btn-secondary">
            Export YAML
          </a>
          <button onClick={() => setWizardOpen(true)} className="btn-primary">
            Add Account
          </button>
        </div>
      </div>

      {error && (
        <div className="text-error bg-error/10 border border-error/30 rounded-md px-3 py-2">
          {error}
        </div>
      )}

      {/* Account list */}
      {loading ? (
        <div className="text-text-muted text-center py-16">Loading…</div>
      ) : accounts.length === 0 ? (
        <div className="card p-10 text-center">
          <p className="text-text-secondary mb-3">No accounts configured yet.</p>
          <button onClick={() => setWizardOpen(true)} className="btn-primary">
            Add your first account
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {accounts.map((p) => {
            const models = parseAccountModels(p.models)
            const available = p.status?.available ?? p.enabled
            const rateLimited = p.status?.reason?.includes('exhausted') ?? false
            const testRes = testResults[p.id]

            const stripColor = !p.enabled
              ? 'bg-text-muted'
              : rateLimited
                ? 'bg-warning'
                : available
                  ? 'bg-success'
                  : 'bg-error'

            return (
              <div
                key={p.id}
                className={`card overflow-visible flex ${!p.enabled ? 'opacity-60' : ''}`}
              >
                {/* Left color strip */}
                <div className={`w-1 flex-shrink-0 rounded-l-lg ${stripColor}`} />

                <div className="flex-1 p-3 min-w-0">
                  {/* Header: name + badges + icon actions */}
                  <div className="flex items-center gap-2 mb-2">
                    <span className="font-semibold text-text-primary truncate">{p.name}</span>
                    <span className="badge-neutral text-xs flex-shrink-0">{p.type}</span>
                    {!p.enabled && <span className="badge-warning text-xs flex-shrink-0">disabled</span>}
                    {rateLimited && <span className="badge-warning text-xs flex-shrink-0">rate limited</span>}
                    <span className="flex-1" />
                    <div className="flex gap-0.5 flex-shrink-0">
                      <button
                        onClick={() => handleTest(p.id)}
                        disabled={testRes === 'testing'}
                        className="p-1 rounded hover:bg-surface-overlay text-accent transition-colors disabled:opacity-50"
                        title="Test connectivity"
                      >
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M11.251.068a.5.5 0 0 1 .227.58L9.677 6.5H13a.5.5 0 0 1 .364.843l-8 8.5a.5.5 0 0 1-.842-.49L6.323 9.5H3a.5.5 0 0 1-.364-.843l8-8.5a.5.5 0 0 1 .615-.09z"/></svg>
                      </button>
                      <button
                        onClick={() => openEdit(p)}
                        className="p-1 rounded hover:bg-surface-overlay text-text-secondary transition-colors"
                        title="Edit account"
                      >
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M12.854.146a.5.5 0 0 0-.707 0L10.5 1.793 14.207 5.5l1.647-1.646a.5.5 0 0 0 0-.708l-3-3zM13.5 6.207 9.793 2.5 3.5 8.793V12.5h3.707l6.293-6.293z"/><path d="M1 13.5V16h2.5l.793-.793H1.5v-1.914L1 13.5z"/></svg>
                      </button>
                      {deleteConfirm === p.id ? (
                        <>
                          <button
                            onClick={() => handleDelete(p.id)}
                            className="p-1 rounded bg-error/10 text-error transition-colors"
                            title="Confirm delete"
                          >
                            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M12.736 3.97a.733.733 0 0 1 1.047 0c.286.289.29.756.01 1.05L7.88 12.01a.733.733 0 0 1-1.065.02L3.217 8.384a.757.757 0 0 1 0-1.06.733.733 0 0 1 1.047 0l3.052 3.093 5.4-6.425z"/></svg>
                          </button>
                          <button
                            onClick={() => setDeleteConfirm(null)}
                            className="p-1 rounded hover:bg-surface-overlay text-text-muted transition-colors"
                            title="Cancel"
                          >
                            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z"/></svg>
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => setDeleteConfirm(p.id)}
                          className="p-1 rounded hover:bg-error/10 text-error/60 hover:text-error transition-colors"
                          title="Delete account"
                        >
                          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z"/><path fillRule="evenodd" d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4L4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z"/></svg>
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Stats bar */}
                  <div className="flex gap-3 px-2.5 py-1.5 bg-surface/50 rounded-md mb-2 text-center">
                    <div className="flex-1">
                      <div className="text-xs text-text-muted uppercase tracking-wide">Requests</div>
                      <div className="font-bold text-text-primary">{formatCompact(p.total_requests)}</div>
                    </div>
                    <div className="w-px bg-border" />
                    <div className="flex-1">
                      <div className="text-xs text-text-muted uppercase tracking-wide">Tokens</div>
                      <div className="font-bold text-text-primary">{formatCompact(p.total_tokens)}</div>
                    </div>
                    <div className="w-px bg-border" />
                    <div className="flex-1">
                      <div className="text-xs text-text-muted uppercase tracking-wide">Default</div>
                      <div className="text-xs font-mono text-accent truncate">{p.default_model || '—'}</div>
                    </div>
                    <div className="w-px bg-border" />
                    <div className="flex-shrink-0 w-10">
                      <div className="text-xs text-text-muted uppercase tracking-wide">Pri</div>
                      <div className="font-bold text-text-primary">{p.priority}</div>
                    </div>
                  </div>

                  {/* Test result */}
                  {testRes && testRes !== 'testing' && (
                    <div
                      className={`mb-2 text-xs px-2 py-1 rounded inline-flex items-center gap-1 ${
                        testRes.success ? 'bg-success/10 text-success' : 'bg-error/10 text-error'
                      }`}
                    >
                      {testRes.success
                        ? `Connected (HTTP ${testRes.status_code})`
                        : `Failed: ${testRes.error}`}
                    </div>
                  )}

                  {/* Accordions */}
                  <div className="space-y-1">
                    <ModelsAccordion models={models} defaultModel={p.default_model} />
                    {p.limits && p.limits.length > 0 && (
                      <RateLimitPopover limits={p.limits} models={models} />
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Add wizard */}
      {wizardOpen && (
        <AccountWizard onClose={() => setWizardOpen(false)} onSave={handleSaved} />
      )}

      {/* Edit modal */}
      {editing && (
        <AccountEditModal initial={editing} onClose={closeEdit} onSave={handleSaved} />
      )}
    </div>
  )
}
