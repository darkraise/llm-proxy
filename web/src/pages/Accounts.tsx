import React, { ChangeEvent, FormEvent, useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  api, Account, AccountInput, AccountLimit, TestResult,
  MODEL_CATEGORIES, ModelCategory,
  parseCategorizedModels, parseDefaultModels, flattenModels, buildModelCategoryMap,
} from '../lib/api'
import { RateLimitTable } from '../components/RateLimitTable'
import { AccountCard } from '../components/AccountCard'
import { AccountListRow, LIST_GRID_COLS } from '../components/AccountListRow'
import { AccountDrawer } from '../components/AccountDrawer'
import { useLocalStorage } from '../hooks/useLocalStorage'
import { LayoutGrid, List, Plus, X } from 'lucide-react'
import { Button } from '../components/ui/Button'
import { Select } from '../components/ui/Select'

const PROVIDER_TYPES = ['groq', 'google', 'openrouter', 'cerebras', 'mistral', 'github', 'cohere', 'nvidia', 'llm7', 'ollama', 'openai-compatible']

const PROVIDER_TYPE_URLS: Record<string, string> = {
  groq: 'https://api.groq.com/openai/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  cerebras: 'https://api.cerebras.ai/v1',
  mistral: 'https://api.mistral.ai/v1',
  github: 'https://models.inference.ai.azure.com',
  cohere: 'https://api.cohere.ai/compatibility/v1',
  llm7: 'https://api.llm7.io/v1',
  nvidia: 'https://integrate.api.nvidia.com/v1',
  ollama: 'http://localhost:11434/v1',
  google: '',
  'openai-compatible': '',
}

// Providers with hardcoded base URLs — no need to show base URL field
const FIXED_URL_PROVIDERS = new Set(['groq', 'openrouter', 'cerebras', 'mistral', 'github', 'cohere', 'nvidia', 'llm7', 'google'])

// ─── Edit Modal (existing accounts) ──────────────────────────────────────────

interface AccountModalProps {
  initial: Account
  onClose: () => void
  onSave: () => void
}

function AccountEditModal({ initial, onClose, onSave }: AccountModalProps): React.ReactNode {
  const initialCategorized = parseCategorizedModels(initial.models)
  const initialDefaults = parseDefaultModels(initial.default_models)

  const [form, setForm] = useState<AccountInput>(() => ({
    name: initial.name,
    type: initial.type,
    base_url: initial.base_url,
    api_key: '',
    models: initialCategorized,
    priority: initial.priority,
    enabled: initial.enabled,
    default_models: initialDefaults,
    limits: initial.limits ?? [],
  }))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [providerMetrics, setProviderMetrics] = useState<string[] | undefined>()

  useEffect(() => {
    api.ratelimits.metrics(initial.type)
      .then((m) => setProviderMetrics(m))
      .catch(() => setProviderMetrics(undefined))
  }, [initial.type])

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
    try {
      await api.accounts.update(initial.id, form)
      onSave()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const currentFlat = flattenModels(form.models)
  const currentCategoryMap = buildModelCategoryMap(form.models)

  const hasChanges = (() => {
    if (form.api_key) return true
    if (form.name !== initial.name) return true
    if (form.type !== initial.type) return true
    if (form.base_url !== initial.base_url) return true
    if (form.priority !== initial.priority) return true
    if (form.enabled !== initial.enabled) return true
    if (JSON.stringify(form.default_models) !== JSON.stringify(initialDefaults)) return true
    if (JSON.stringify(form.models) !== JSON.stringify(initialCategorized)) return true
    if (JSON.stringify(form.limits) !== JSON.stringify(initial.limits ?? [])) return true
    return false
  })()

  function handleCategoryChange(model: string, newCategory: string) {
    const updated = { ...form.models }
    for (const cat of Object.keys(updated)) {
      updated[cat] = updated[cat].filter((m) => m !== model)
      if (updated[cat].length === 0) delete updated[cat]
    }
    if (!updated[newCategory]) updated[newCategory] = []
    updated[newCategory].push(model)
    set('models', updated)
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-surface-overlay border border-border rounded-xl max-w-xl w-full mx-4 max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border flex-shrink-0">
          <h2 className="font-semibold text-text-primary">Edit Account</h2>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X size={16} />
          </Button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">Name</label>
                <input className="input" value={form.name} onChange={(e) => set('name', e.target.value)} required autoComplete="one-time-code" />
              </div>
              <div>
                <label className="label">Provider</label>
                <Select
                  value={form.type}
                  onChange={(v) => set('type', v)}
                  options={PROVIDER_TYPES.map((t) => ({ value: t, label: t }))}
                />
              </div>
            </div>

            <div className={`grid gap-4 ${FIXED_URL_PROVIDERS.has(initial.type) ? '' : 'grid-cols-2'}`}>
              {!FIXED_URL_PROVIDERS.has(initial.type) && (
                <div>
                  <label className="label">Base URL</label>
                  <input className="input" value={form.base_url} onChange={(e) => set('base_url', e.target.value)} />
                </div>
              )}
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
                  autoComplete="one-time-code"
                />
              </div>
            </div>

            {/* Per-category default model selectors */}
            <div className="grid grid-cols-2 gap-4">
              {MODEL_CATEGORIES.map((cat) => {
                const catModels = form.models[cat] ?? []
                return (
                  <div key={cat}>
                    <label className="label">Default {cat} model</label>
                    <Select
                      value={form.default_models[cat] ?? ''}
                      onChange={(v) => {
                        const updated = { ...form.default_models, [cat]: v }
                        if (!v) delete updated[cat]
                        set('default_models', updated)
                      }}
                      options={[
                        { value: '', label: '(none)' },
                        ...catModels.map((m) => ({ value: m, label: m })),
                      ]}
                    />
                  </div>
                )
              })}
            </div>

            <div className="grid grid-cols-3 gap-4">
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
                models={currentFlat}
                limits={form.limits}
                onChange={(newLimits) => set('limits', newLimits)}
                modelCategories={currentCategoryMap}
                onCategoryChange={handleCategoryChange}
                visibleMetrics={providerMetrics}
              />
            </div>

            {error && (
              <p className="text-error bg-error/10 border border-error/30 rounded-md px-3 py-2">{error}</p>
            )}
          </div>

          <div className="flex justify-end gap-2 px-5 py-3 border-t border-border flex-shrink-0">
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={saving || !hasChanges} className="btn-primary disabled:opacity-50">
              {saving ? 'Saving\u2026' : 'Update'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
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

function AccountWizard({ onClose, onSave }: WizardProps): React.ReactNode {
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
  const [modelCategories, setModelCategories] = useState<Record<string, ModelCategory | 'skip'>>({})
  const [defaultModels, setDefaultModels] = useState<Record<string, string>>({})
  const [discovered, setDiscovered] = useState(false)
  const [modelSearch, setModelSearch] = useState('')
  const [debouncedModelSearch, setDebouncedModelSearch] = useState('')

  // Step 3 state
  const [limits, setLimits] = useState<AccountLimit[]>([])
  const [priority, setPriority] = useState(0)
  const [enabled, setEnabled] = useState(true)
  const [loadingDefaults, setLoadingDefaults] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [s1Errors, setS1Errors] = useState<Partial<Record<keyof WizardStep1, string>>>({})
  const [providerMetrics, setProviderMetrics] = useState<string[] | undefined>()

  function validateStep1(): boolean {
    const errors: Partial<Record<keyof WizardStep1, string>> = {}
    if (!s1.name.trim()) errors.name = 'Name is required'
    if (!s1.api_key.trim()) errors.api_key = 'API key is required'
    if (!FIXED_URL_PROVIDERS.has(s1.type) && !s1.base_url.trim()) errors.base_url = 'Base URL is required'
    setS1Errors(errors)
    return Object.keys(errors).length === 0
  }

  function goToStep2() {
    if (validateStep1()) setStep(2)
  }

  function setS1Field<K extends keyof WizardStep1>(k: K, v: WizardStep1[K]) {
    if (s1Errors[k]) setS1Errors((prev) => { const next = { ...prev }; delete next[k]; return next })
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

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedModelSearch(modelSearch), 500)
    return () => clearTimeout(timer)
  }, [modelSearch])

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
      const ids = [...new Set(result.models.map((m) => m.id))]
      setAvailableModels(ids)
      setSelectedModels(new Set(ids))
      // Auto-assign categories: embedding for embed-like names, chat for everything else
      const cats: Record<string, ModelCategory | 'skip'> = {}
      for (const id of ids) {
        cats[id] = id.includes('embed') ? 'embedding' : 'chat'
      }
      setModelCategories(cats)
      // Auto-set default models per category
      const chatModels = ids.filter((id) => cats[id] === 'chat')
      const embeddingModels = ids.filter((id) => cats[id] === 'embedding')
      const defs: Record<string, string> = {}
      if (chatModels.length > 0) defs.chat = chatModels[0]
      if (embeddingModels.length > 0) defs.embedding = embeddingModels[0]
      setDefaultModels(defs)
      setDiscovered(true)
    } catch (err) {
      setDiscoverError(err instanceof Error ? err.message : 'Discovery failed')
    } finally {
      setDiscovering(false)
    }
  }

  async function goToStep3() {
    const models = Array.from(selectedModels).filter((m) => modelCategories[m] !== 'skip')
    setLoadingDefaults(true)
    try {
      const [defaults, metrics] = await Promise.all([
        api.ratelimits.defaults(s1.type, models),
        api.ratelimits.metrics(s1.type).catch(() => undefined),
      ])
      setLimits(defaults ?? [])
      setProviderMetrics(metrics)
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
      } else {
        next.add(id)
      }
      return next
    })
  }

  function toggleAll() {
    setSelectedModels((prev) => {
      if (prev.size === availableModels.length) {
        return new Set<string>()
      } else {
        return new Set(availableModels)
      }
    })
  }

  // Build models map from categories
  function buildModelsMap(): Record<string, string[]> {
    const modelsMap: Record<string, string[]> = {}
    for (const [model, cat] of Object.entries(modelCategories)) {
      if (cat !== 'skip' && selectedModels.has(model)) {
        if (!modelsMap[cat]) modelsMap[cat] = []
        modelsMap[cat].push(model)
      }
    }
    // Remove empty categories
    for (const k of Object.keys(modelsMap)) {
      if (modelsMap[k].length === 0) delete modelsMap[k]
    }
    return modelsMap
  }

  // Build category map for active models (for rate limit table)
  function buildActiveCategoryMap(): Record<string, string> {
    const map: Record<string, string> = {}
    for (const [model, cat] of Object.entries(modelCategories)) {
      if (cat !== 'skip' && selectedModels.has(model)) {
        map[model] = cat
      }
    }
    return map
  }

  async function handleSave() {
    setSaving(true)
    setSaveError('')
    const modelsMap = buildModelsMap()
    // Clean defaultModels to only include categories that have models
    const cleanDefaults: Record<string, string> = {}
    for (const [cat, def] of Object.entries(defaultModels)) {
      if (def && modelsMap[cat]?.includes(def)) {
        cleanDefaults[cat] = def
      }
    }
    const payload: AccountInput = {
      name: s1.name,
      type: s1.type,
      base_url: s1.base_url,
      api_key: s1.api_key,
      models: modelsMap,
      priority,
      enabled,
      default_models: cleanDefaults,
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

  const activeModels = Array.from(selectedModels).filter((m) => modelCategories[m] !== 'skip')
  const activeCategoryMap = buildActiveCategoryMap()

  // Category counts for summary
  const categoryCounts: Record<string, number> = {}
  for (const m of activeModels) {
    const cat = modelCategories[m] ?? 'chat'
    if (cat !== 'skip') {
      categoryCounts[cat] = (categoryCounts[cat] ?? 0) + 1
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-surface-overlay border border-border rounded-xl max-w-4xl w-full mx-4 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div>
            <h2 className="font-semibold text-text-primary">Add Account</h2>
            <p className="text-xs text-text-muted mt-0.5">
              Step {step} of 3 — {step === 1 ? 'Credentials' : step === 2 ? 'Discover Models' : 'Rate Limits & Confirm'}
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X size={16} />
          </Button>
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

        <div className="px-5 py-4 space-y-4 flex-1 overflow-y-auto min-h-0">
          {/* Step 1: Credentials */}
          {step === 1 && (
            <>
              <div>
                <label className="label">Provider</label>
                <Select
                  value={s1.type}
                  onChange={(v) => setS1Field('type', v)}
                  options={PROVIDER_TYPES.map((t) => ({ value: t, label: t }))}
                />
              </div>

              <div>
                <label className="label">Name <span className="text-error">*</span></label>
                <input
                  className={`input ${s1Errors.name ? 'border-error' : ''}`}
                  value={s1.name}
                  onChange={(e) => setS1Field('name', e.target.value)}
                  placeholder="my-groq-1"
                  autoComplete="one-time-code"
                />
                {s1Errors.name && <p className="text-xs text-error mt-1">{s1Errors.name}</p>}
              </div>

              {!FIXED_URL_PROVIDERS.has(s1.type) && (
                <div>
                  <label className="label">Base URL <span className="text-error">*</span></label>
                  <input
                    className={`input ${s1Errors.base_url ? 'border-error' : ''}`}
                    value={s1.base_url}
                    onChange={(e) => setS1Field('base_url', e.target.value)}
                    placeholder="https://api.openai.com/v1"
                    autoComplete="one-time-code"
                  />
                  {s1Errors.base_url && <p className="text-xs text-error mt-1">{s1Errors.base_url}</p>}
                </div>
              )}

              <div>
                <label className="label">API Key <span className="text-error">*</span></label>
                <input
                  className={`input font-mono ${s1Errors.api_key ? 'border-error' : ''}`}
                  type="password"
                  value={s1.api_key}
                  onChange={(e) => setS1Field('api_key', e.target.value)}
                  placeholder="sk-..."
                  autoComplete="one-time-code"
                />
                {s1Errors.api_key && <p className="text-xs text-error mt-1">{s1Errors.api_key}</p>}
              </div>

              <div className="flex justify-end pt-2 border-t border-border">
                <button
                  type="button"
                  disabled={!s1.name.trim() || !s1.api_key.trim() || (!FIXED_URL_PROVIDERS.has(s1.type) && !s1.base_url.trim())}
                  onClick={goToStep2}
                  className="btn-primary"
                >
                  Next
                </button>
              </div>
            </>
          )}

          {/* Step 2: Discovery */}
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
                  <span className="flex items-center justify-center gap-2">
                    <svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
                    </svg>
                    Discovering...
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
                    <input
                      className="input mb-2"
                      placeholder="Search models..."
                      value={modelSearch}
                      onChange={(e) => setModelSearch(e.target.value)}
                      autoComplete="one-time-code"
                    />
                    <div className="max-h-[60vh] overflow-y-auto border border-border rounded-md divide-y divide-border">
                      {availableModels.filter((id) => !debouncedModelSearch || id.toLowerCase().includes(debouncedModelSearch.toLowerCase())).map((id) => (
                        <label key={id} className="flex items-center gap-2.5 px-3 py-2 hover:bg-surface-overlay cursor-pointer">
                          <input
                            type="checkbox"
                            checked={selectedModels.has(id)}
                            onChange={() => toggleModel(id)}
                            className="checkbox flex-shrink-0"
                          />
                          <span className="text-text-primary font-mono truncate flex-1">{id}</span>
                          <Select
                            value={modelCategories[id] ?? 'chat'}
                            onChange={(v) => setModelCategories((prev) => ({ ...prev, [id]: v as ModelCategory | 'skip' }))}
                            options={[
                              ...MODEL_CATEGORIES.map((c) => ({ value: c, label: c })),
                              { value: 'skip', label: 'skip' },
                            ]}
                            className="w-28 text-xs h-7 flex-shrink-0"
                          />
                        </label>
                      ))}
                    </div>
                  </div>

                  {/* Per-category default model selectors */}
                  <div className="grid grid-cols-2 gap-4">
                    {MODEL_CATEGORIES.map((cat) => {
                      const catModels = availableModels.filter(
                        (m) => selectedModels.has(m) && modelCategories[m] === cat,
                      )
                      if (catModels.length === 0) return null
                      return (
                        <div key={cat}>
                          <label className="label">Default {cat} model</label>
                          <Select
                            value={defaultModels[cat] ?? ''}
                            onChange={(v) => setDefaultModels((prev) => {
                              const next = { ...prev }
                              if (v) next[cat] = v
                              else delete next[cat]
                              return next
                            })}
                            options={[
                              { value: '', label: '(none)' },
                              ...catModels.map((m) => ({ value: m, label: m })),
                            ]}
                          />
                        </div>
                      )
                    })}
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
                  {loadingDefaults ? 'Loading\u2026' : 'Next'}
                </button>
              </div>
            </>
          )}

          {/* Step 3: Rate Limits & Confirm */}
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
                  models={activeModels}
                  limits={limits}
                  onChange={setLimits}
                  maxHeight="400px"
                  modelCategories={activeCategoryMap}
                  visibleMetrics={providerMetrics}
                />
              </div>

              {/* Summary */}
              <div className="text-xs text-text-muted">
                {Object.entries(categoryCounts)
                  .map(([cat, count]) => `${count} ${cat}`)
                  .join(' \u00b7 ')}
                {' '}model{activeModels.length !== 1 ? 's' : ''} selected
                {Object.entries(defaultModels).filter(([, v]) => v).map(([cat, v]) => (
                  <span key={cat}> &middot; Default {cat}: <span className="font-mono text-text-secondary">{v}</span></span>
                ))}
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
                  {saving ? 'Saving\u2026' : 'Save Account'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
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
  const importRef = useRef<HTMLInputElement>(null)
  const [viewMode, setViewMode] = useLocalStorage<'grid' | 'list'>('llm-proxy:accounts-view', 'grid')
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null)
  const [providerFilter, setProviderFilter] = useState<string>('all')

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
      setSelectedAccountId(null)
      fetchAccounts()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed')
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

  function handleSaved() {
    setWizardOpen(false)
    setEditing(null)
    fetchAccounts()
  }

  const activeCount = accounts.filter((a) => a.enabled).length
  const providerTypes = Array.from(new Set(accounts.map((a) => a.type))).sort()
  const filteredAccounts = providerFilter === 'all' ? accounts : accounts.filter((a) => a.type === providerFilter)

  async function handleTest(id: number) {
    setTestResults((prev) => ({ ...prev, [id]: 'testing' }))
    try {
      const result = await api.accounts.test(id)
      setTestResults((prev) => ({ ...prev, [id]: result }))
    } catch (err) {
      setTestResults((prev) => ({
        ...prev,
        [id]: { success: false, error: err instanceof Error ? err.message : 'Test failed' },
      }))
    }
  }

  const selectedAccount = accounts.find((a) => a.id === selectedAccountId) ?? null

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-text-primary">Accounts</h1>
          <p className="text-sm text-text-secondary mt-0.5">
            {accounts.length} accounts &middot; {activeCount} active
          </p>
        </div>
        <div className="flex items-center gap-3">
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
          <button onClick={() => setWizardOpen(true)} className="btn-primary inline-flex items-center gap-1.5">
            <Plus size={15} />
            Add Account
          </button>
        </div>
      </div>

      {error && (
        <div className="text-error bg-error/10 border border-error/30 rounded-md px-3 py-2">
          {error}
        </div>
      )}

      {/* Provider filter + view toggle */}
      {!loading && accounts.length > 0 && (
        <div className="flex items-center justify-between">
          {providerTypes.length > 1 ? (
            <div className="flex flex-wrap gap-0 bg-[rgba(255,255,255,0.04)] border border-border rounded-lg overflow-hidden">
              {['all', ...providerTypes].map((type) => (
                <button
                  key={type}
                  onClick={() => setProviderFilter(type)}
                  className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                    providerFilter === type
                      ? 'bg-accent-muted text-accent-light'
                      : 'text-text-muted hover:text-text-secondary'
                  }`}
            >
              {type === 'all' ? 'All' : type}
            </button>
          ))}
            </div>
          ) : <div />}
          {/* View toggle */}
          <div className="flex bg-[rgba(255,255,255,0.04)] border border-border rounded-lg overflow-hidden">
            <button
              onClick={() => setViewMode('grid')}
              className={`p-1.5 transition-colors ${viewMode === 'grid' ? 'bg-accent-muted text-accent-light' : 'text-text-muted hover:text-text-secondary'}`}
              title="Grid view"
            >
              <LayoutGrid size={16} />
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`p-1.5 transition-colors ${viewMode === 'list' ? 'bg-accent-muted text-accent-light' : 'text-text-muted hover:text-text-secondary'}`}
              title="List view"
            >
              <List size={16} />
            </button>
          </div>
        </div>
      )}

      {/* Account list */}
      {loading ? (
        <div className="text-text-muted text-center py-16">Loading...</div>
      ) : filteredAccounts.length === 0 && accounts.length > 0 ? (
        <div className="bg-surface-raised border border-border rounded-xl p-10 text-center">
          <p className="text-text-secondary">No accounts match this filter.</p>
        </div>
      ) : accounts.length === 0 ? (
        <div className="bg-surface-raised border border-border rounded-xl p-10 text-center">
          <p className="text-text-secondary mb-3">No accounts configured yet.</p>
          <button onClick={() => setWizardOpen(true)} className="btn-primary inline-flex items-center gap-1.5">
            <Plus size={15} />
            Add your first account
          </button>
        </div>
      ) : viewMode === 'grid' ? (
        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 340px))' }}>
          {filteredAccounts.map((a) => (
            <AccountCard
              key={a.id}
              account={a}
              selected={selectedAccountId === a.id}
              onClick={() => setSelectedAccountId(a.id)}
            />
          ))}
        </div>
      ) : (
        <div className="bg-surface-raised border border-border rounded-xl overflow-hidden">
          {/* List header */}
          <div
            className="grid items-center px-3 py-2 border-b border-border text-[0.625rem] uppercase tracking-wider text-text-muted font-medium"
            style={{ gridTemplateColumns: LIST_GRID_COLS }}
          >
            <div />
            <div>Name</div>
            <div>Provider</div>
            <div className="text-right">Requests</div>
            <div className="text-right">Tokens</div>
            <div className="text-center">Priority</div>
            <div>Default Model</div>
            <div className="text-center">Models</div>
          </div>
          {filteredAccounts.map((a) => (
            <AccountListRow
              key={a.id}
              account={a}
              selected={selectedAccountId === a.id}
              onClick={() => setSelectedAccountId(a.id)}
            />
          ))}
        </div>
      )}

      {/* Add wizard */}
      {wizardOpen && (
        <AccountWizard onClose={() => setWizardOpen(false)} onSave={handleSaved} />
      )}

      {/* Edit modal */}
      {editing && (
        <AccountEditModal initial={editing} onClose={() => setEditing(null)} onSave={handleSaved} />
      )}

      {/* Account detail drawer */}
      <AccountDrawer
        account={selectedAccount}
        onClose={() => setSelectedAccountId(null)}
        onUpdate={() => fetchAccounts()}
        onTest={(id) => handleTest(id)}
        onDelete={(id) => handleDelete(id)}
        onClearTest={() => { if (selectedAccountId != null) setTestResults((prev) => { const next = { ...prev }; delete next[selectedAccountId]; return next; }); }}
        testResult={testResults[selectedAccountId ?? -1]}
      />
    </div>
  )
}
