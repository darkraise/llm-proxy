import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { RefreshCw, X } from 'lucide-react'
import { api, Account, AccountLimit } from '../lib/api'
import { ToggleSwitch } from './ui/ToggleSwitch'
import { RateLimitTable } from './RateLimitTable'

// ─── Types ───────────────────────────────────────────────────────────────────

interface AddModelsDialogProps {
  open: boolean
  onClose: () => void
  account: Account
  existingModels: string[]
  existingLimits: AccountLimit[]
  onFinish: (newModels: string[], newLimits: AccountLimit[]) => Promise<void>
}

// ─── Component ───────────────────────────────────────────────────────────────

export function AddModelsDialog({
  open,
  onClose,
  account,
  existingModels,
  existingLimits,
  onFinish,
}: AddModelsDialogProps) {
  const [step, setStep] = useState<1 | 2>(1)

  // Step 1 state
  const [availableModels, setAvailableModels] = useState<string[]>([])
  const [selectedModels, setSelectedModels] = useState<Set<string>>(new Set())
  const [freeOnly, setFreeOnly] = useState(false)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [fetchError, setFetchError] = useState('')

  // Step 2 state
  const [limits, setLimits] = useState<AccountLimit[]>([])
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setStep(1)
      setAvailableModels([])
      setSelectedModels(new Set())
      setFreeOnly(false)
      setSearch('')
      setLoading(false)
      setFetchError('')
      setLimits([])
      setSaving(false)
      setSaveError('')
      fetchModels(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Re-fetch when freeOnly changes (only if dialog is open)
  useEffect(() => {
    if (open) fetchModels(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [freeOnly])

  // Escape to close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    if (open) document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onClose])

  async function fetchModels(isRefresh: boolean) {
    setLoading(true)
    setFetchError('')
    if (!isRefresh) setSelectedModels(new Set())
    try {
      const result = await api.accounts.discoverByAccount(account.id)
      let ids = result.models.map((m) => m.id)

      // Filter out models already in the account
      const existingSet = new Set(existingModels)
      ids = ids.filter((id) => !existingSet.has(id))

      // Free-only filter (OpenRouter convention: models ending with :free)
      if (freeOnly && account.type === 'openrouter') {
        ids = ids.filter((id) => id.endsWith(':free'))
      }

      setAvailableModels(ids)
      if (!isRefresh) setSelectedModels(new Set())
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : 'Failed to fetch models')
    } finally {
      setLoading(false)
    }
  }

  function toggleModel(id: string) {
    setSelectedModels((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAll() {
    if (selectedModels.size === filteredModels.length) {
      setSelectedModels(new Set())
    } else {
      setSelectedModels(new Set(filteredModels))
    }
  }

  function goToStep2() {
    // Carry over existing default limits for the rate limit table
    const defaultLimits = existingLimits.filter((l) => l.model === '')
    setLimits(defaultLimits)
    setStep(2)
  }

  async function handleFinish() {
    setSaving(true)
    setSaveError('')
    try {
      // Only pass non-default limits (model-specific ones the user set)
      const newLimits = limits.filter((l) => l.model !== '')
      await onFinish(Array.from(selectedModels), newLimits)
      onClose()
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to add models')
    } finally {
      setSaving(false)
    }
  }

  // Filter models by search term
  const searchLower = search.toLowerCase()
  const filteredModels = search
    ? availableModels.filter((m) => m.toLowerCase().includes(searchLower))
    : availableModels

  const selectedList = Array.from(selectedModels)

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-surface-overlay border border-border rounded-xl max-w-2xl w-full mx-4 max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border flex-shrink-0">
          <div>
            <h2 className="font-semibold text-text-primary">Add Supported Models</h2>
            <p className="text-xs text-text-muted mt-0.5">
              Step {step} of 2 — {step === 1 ? 'Select Models' : 'Rate Limits'}
            </p>
          </div>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Step indicator */}
        <div className="px-5 pt-3 flex items-center gap-1 flex-shrink-0">
          {[1, 2].map((n) => (
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
              {n < 2 && <div className={`h-px w-8 ${n < step ? 'bg-success' : 'bg-border'}`} />}
            </div>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 flex flex-col min-h-0 px-5 py-4">
          {/* Step 1: Select Models */}
          {step === 1 && (
            <div className="flex flex-col flex-1 min-h-0 gap-3">
              {/* Controls row */}
              <div className="flex items-center justify-between flex-shrink-0">
                <ToggleSwitch
                  checked={freeOnly}
                  onChange={setFreeOnly}
                  label="Free models only"
                />
                <button
                  type="button"
                  onClick={() => fetchModels(true)}
                  disabled={loading}
                  className="btn-secondary inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5"
                  title="Refresh model list"
                >
                  <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
                  Refresh
                </button>
              </div>

              {/* Search input */}
              <input
                className="input flex-shrink-0"
                placeholder="Filter models..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />

              {/* Error */}
              {fetchError && (
                <p className="text-error bg-error/10 border border-error/30 rounded-md px-3 py-2 text-sm flex-shrink-0">
                  {fetchError}
                </p>
              )}

              {/* Loading */}
              {loading && (
                <div className="flex items-center justify-center py-8 text-text-muted text-sm">
                  <svg className="animate-spin mr-2" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
                  </svg>
                  Discovering models...
                </div>
              )}

              {/* Model list */}
              {!loading && availableModels.length > 0 && (
                <>
                  <div className="flex items-center justify-between flex-shrink-0">
                    <span className="text-xs text-text-muted">
                      {selectedModels.size}/{availableModels.length} selected
                      {search && ` (${filteredModels.length} shown)`}
                    </span>
                    <button type="button" onClick={toggleAll} className="btn-secondary text-xs px-2 py-1">
                      {selectedModels.size === filteredModels.length ? 'Deselect all' : 'Select all'}
                    </button>
                  </div>
                  <div className="flex-1 min-h-0 overflow-y-auto border border-border rounded-md divide-y divide-border">
                    {filteredModels.map((id) => (
                      <label key={id} className="flex items-center gap-2.5 px-3 py-2 hover:bg-surface-overlay cursor-pointer">
                        <input
                          type="checkbox"
                          className="checkbox"
                          checked={selectedModels.has(id)}
                          onChange={() => toggleModel(id)}
                        />
                        <span className="text-text-primary font-mono text-sm truncate">{id}</span>
                      </label>
                    ))}
                  </div>
                </>
              )}

              {/* Empty state */}
              {!loading && !fetchError && availableModels.length === 0 && (
                <p className="text-text-muted text-center py-8 text-sm">
                  No new models found.
                </p>
              )}

              {/* Footer */}
              <div className="flex justify-between pt-3 border-t border-border flex-shrink-0">
                <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
                <button
                  type="button"
                  disabled={selectedModels.size === 0}
                  onClick={goToStep2}
                  className="btn-primary disabled:opacity-50"
                >
                  Next
                </button>
              </div>
            </div>
          )}

          {/* Step 2: Rate Limits */}
          {step === 2 && (
            <div className="flex flex-col flex-1 min-h-0 gap-3">
              <p className="text-xs text-text-muted flex-shrink-0">
                Configure rate limits for the {selectedList.length} selected model{selectedList.length !== 1 ? 's' : ''}.
                The default row is read-only and shows existing account defaults.
              </p>

              <div className="flex-1 min-h-0">
                <RateLimitTable
                  models={selectedList}
                  limits={limits}
                  onChange={setLimits}
                />
              </div>

              {saveError && (
                <p className="text-error bg-error/10 border border-error/30 rounded-md px-3 py-2 text-sm flex-shrink-0">
                  {saveError}
                </p>
              )}

              {/* Footer */}
              <div className="flex justify-between pt-3 border-t border-border flex-shrink-0">
                <button type="button" onClick={() => setStep(1)} className="btn-secondary">Back</button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={handleFinish}
                  className="btn-primary disabled:opacity-50"
                >
                  {saving ? 'Saving\u2026' : 'Finish'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
