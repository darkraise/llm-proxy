import { useEffect, useState } from 'react'
import {
  api, Account, AccountInput, AccountLimit, TestResult,
  MODEL_CATEGORIES, parseCategorizedModels, parseDefaultModels,
  flattenModels, buildModelCategoryMap,
} from '../lib/api'
import { Drawer } from './ui/Drawer'
import { ProviderBadge } from './ui/Badge'
import { ToggleSwitch } from './ui/ToggleSwitch'
import { RateLimitTable, formatCompact } from './RateLimitTable'
import { ModelName } from './ui/ModelName'
import { FlaskConical, Pencil, Plus, Trash2, X } from 'lucide-react'
import { Select } from './ui/Select'
import { AddModelsDialog } from './AddModelsDialog'

// ─── Helpers ─────────────────────────────────────────────────────────────────

const FIXED_URL_PROVIDERS = new Set(['groq', 'openrouter', 'cerebras', 'mistral', 'github', 'cohere', 'llm7', 'google'])

// ─── Types ───────────────────────────────────────────────────────────────────

interface AccountDrawerProps {
  account: Account | null
  onClose: () => void
  onUpdate: () => void
  onTest: (id: number) => void
  onDelete: (id: number) => void
  onClearTest?: () => void
  testResult?: TestResult | 'testing' | null
}


// ─── Component ───────────────────────────────────────────────────────────────

export function AccountDrawer({ account, onClose, onUpdate, onTest, onDelete, onClearTest, testResult }: AccountDrawerProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [addModelsOpen, setAddModelsOpen] = useState(false)

  // Edit mode state
  const [editData, setEditData] = useState<AccountInput | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')

  // Rate limit edit state
  const [editedLimits, setEditedLimits] = useState<AccountLimit[]>([])

  // Reset state when account changes
  useEffect(() => {
    setIsEditing(false)
    setIsDeleting(false)
    setAddModelsOpen(false)
    setEditData(null)
    setEditedLimits([])
    setSaveError('')
  }, [account?.id])

  if (!account) {
    return <Drawer open={false} onClose={onClose} title=""><span /></Drawer>
  }

  // Non-null binding for use in closures (TS can't narrow the prop across nested functions)
  const acct = account

  const categorizedModels = parseCategorizedModels(acct.models)
  const allModels = flattenModels(categorizedModels)
  const modelCategoryMap = buildModelCategoryMap(categorizedModels)
  const defaultModels = parseDefaultModels(acct.default_models)

  // ─── Edit helpers ────────────────────────────────────────────────────────

  function startEditing() {
    const catModels = parseCategorizedModels(acct.models)
    const defModels = parseDefaultModels(acct.default_models)
    setEditData({
      name: acct.name,
      type: acct.type,
      base_url: acct.base_url,
      api_key: '',
      models: catModels,
      priority: acct.priority,
      enabled: acct.enabled,
      default_models: defModels,
      limits: acct.limits ?? [],
    })
    setEditedLimits(acct.limits ?? [])
    setIsEditing(true)
    setSaveError('')
  }

  function cancelEditing() {
    setIsEditing(false)
    setEditData(null)
    setEditedLimits([])
    setSaveError('')
  }

  async function handleSave() {
    if (!editData) return
    setSaving(true)
    setSaveError('')
    try {
      await api.accounts.update(acct.id, { ...editData, limits: editedLimits })
      setIsEditing(false)
      setEditData(null)
      setEditedLimits([])
      onUpdate()
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  function setEditField<K extends keyof AccountInput>(k: K, v: AccountInput[K]) {
    setEditData((prev) => prev ? { ...prev, [k]: v } : prev)
  }

  // ─── Delete helpers ──────────────────────────────────────────────────────

  function confirmDelete() {
    onDelete(acct.id)
    onClose()
  }

  async function handleAddModels(newModels: string[], newLimits: AccountLimit[], newModelCategories?: Record<string, string>) {
    const currentCategorized = parseCategorizedModels(acct.models)
    // Merge new models into categorized map
    for (const model of newModels) {
      const cat = newModelCategories?.[model] ?? 'chat'
      if (!currentCategorized[cat]) currentCategorized[cat] = []
      if (!currentCategorized[cat].includes(model)) {
        currentCategorized[cat].push(model)
      }
    }
    const updatedLimits = [...(acct.limits ?? []), ...newLimits]

    await api.accounts.update(acct.id, {
      name: acct.name,
      type: acct.type,
      base_url: acct.base_url,
      api_key: '',
      models: currentCategorized,
      priority: acct.priority,
      enabled: acct.enabled,
      default_models: parseDefaultModels(acct.default_models),
      limits: updatedLimits,
    })
    onUpdate()
  }

  // ─── Header ──────────────────────────────────────────────────────────────

  const ed = isEditing && editData ? editData : null
  const editAllModels = ed ? flattenModels(ed.models) : allModels
  const editModelCategoryMap = ed ? buildModelCategoryMap(ed.models) : modelCategoryMap

  async function handleToggleEnabled(enabled: boolean) {
    try {
      await api.accounts.update(acct.id, {
        name: acct.name, type: acct.type, base_url: acct.base_url, api_key: '',
        models: parseCategorizedModels(acct.models), priority: acct.priority,
        enabled, default_models: parseDefaultModels(acct.default_models), limits: acct.limits ?? [],
      })
      if (ed) setEditField('enabled', enabled)
      onUpdate()
    } catch { /* silent */ }
  }

  function handleCategoryChange(model: string, newCategory: string) {
    if (!editData) return
    const updated = { ...editData.models }
    // Remove from old category
    for (const cat of Object.keys(updated)) {
      updated[cat] = updated[cat].filter((m) => m !== model)
      if (updated[cat].length === 0) delete updated[cat]
    }
    // Add to new category
    if (!updated[newCategory]) updated[newCategory] = []
    updated[newCategory].push(model)
    setEditField('models', updated)
  }

  const title = (
    <div className="flex items-center gap-2 min-w-0">
      <ToggleSwitch checked={ed ? ed.enabled : acct.enabled} onChange={handleToggleEnabled} />
      {ed ? (
        <input
          className="input text-base font-semibold flex-1 min-w-0 py-0.5"
          value={ed.name}
          onChange={(e) => setEditField('name', e.target.value)}
        />
      ) : (
        <span className="text-base font-semibold text-text-primary truncate">{acct.name}</span>
      )}
      <ProviderBadge provider={acct.type} />
    </div>
  )

  const actions = (
    <div className="flex items-center gap-1.5">
      {ed ? (
        <>
          {saveError && <span className="text-error text-xs mr-1">{saveError}</span>}
          <button onClick={cancelEditing} className="btn-secondary text-xs px-2.5 py-1.5">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="btn-primary text-xs px-2.5 py-1.5 disabled:opacity-50">
            {saving ? 'Saving\u2026' : 'Save'}
          </button>
        </>
      ) : (
        <>
          <button
            onClick={() => onTest(acct.id)}
            className="btn-secondary inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5"
            title="Test connectivity"
          >
            <FlaskConical size={13} />
            Test
          </button>
          <button
            onClick={startEditing}
            className="btn-secondary inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5"
            title="Edit account"
          >
            <Pencil size={13} />
          </button>
          <button
            onClick={() => setIsDeleting(!isDeleting)}
            className="inline-flex items-center gap-1 text-xs px-2 py-1.5 rounded-lg text-error hover:bg-error/10 transition-colors"
            title="Delete account"
          >
            <Trash2 size={13} />
          </button>
        </>
      )}
    </div>
  )

  // ─── Tab content ─────────────────────────────────────────────────────────

  function renderOverview() {
    const currentDefaults = ed ? ed.default_models : defaultModels

    return (
      <div className="flex flex-col h-full">
        {/* Top section — compact, no grow */}
        <div className="p-4 space-y-5 flex-shrink-0">
          {/* API Key (only in edit mode, since not shown in read mode) */}
          {ed && (
            <div>
              <div className="text-xs uppercase tracking-wider text-text-muted mb-0.5">API Key</div>
              <input
                className="input font-mono"
                type="password"
                value={ed.api_key}
                onChange={(e) => setEditField('api_key', e.target.value)}
                placeholder="••••••••  (blank = keep current)"
                autoComplete="off"
              />
            </div>
          )}

          {/* Info grid — fields swap in-place */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-3">
            <div>
              <div className="text-xs uppercase tracking-wider text-text-muted mb-0.5">Priority</div>
              {ed ? (
                <input
                  className="input"
                  type="number"
                  min={0}
                  value={ed.priority}
                  onChange={(e) => setEditField('priority', parseInt(e.target.value) || 0)}
                />
              ) : (
                <div className="text-sm text-text-primary">{acct.priority}</div>
              )}
            </div>
          </div>

          {/* Per-category default model selectors */}
          <div className="space-y-3">
            {MODEL_CATEGORIES.map((cat) => {
              const catModels = ed ? (ed.models[cat] ?? []) : (categorizedModels[cat] ?? [])
              if (catModels.length === 0 && !ed) return null
              const currentDefault = currentDefaults[cat] ?? ''
              return (
                <div key={cat}>
                  <div className="text-xs uppercase tracking-wider text-text-muted mb-0.5">
                    Default {cat} model
                  </div>
                  {ed ? (
                    <Select
                      value={currentDefault}
                      onChange={(v) => {
                        const updated = { ...ed.default_models, [cat]: v }
                        if (!v) delete updated[cat]
                        setEditField('default_models', updated)
                      }}
                      options={[
                        { value: '', label: '(none)' },
                        ...catModels.map((m) => ({ value: m, label: m })),
                      ]}
                    />
                  ) : (
                    <div className="text-sm text-text-primary">
                      {currentDefault
                        ? <ModelName name={currentDefault} />
                        : '(none)'}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* Base URL — only for ollama and openai-compatible */}
          {!FIXED_URL_PROVIDERS.has(acct.type) && (
            <div>
              <h3 className="text-xs uppercase tracking-wider text-text-muted font-medium mb-1.5">Base URL</h3>
              {ed ? (
                <input className="input font-mono" value={ed.base_url} onChange={(e) => setEditField('base_url', e.target.value)} />
              ) : (
                <div className="bg-surface border border-border rounded-md px-3 py-2 font-mono text-sm text-text-secondary break-all">
                  {acct.base_url || '(not set)'}
                </div>
              )}
            </div>
          )}

          {/* Usage (hidden in edit mode) */}
          {!ed && (
            <div>
              <h3 className="text-xs uppercase tracking-wider text-text-muted font-medium mb-2">Usage</h3>
              <div className="grid grid-cols-3 gap-2">
                <MiniStat label="Requests" value={String(acct.total_requests)} />
                <MiniStat label="Tokens" value={formatCompact(acct.total_tokens)} />
                <MiniStat label="Errors" value={acct.status?.reason ? '1' : '0'} />
              </div>
            </div>
          )}

          {/* Test result */}
          {testResult && testResult !== 'testing' && (
            <div className={`rounded-md px-3 py-2 text-sm border flex items-start gap-2 ${
              testResult.success
                ? 'bg-success/10 border-success/30 text-success'
                : 'bg-error/10 border-error/30 text-error'
            }`}>
              <span className="flex-1">{testResult.success ? 'Connection successful' : `Error: ${testResult.error ?? 'Unknown error'}`}</span>
              {onClearTest && (
                <button onClick={onClearTest} className="flex-shrink-0 hover:opacity-70 transition-opacity mt-0.5">
                  <X size={14} />
                </button>
              )}
            </div>
          )}
          {testResult === 'testing' && (
            <div className="rounded-md px-3 py-2 text-sm border border-border text-text-muted">
              Testing connectivity...
            </div>
          )}

          {/* Delete confirmation */}
          {isDeleting && <DeleteConfirmation onConfirm={confirmDelete} onCancel={() => setIsDeleting(false)} />}
        </div>

        {/* Models & Rate Limits — fills remaining height, edit mode synced with account edit */}
        <div className="flex-1 flex flex-col min-h-0 px-4 pb-4">
          <div className="flex items-center justify-between mb-2 flex-shrink-0">
            <h3 className="text-xs uppercase tracking-wider text-text-muted font-medium">Models & Rate Limits</h3>
            {!ed && (
              <button
                onClick={() => setAddModelsOpen(true)}
                className="btn-secondary inline-flex items-center gap-1 text-xs px-2 py-1"
                title="Add models"
              >
                <Plus size={14} />
              </button>
            )}
          </div>
          <div className="flex-1 min-h-0">
            <RateLimitTable
              models={editAllModels}
              limits={ed ? editedLimits : (acct.limits ?? [])}
              onChange={setEditedLimits}
              readOnly={!isEditing}
              modelCategories={editModelCategoryMap}
              onCategoryChange={ed ? handleCategoryChange : undefined}
            />
          </div>
        </div>
      </div>
    )
  }



  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <Drawer open={account !== null} onClose={onClose} title={title} actions={actions} width={900}>
      {renderOverview()}
      <AddModelsDialog
        open={addModelsOpen}
        onClose={() => setAddModelsOpen(false)}
        account={acct}
        existingModels={allModels}
        existingLimits={acct.limits ?? []}
        onFinish={handleAddModels}
      />
    </Drawer>
  )
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-surface border border-border rounded-md px-3 py-2 text-center">
      <div className="text-xs uppercase tracking-wider text-text-muted">{label}</div>
      <div className="text-sm font-semibold text-text-primary mt-0.5">{value}</div>
    </div>
  )
}

function DeleteConfirmation({ onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void }) {
  return (
    <div className="bg-error/5 border border-error/20 rounded-lg p-4 space-y-3">
      <p className="text-sm text-text-primary">
        Delete this account? This action cannot be undone.
      </p>
      <div className="flex gap-2">
        <button
          onClick={onConfirm}
          className="btn-primary bg-error hover:bg-error/90 text-white text-xs px-3 py-1.5"
        >
          Delete
        </button>
        <button onClick={onCancel} className="btn-secondary text-xs px-3 py-1.5">
          Cancel
        </button>
      </div>
    </div>
  )
}
