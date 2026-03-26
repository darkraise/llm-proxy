import { useEffect, useState } from 'react'
import { api, Account, AccountInput, AccountLimit, TestResult } from '../lib/api'
import { Drawer } from './ui/Drawer'
import { StatusDot } from './ui/StatusDot'
import { RateLimitTable, formatCompact } from './RateLimitTable'
import { FlaskConical, Pencil, Trash2, Search } from 'lucide-react'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getAccountStatus(account: Account): 'healthy' | 'rate-limited' | 'error' | 'disabled' {
  if (!account.enabled) return 'disabled'
  if (account.status?.reason?.includes('exhausted')) return 'rate-limited'
  if (account.status && !account.status.available) return 'error'
  return 'healthy'
}

function parseAccountModels(modelsJSON: string): string[] {
  try {
    return JSON.parse(modelsJSON) as string[]
  } catch {
    return []
  }
}

const STATUS_LABELS: Record<string, { text: string; className: string }> = {
  healthy: { text: 'Healthy', className: 'text-success' },
  'rate-limited': { text: 'Rate Limited', className: 'text-warning' },
  error: { text: 'Error', className: 'text-error' },
  disabled: { text: 'Disabled', className: 'text-text-muted' },
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface AccountDrawerProps {
  account: Account | null
  onClose: () => void
  onUpdate: () => void
  onTest: (id: number) => void
  onDelete: (id: number) => void
  testResult?: TestResult | 'testing' | null
}

type Tab = 'overview' | 'models' | 'rate-limits'

const TABS: { key: Tab; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'models', label: 'Models' },
  { key: 'rate-limits', label: 'Rate Limits' },
]

// ─── Component ───────────────────────────────────────────────────────────────

export function AccountDrawer({ account, onClose, onUpdate, onTest, onDelete, testResult }: AccountDrawerProps) {
  const [activeTab, setActiveTab] = useState<Tab>('overview')
  const [isEditing, setIsEditing] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [modelFilter, setModelFilter] = useState('')

  // Edit mode state
  const [editData, setEditData] = useState<AccountInput | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')

  // Rate limit edit state
  const [editingRateLimits, setEditingRateLimits] = useState(false)
  const [editedLimits, setEditedLimits] = useState<AccountLimit[]>([])
  const [savingLimits, setSavingLimits] = useState(false)

  // Reset state when account changes
  useEffect(() => {
    setActiveTab('overview')
    setIsEditing(false)
    setIsDeleting(false)
    setModelFilter('')
    setEditData(null)
    setSaveError('')
    setEditingRateLimits(false)
  }, [account?.id])

  if (!account) {
    return <Drawer open={false} onClose={onClose} title=""><span /></Drawer>
  }

  // Non-null binding for use in closures (TS can't narrow the prop across nested functions)
  const acct = account

  const status = getAccountStatus(acct)
  const models = parseAccountModels(acct.models)
  const statusInfo = STATUS_LABELS[status] ?? STATUS_LABELS.disabled

  // ─── Edit helpers ────────────────────────────────────────────────────────

  function startEditing() {
    setEditData({
      name: acct.name,
      type: acct.type,
      base_url: acct.base_url,
      api_key: '',
      models: parseAccountModels(acct.models),
      priority: acct.priority,
      enabled: acct.enabled,
      default_model: acct.default_model ?? '',
      limits: acct.limits ?? [],
    })
    setIsEditing(true)
    setSaveError('')
  }

  function cancelEditing() {
    setIsEditing(false)
    setEditData(null)
    setSaveError('')
  }

  async function handleSave() {
    if (!editData) return
    setSaving(true)
    setSaveError('')
    try {
      await api.accounts.update(acct.id, editData)
      setIsEditing(false)
      setEditData(null)
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

  // ─── Rate limit edit helpers ─────────────────────────────────────────────

  function startEditingRateLimits() {
    setEditedLimits(acct.limits ?? [])
    setEditingRateLimits(true)
  }

  function cancelEditingRateLimits() {
    setEditingRateLimits(false)
    setEditedLimits([])
  }

  async function handleSaveRateLimits() {
    setSavingLimits(true)
    try {
      await api.accounts.update(acct.id, {
        name: acct.name,
        type: acct.type,
        base_url: acct.base_url,
        api_key: '',
        models: parseAccountModels(acct.models),
        priority: acct.priority,
        enabled: acct.enabled,
        default_model: acct.default_model ?? '',
        limits: editedLimits,
      })
      setEditingRateLimits(false)
      onUpdate()
    } catch {
      // silently fail; user sees stale data
    } finally {
      setSavingLimits(false)
    }
  }

  // ─── Delete helpers ──────────────────────────────────────────────────────

  function confirmDelete() {
    onDelete(acct.id)
    onClose()
  }

  // ─── Header ──────────────────────────────────────────────────────────────

  const title = (
    <div className="flex items-center gap-2 min-w-0">
      <StatusDot status={status} />
      <span className="text-[15px] font-semibold text-text-primary truncate">{acct.name}</span>
    </div>
  )

  const actions = (
    <div className="flex items-center gap-1.5">
      <button
        onClick={() => onTest(acct.id)}
        className="btn-secondary inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5"
        title="Test connectivity"
      >
        <FlaskConical size={13} />
        Test
      </button>
      <button
        onClick={isEditing ? cancelEditing : startEditing}
        className={`btn-secondary inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 ${isEditing ? 'bg-accent-muted text-accent-light' : ''}`}
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
    </div>
  )

  // ─── Tab content ─────────────────────────────────────────────────────────

  function renderOverview() {
    if (isEditing && editData) return renderEditForm()

    return (
      <div className="p-4 space-y-5">
        {/* Info grid */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-3">
          <InfoField label="Type" value={acct.type} />
          <InfoField label="Priority" value={String(acct.priority)} />
          <InfoField label="Default Model" value={acct.default_model || '(none)'} mono />
          <InfoField label="Status">
            <span className={statusInfo.className}>{statusInfo.text}</span>
          </InfoField>
        </div>

        {/* Usage */}
        <div>
          <h3 className="text-xs uppercase tracking-wider text-text-muted font-medium mb-2">Usage</h3>
          <div className="grid grid-cols-3 gap-2">
            <MiniStat label="Requests" value={String(acct.total_requests)} />
            <MiniStat label="Tokens" value={formatCompact(acct.total_tokens)} />
            <MiniStat label="Errors" value={acct.status?.reason ? '1' : '0'} />
          </div>
        </div>

        {/* Base URL */}
        <div>
          <h3 className="text-xs uppercase tracking-wider text-text-muted font-medium mb-1.5">Base URL</h3>
          <div className="bg-surface border border-border rounded-md px-3 py-2 font-mono text-[13px] text-text-secondary break-all">
            {acct.base_url || '(not set)'}
          </div>
        </div>

        {/* Test result */}
        {testResult && testResult !== 'testing' && (
          <div className={`rounded-md px-3 py-2 text-[13px] border ${
            testResult.success
              ? 'bg-success/10 border-success/30 text-success'
              : 'bg-error/10 border-error/30 text-error'
          }`}>
            {testResult.success ? 'Connection successful' : `Error: ${testResult.error ?? 'Unknown error'}`}
          </div>
        )}
        {testResult === 'testing' && (
          <div className="rounded-md px-3 py-2 text-[13px] border border-border text-text-muted">
            Testing connectivity...
          </div>
        )}

        {/* Delete confirmation */}
        {isDeleting && <DeleteConfirmation onConfirm={confirmDelete} onCancel={() => setIsDeleting(false)} />}
      </div>
    )
  }

  function renderEditForm() {
    if (!editData) return null
    const editModels = editData.models

    return (
      <div className="p-4 space-y-4">
        <div>
          <label className="label">Name</label>
          <input className="input" value={editData.name} onChange={(e) => setEditField('name', e.target.value)} />
        </div>

        <div>
          <label className="label">Base URL</label>
          <input className="input font-mono" value={editData.base_url} onChange={(e) => setEditField('base_url', e.target.value)} />
        </div>

        <div>
          <label className="label">
            API Key <span className="text-text-muted normal-case">(blank = keep current)</span>
          </label>
          <input
            className="input font-mono"
            type="password"
            value={editData.api_key}
            onChange={(e) => setEditField('api_key', e.target.value)}
            placeholder="••••••••"
            autoComplete="off"
          />
        </div>

        <div>
          <label className="label">Default Model</label>
          <select className="input" value={editData.default_model} onChange={(e) => setEditField('default_model', e.target.value)}>
            <option value="">(none)</option>
            {editModels.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Priority</label>
            <input
              className="input"
              type="number"
              min={0}
              value={editData.priority}
              onChange={(e) => setEditField('priority', parseInt(e.target.value) || 0)}
            />
          </div>
          <div className="flex items-end pb-1">
            <div className="flex items-center gap-2">
              <input
                id="drawer-edit-enabled"
                type="checkbox"
                className="checkbox"
                checked={editData.enabled}
                onChange={(e) => setEditField('enabled', e.target.checked)}
              />
              <label htmlFor="drawer-edit-enabled" className="text-text-primary">Enabled</label>
            </div>
          </div>
        </div>

        {saveError && (
          <p className="text-error bg-error/10 border border-error/30 rounded-md px-3 py-2 text-[13px]">{saveError}</p>
        )}

        <div className="flex justify-end gap-2 pt-2 border-t border-border">
          <button type="button" onClick={cancelEditing} className="btn-secondary">Cancel</button>
          <button type="button" onClick={handleSave} disabled={saving} className="btn-primary disabled:opacity-50">
            {saving ? 'Saving\u2026' : 'Save'}
          </button>
        </div>
      </div>
    )
  }

  function renderModels() {
    const filtered = modelFilter
      ? models.filter((m) => m.toLowerCase().includes(modelFilter.toLowerCase()))
      : models

    return (
      <div className="flex flex-col h-full">
        {models.length > 10 && (
          <div className="p-3 border-b border-border">
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
              <input
                className="input pl-8 text-[13px]"
                placeholder="Filter models..."
                value={modelFilter}
                onChange={(e) => setModelFilter(e.target.value)}
              />
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="text-text-muted text-center py-8 text-[13px]">
              {models.length === 0 ? 'No models configured' : 'No models match filter'}
            </div>
          ) : (
            filtered.map((model) => (
              <div
                key={model}
                className="font-mono text-[13px] text-text-primary py-2 px-3 border-b border-border-muted"
              >
                {model}
              </div>
            ))
          )}
        </div>

        <div className="px-3 py-2 border-t border-border text-[11px] text-text-muted">
          {models.length} model{models.length !== 1 ? 's' : ''} total
        </div>
      </div>
    )
  }

  function renderRateLimits() {
    return (
      <div className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs uppercase tracking-wider text-text-muted font-medium">Rate Limits</h3>
          {!editingRateLimits ? (
            <button onClick={startEditingRateLimits} className="btn-secondary text-xs px-2.5 py-1">
              Edit
            </button>
          ) : (
            <div className="flex gap-1.5">
              <button onClick={cancelEditingRateLimits} className="btn-secondary text-xs px-2.5 py-1">Cancel</button>
              <button
                onClick={handleSaveRateLimits}
                disabled={savingLimits}
                className="btn-primary text-xs px-2.5 py-1 disabled:opacity-50"
              >
                {savingLimits ? 'Saving\u2026' : 'Save'}
              </button>
            </div>
          )}
        </div>

        <RateLimitTable
          models={models}
          limits={editingRateLimits ? editedLimits : (acct.limits ?? [])}
          onChange={setEditedLimits}
          readOnly={!editingRateLimits}
        />
      </div>
    )
  }

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <Drawer open={account !== null} onClose={onClose} title={title} actions={actions} width={420}>
      {/* Tab bar */}
      <div className="flex border-b border-border px-4">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-3 py-2.5 text-[13px] font-medium transition-colors ${
              activeTab === tab.key
                ? 'text-accent-light border-b-2 border-accent-light'
                : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'overview' && renderOverview()}
      {activeTab === 'models' && renderModels()}
      {activeTab === 'rate-limits' && renderRateLimits()}
    </Drawer>
  )
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function InfoField({ label, value, mono, children }: { label: string; value?: string; mono?: boolean; children?: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-text-muted mb-0.5">{label}</div>
      {children ?? (
        <div className={`text-[13px] text-text-primary ${mono ? 'font-mono' : ''}`}>{value}</div>
      )}
    </div>
  )
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-surface border border-border rounded-md px-3 py-2 text-center">
      <div className="text-[9px] uppercase tracking-wider text-text-muted">{label}</div>
      <div className="text-[14px] font-semibold text-text-primary mt-0.5">{value}</div>
    </div>
  )
}

function DeleteConfirmation({ onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void }) {
  return (
    <div className="bg-error/5 border border-error/20 rounded-lg p-4 space-y-3">
      <p className="text-[13px] text-text-primary">
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
