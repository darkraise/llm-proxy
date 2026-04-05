import { useEffect, useRef, useState } from 'react'
import {
  api,
  type AccountLimit,
  type DiscoveredKey,
  type ScanHistory,
  type ScanKeyPattern,
  type ScannerStatus,
  type ScannerConfigResponse,
} from '../lib/api'
import { KNOWN_MODELS, categorizeModels, getDefaultSelection } from '../lib/known-models'
import { ModelPickerDialog } from '../components/ModelPickerDialog'
import { Button } from '../components/ui/Button'
import { Select } from '../components/ui/Select'
import { Badge } from '../components/ui/Badge'
import { useDateFormat } from '../hooks/useDateFormat'
import { useToast } from '../components/ui/Toast'
import {
  CheckCircle2,
  XCircle,
  HelpCircle,
  Loader2,
  Radar,
  Settings2,
  Play,
  Square,
  Trash2,
  Download,
  RefreshCw,
  FlaskConical,
  X,
} from 'lucide-react'

// ─── Provider Colors ─────────────────────────────────────────────────────────

const PROVIDER_COLORS: Record<string, string> = {
  openai: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  openai_legacy: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  anthropic: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
  google: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  groq: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
  cohere: 'bg-pink-500/15 text-pink-400 border-pink-500/30',
  mistral: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  deepseek: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30',
  xai: 'bg-red-500/15 text-red-400 border-red-500/30',
  huggingface: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
  voyage: 'bg-indigo-500/15 text-indigo-400 border-indigo-500/30',
  cerebras: 'bg-teal-500/15 text-teal-400 border-teal-500/30',
  openrouter: 'bg-fuchsia-500/15 text-fuchsia-400 border-fuchsia-500/30',
  nvidia: 'bg-lime-500/15 text-lime-400 border-lime-500/30',
  together: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  fireworks: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
  perplexity: 'bg-teal-500/15 text-teal-400 border-teal-500/30',
}

function providerColor(provider: string) {
  return PROVIDER_COLORS[provider] ?? 'bg-gray-500/15 text-gray-400 border-gray-500/30'
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function ValidityIcon({ valid }: { valid: boolean | null }) {
  if (valid === true)
    return <CheckCircle2 size={14} className="text-success shrink-0" />
  if (valid === false)
    return <XCircle size={14} className="text-error shrink-0" />
  return <HelpCircle size={14} className="text-text-muted shrink-0" />
}

function ValidityBadge({ valid }: { valid: boolean | null }) {
  if (valid === true) return <Badge variant="success">Valid</Badge>
  if (valid === false) return <Badge variant="error">Invalid</Badge>
  return <Badge variant="neutral">Untested</Badge>
}

// ─── Tabs ─────────────────────────────────────────────────────────────────────

type Tab = 'keys' | 'history' | 'patterns'

const TABS: { id: Tab; label: string }[] = [
  { id: 'keys', label: 'Discovered Keys' },
  { id: 'history', label: 'Scan History' },
  { id: 'patterns', label: 'Key Patterns' },
]

// ─── Main Component ───────────────────────────────────────────────────────────

export default function Scanner() {
  const { fmt } = useDateFormat()
  const { showToast } = useToast()

  const [tab, setTab] = useState<Tab>('keys')
  const [status, setStatus] = useState<ScannerStatus | null>(null)
  const [statusError, setStatusError] = useState('')
  const [showConfig, setShowConfig] = useState(false)
  const [githubToken, setGithubToken] = useState('')
  const [savingToken, setSavingToken] = useState(false)
  const [starting, setStarting] = useState(false)
  const [stopping, setStopping] = useState(false)

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  async function fetchStatus() {
    try {
      const s = await api.scanner.status()
      setStatus(s)
      setStatusError('')
    } catch {
      setStatusError('Failed to load scanner status')
    }
  }

  useEffect(() => {
    fetchStatus()
  }, [])

  const isRunning = status?.status.running ?? false

  useEffect(() => {
    if (isRunning) {
      pollRef.current = setInterval(fetchStatus, 3000)
    } else {
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [isRunning])

  async function handleStart() {
    setStarting(true)
    try {
      await api.scanner.start()
      await fetchStatus()
      showToast('Scan started')
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Failed to start scan')
    } finally {
      setStarting(false)
    }
  }

  async function handleStop() {
    setStopping(true)
    try {
      await api.scanner.stop()
      await fetchStatus()
      showToast('Scan stopped')
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Failed to stop scan')
    } finally {
      setStopping(false)
    }
  }

  async function handleSaveToken() {
    setSavingToken(true)
    try {
      const update: Record<string, string> = {}
      if (githubToken) update.github_token = githubToken
      await api.scanner.updateConfig(update)
      setGithubToken('')
      showToast('Tokens saved')
      const cfg = await api.scanner.config()
      setConfigState(cfg)
      await fetchStatus()
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Failed to save tokens')
    } finally {
      setSavingToken(false)
    }
  }

  async function handleSaveConfig() {
    setSavingConfig(true)
    try {
      const delay = parseInt(configDelay)
      const maxPages = parseInt(configMaxPages)
      await api.scanner.updateConfig({
        ...(delay > 0 ? { delay_seconds: delay } : {}),
        ...(maxPages > 0 ? { max_pages: maxPages } : {}),
      })
      showToast('Configuration saved')
      const cfg = await api.scanner.config()
      setConfigState(cfg)
      await fetchStatus()
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Failed to save configuration')
    } finally {
      setSavingConfig(false)
    }
  }

  const [configState, setConfigState] = useState<ScannerConfigResponse | null>(null)
  const [configDelay, setConfigDelay] = useState('')
  const [configMaxPages, setConfigMaxPages] = useState('')
  const [savingConfig, setSavingConfig] = useState(false)

  useEffect(() => {
    api.scanner.config().then(cfg => {
      setConfigState(cfg)
      setConfigDelay(String(cfg.delay_seconds))
      setConfigMaxPages(String(cfg.max_pages))
    }).catch(() => {})
  }, [])

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-5">
      <div className="flex items-center gap-3">
        <Radar size={22} className="text-accent-light" />
        <h1 className="text-xl font-semibold text-text-primary">Key Scanner</h1>
      </div>

      {statusError && (
        <div className="bg-error/10 border border-error/30 rounded-lg px-4 py-3 text-sm text-error">
          {statusError}
        </div>
      )}

      <StatusBar
        status={status}
        starting={starting}
        stopping={stopping}
        showConfig={showConfig}
        onStart={handleStart}
        onStop={handleStop}
        onToggleConfig={() => setShowConfig(v => !v)}
      />

      {showConfig && (
        <div className="bg-surface-raised border border-border rounded-xl p-5 space-y-5">
          <p className="text-xs text-text-muted uppercase tracking-wider font-medium">Configuration</p>

          <div className="space-y-4 max-w-lg">
            <div>
              <label className="block text-xs text-text-muted mb-1.5">GitHub Token</label>
              {configState?.github_token_configured && (
                <p className="text-xs text-text-muted mb-1.5">
                  Current: <span className="font-mono">{configState.github_token_masked}</span>
                </p>
              )}
              <input
                type="text"
                value={githubToken}
                onChange={e => setGithubToken(e.target.value)}
                placeholder={configState?.github_token_configured ? 'Replace token...' : 'ghp_...'}
                className="input text-sm w-full"
                autoComplete="new-password"
                data-1p-ignore
                data-lpignore="true"
              />
            </div>

            <Button
              onClick={handleSaveToken}
              disabled={savingToken || !githubToken}
              className="shrink-0"
            >
              {savingToken ? <Loader2 size={14} className="animate-spin" /> : null}
              Save Token
            </Button>
          </div>

          <div className="border-t border-border pt-4 space-y-4">
            <div className="flex flex-wrap items-end gap-4 max-w-lg">
              <div className="w-32">
                <label className="block text-xs text-text-muted mb-1.5">Request Delay (s)</label>
                <input
                  type="number"
                  min={1}
                  max={60}
                  value={configDelay}
                  onChange={e => setConfigDelay(e.target.value)}
                  className="input text-sm w-full"
                />
              </div>
              <div className="w-36">
                <label className="block text-xs text-text-muted mb-1.5">Max Pages / Provider</label>
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={configMaxPages}
                  onChange={e => setConfigMaxPages(e.target.value)}
                  className="input text-sm w-full"
                />
              </div>
            </div>
            <Button
              onClick={handleSaveConfig}
              disabled={savingConfig}
              variant="secondary"
              size="sm"
            >
              {savingConfig ? <Loader2 size={14} className="animate-spin" /> : null}
              Save Settings
            </Button>
          </div>
        </div>
      )}

      <div className="flex gap-1 border-b border-border">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
              tab === t.id
                ? 'border-accent-light text-accent-light'
                : 'border-transparent text-text-muted hover:text-text-primary'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'keys' && <KeysTab fmt={fmt} showToast={showToast} onStatusChange={fetchStatus} isScanning={isRunning} />}
      {tab === 'history' && <HistoryTab fmt={fmt} />}
      {tab === 'patterns' && <PatternsTab showToast={showToast} />}
    </div>
  )
}

// ─── Status Bar ───────────────────────────────────────────────────────────────

function StatusBar({
  status,
  starting,
  stopping,
  showConfig,
  onStart,
  onStop,
  onToggleConfig,
}: {
  status: ScannerStatus | null
  starting: boolean
  stopping: boolean
  showConfig: boolean
  onStart: () => void
  onStop: () => void
  onToggleConfig: () => void
}) {
  const inner = status?.status
  const cfg = status?.config
  return (
    <div className="bg-surface-raised border border-border rounded-xl p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          {inner?.running ? (
            <div className="flex flex-col gap-1.5">
              <span className="flex items-center gap-1.5 text-sm text-warning">
                <Loader2 size={14} className="animate-spin" />
                Scanning{inner.source ? ` · ${inner.source}` : ''}{inner.provider ? ` — ${inner.provider}` : ''}
                {inner.patterns_total > 0 && (
                  <span className="text-text-muted text-xs">({inner.patterns_done}/{inner.patterns_total})</span>
                )}
              </span>
              {inner.patterns_total > 0 && (
                <div className="w-48 h-1.5 bg-border rounded-full overflow-hidden">
                  <div
                    className="h-full bg-warning rounded-full transition-all duration-300"
                    style={{ width: `${Math.round((inner.patterns_done / inner.patterns_total) * 100)}%` }}
                  />
                </div>
              )}
            </div>
          ) : (
            <span className="flex items-center gap-1.5 text-sm text-text-muted">
              <span className="w-2 h-2 rounded-full bg-text-muted inline-block" />
              Idle
            </span>
          )}
        </div>

        {inner?.error && (
          <span className="text-xs text-error truncate max-w-xs">{inner.error}</span>
        )}

        <div className="ml-auto flex items-center gap-2">
          <Button
            variant={showConfig ? 'default' : 'secondary'}
            size="sm"
            onClick={onToggleConfig}
          >
            <Settings2 size={14} />
            Configure
          </Button>
          {inner?.running ? (
            <Button variant="outline" size="sm" onClick={onStop} disabled={stopping}>
              {stopping ? <Loader2 size={14} className="animate-spin" /> : <Square size={14} />}
              Stop
            </Button>
          ) : (
            <Button size="sm" onClick={onStart} disabled={starting}>
              {starting ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
              Start Scan
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-6 text-sm">
        <Stat label="Discovered" value={status?.total ?? 0} />
        <Stat label="Valid" value={status?.valid ?? 0} color="text-success" />
        <Stat label="Imported" value={status?.imported ?? 0} color="text-accent-light" />
        <div className="w-px h-5 bg-border self-center" />
        <Stat label="Providers" value={status?.providers_count ?? 0} />
        <Stat label="Sources" value={status?.sources?.length ?? 0} />
        {(status?.sources?.length ?? 0) > 0 && (
          <span className="text-xs text-text-muted self-center">
            ({status!.sources.join(', ')})
          </span>
        )}
        {inner?.running && inner.keys_found > 0 && (
          <>
            <div className="w-px h-5 bg-border self-center" />
            <Stat label="Found this run" value={inner.keys_found} />
            <Stat label="New this run" value={inner.keys_new} />
          </>
        )}
      </div>

      {cfg && (
        <div className="flex flex-wrap gap-4 text-xs text-text-muted pt-1 border-t border-border">
          <span>Delay: <span className="text-text-secondary font-medium">{cfg.delay_seconds}s</span></span>
          <span>Max pages: <span className="text-text-secondary font-medium">{cfg.max_pages}</span></span>
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <span className="flex items-baseline gap-1">
      <span className={`font-semibold ${color ?? 'text-text-primary'}`}>{value}</span>
      <span className="text-text-muted text-xs">{label}</span>
    </span>
  )
}

// ─── Keys Tab ─────────────────────────────────────────────────────────────────

const PAGE_SIZE = 50

function KeysTab({
  fmt,
  showToast,
  onStatusChange,
  isScanning,
}: {
  fmt: (ts: string | Date) => string
  showToast: (msg: string) => void
  onStatusChange: () => void
  isScanning: boolean
}) {
  const [keys, setKeys] = useState<DiscoveredKey[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [offset, setOffset] = useState(0)

  const [filterProvider, setFilterProvider] = useState('')
  const [filterValid, setFilterValid] = useState('')
  const [filterImported, setFilterImported] = useState('')

  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [actionInProgress, setActionInProgress] = useState<Set<number>>(new Set())
  const [bulkWorking, setBulkWorking] = useState(false)
  const [retestDialog, setRetestDialog] = useState<{ ids: number[] } | null>(null)

  interface PickerGroup {
    provider: string
    ids: number[]
    chatModels: string[]
    embeddingModels: string[]
    initialChat: string[]
    initialEmbedding: string[]
  }

  const [pickerGroup, setPickerGroup] = useState<PickerGroup | null>(null)
  const importQueueRef = useRef<PickerGroup[]>([])
  const totalStepsRef = useRef(0)

  const keysPollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (isScanning) {
      keysPollRef.current = setInterval(() => load(offset), 5000)
    } else {
      if (keysPollRef.current) {
        clearInterval(keysPollRef.current)
        keysPollRef.current = null
      }
    }
    return () => {
      if (keysPollRef.current) clearInterval(keysPollRef.current)
    }
  }, [isScanning, offset, filterProvider, filterValid, filterImported])

  const [allProviders, setAllProviders] = useState<string[]>([])

  useEffect(() => {
    api.scanner.keys({ limit: 100000, offset: 0 }).then((res) => {
      const providers = Array.from(new Set((res.data ?? []).map(k => k.provider))).sort()
      setAllProviders(providers)
    }).catch(() => {})
  }, [])

  async function load(newOffset = offset) {
    setLoading(true)
    setError('')
    try {
      const res = await api.scanner.keys({
        provider: filterProvider || undefined,
        valid: filterValid || undefined,
        imported: filterImported || undefined,
        limit: PAGE_SIZE,
        offset: newOffset,
      })
      setKeys(res.data ?? [])
      setTotal(res.total ?? 0)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load keys')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    setOffset(0)
    setSelected(new Set())
    load(0)
  }, [filterProvider, filterValid, filterImported])

  function handlePageChange(newOffset: number) {
    setOffset(newOffset)
    setSelected(new Set())
    load(newOffset)
  }

  function toggleSelect(id: number) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function toggleSelectAll() {
    if (selected.size > 0) {
      setSelected(new Set())
      return
    }
    try {
      const res = await api.scanner.keys({
        provider: filterProvider || undefined,
        valid: filterValid || undefined,
        imported: filterImported || undefined,
        limit: 100000,
        offset: 0,
      })
      const allIds = (res.data ?? []).map(k => k.id)
      setSelected(new Set(allIds))
    } catch {
      setSelected(new Set(keys.map(k => k.id)))
    }
  }

  async function handleImport(id: number) {
    const key = keys.find(k => k.id === id)
    if (!key) return
    const provider = key.provider
    setActionInProgress(prev => new Set(prev).add(id))
    try {
      const res = await api.scanner.discoverModels(id)
      const names = (res.models ?? []).map(m => m.id || m.name)
      const { chat, embedding } = categorizeModels(names)
      totalStepsRef.current = 1
      importQueueRef.current = []
      setPickerGroup({
        provider,
        ids: [id],
        chatModels: chat,
        embeddingModels: embedding,
        initialChat: getDefaultSelection(provider, chat),
        initialEmbedding: embedding,
      })
    } catch {
      const known = KNOWN_MODELS[provider] ?? []
      const { chat, embedding } = categorizeModels(known)
      totalStepsRef.current = 1
      importQueueRef.current = []
      setPickerGroup({
        provider,
        ids: [id],
        chatModels: chat,
        embeddingModels: embedding,
        initialChat: getDefaultSelection(provider, chat),
        initialEmbedding: embedding,
      })
    } finally {
      setActionInProgress(prev => { const s = new Set(prev); s.delete(id); return s })
    }
  }

  async function handleDelete(id: number) {
    setActionInProgress(prev => new Set(prev).add(id))
    try {
      await api.scanner.deleteKey(id)
      setKeys(prev => prev.filter(k => k.id !== id))
      setTotal(prev => prev - 1)
      setSelected(prev => { const s = new Set(prev); s.delete(id); return s })
      showToast('Key deleted')
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Delete failed')
    } finally {
      setActionInProgress(prev => { const s = new Set(prev); s.delete(id); return s })
    }
  }

  async function handleBulkImport() {
    const ids = Array.from(selected)
    if (!ids.length) return

    let allKeys = keys
    if (ids.some(id => !keys.find(k => k.id === id))) {
      try {
        const res = await api.scanner.keys({ limit: 100000, offset: 0 })
        allKeys = res.data ?? []
      } catch { /* use current page */ }
    }

    const providerMap = new Map<string, number[]>()
    for (const id of ids) {
      const key = allKeys.find(k => k.id === id)
      const provider = key?.provider ?? 'unknown'
      if (!providerMap.has(provider)) providerMap.set(provider, [])
      providerMap.get(provider)!.push(id)
    }

    setBulkWorking(true)
    const groups: PickerGroup[] = []
    for (const [provider, groupIds] of providerMap) {
      let chat: string[] = []
      let embedding: string[] = []
      try {
        const res = await api.scanner.discoverModels(groupIds[0])
        const names = (res.models ?? []).map(m => m.id || m.name)
        const cats = categorizeModels(names)
        chat = cats.chat
        embedding = cats.embedding
      } catch {
        const known = KNOWN_MODELS[provider] ?? []
        const cats = categorizeModels(known)
        chat = cats.chat
        embedding = cats.embedding
      }
      groups.push({
        provider,
        ids: groupIds,
        chatModels: chat,
        embeddingModels: embedding,
        initialChat: getDefaultSelection(provider, chat),
        initialEmbedding: embedding,
      })
    }
    setBulkWorking(false)

    if (groups.length === 0) return
    totalStepsRef.current = groups.length
    importQueueRef.current = groups.slice(1)
    setPickerGroup(groups[0])
  }

  async function handlePickerConfirm(chatModels: string[], embeddingModels: string[]) {
    const group = pickerGroup!
    setPickerGroup(null)
    setBulkWorking(true)

    const models: Record<string, string[]> = {}
    if (chatModels.length) models.chat = chatModels
    if (embeddingModels.length) models.embedding = embeddingModels
    if (!chatModels.length && !embeddingModels.length) models.chat = []

    let limits: AccountLimit[] | undefined
    try {
      limits = await api.ratelimits.defaults(group.provider)
    } catch { /* proceed without limits */ }

    try {
      const res = await api.scanner.bulkImport(group.ids, models, limits)
      showToast(`Imported ${res.imported} ${group.provider} keys`)
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Import failed')
    }

    if (importQueueRef.current.length > 0) {
      const [next, ...rest] = importQueueRef.current
      importQueueRef.current = rest
      setBulkWorking(false)
      setPickerGroup(next)
    } else {
      await load(offset)
      onStatusChange()
      setBulkWorking(false)
      setSelected(new Set())
    }
  }

  function handlePickerCancel() {
    setPickerGroup(null)
    importQueueRef.current = []
    setBulkWorking(false)
  }

  async function handleBulkDelete() {
    const ids = Array.from(selected)
    if (!ids.length) return
    setBulkWorking(true)
    try {
      const res = await api.scanner.bulkDelete(ids)
      showToast(`Deleted ${res.deleted} keys`)
      await load(offset)
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Bulk delete failed')
    } finally {
      setBulkWorking(false)
      setSelected(new Set())
    }
  }

  const providerOptions = [
    { value: '', label: 'All Providers' },
    ...allProviders.map(p => ({ value: p, label: p })),
  ]

  const validOptions = [
    { value: '', label: 'All Validity' },
    { value: 'true', label: 'Valid' },
    { value: 'false', label: 'Invalid' },
  ]

  const importedOptions = [
    { value: '', label: 'All Import Status' },
    { value: 'true', label: 'Imported' },
    { value: 'false', label: 'Not Imported' },
  ]

  const totalPages = Math.ceil(total / PAGE_SIZE)
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Select
          value={filterProvider}
          onChange={setFilterProvider}
          options={providerOptions}
          className="w-40"
        />
        <Select
          value={filterValid}
          onChange={setFilterValid}
          options={validOptions}
          className="w-36"
        />
        <Select
          value={filterImported}
          onChange={setFilterImported}
          options={importedOptions}
          className="w-40"
        />
        <Button variant="ghost" size="sm" onClick={() => load(offset)} disabled={loading}>
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          Refresh
        </Button>
        <span className="text-xs text-text-muted ml-auto">{total} keys total</span>
        {total > 0 && (
          <a
            href={api.scanner.exportUrl({
              provider: filterProvider || undefined,
              valid: filterValid || undefined,
            })}
            download
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-text-secondary bg-[rgba(255,255,255,0.04)] border border-border rounded-lg hover:bg-[rgba(255,255,255,0.08)] transition-colors"
          >
            <Download size={12} />
            Export JSON
          </a>
        )}
      </div>

      {selected.size > 0 && (
        <div className="flex items-center gap-3 p-3 bg-accent-muted border border-accent/30 rounded-lg">
          <span className="text-sm text-accent-light font-medium">{selected.size} selected</span>
          <div className="flex gap-2 ml-auto">
            <Button variant="secondary" size="sm" onClick={() => setRetestDialog({ ids: Array.from(selected) })} disabled={bulkWorking}>
              <FlaskConical size={14} />
              Re-Test Selected
            </Button>
            <Button variant="secondary" size="sm" onClick={handleBulkImport} disabled={bulkWorking}>
              {bulkWorking ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
              Import Selected
            </Button>
            <Button variant="destructive" size="sm" onClick={handleBulkDelete} disabled={bulkWorking}>
              <Trash2 size={14} />
              Delete Selected
            </Button>
          </div>
        </div>
      )}

      {error && (
        <div className="bg-error/10 border border-error/30 rounded-lg px-4 py-3 text-sm text-error">
          {error}
        </div>
      )}

      <div className="bg-surface-raised border border-border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="w-10 px-4 py-3" onClick={toggleSelectAll}>
                <input
                  type="checkbox"
                  checked={selected.size > 0}
                  onChange={toggleSelectAll}
                  className="rounded border-border cursor-pointer"
                />
              </th>
              <th className="px-4 py-3 text-left text-xs text-text-muted uppercase tracking-wider font-medium">Key</th>
              <th className="px-4 py-3 text-left text-xs text-text-muted uppercase tracking-wider font-medium">Provider</th>
              <th className="px-4 py-3 text-left text-xs text-text-muted uppercase tracking-wider font-medium">Source</th>
              <th className="px-4 py-3 text-left text-xs text-text-muted uppercase tracking-wider font-medium">Status</th>
              <th className="px-4 py-3 text-left text-xs text-text-muted uppercase tracking-wider font-medium">Discovered</th>
              <th className="px-4 py-3 text-right text-xs text-text-muted uppercase tracking-wider font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && keys.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-text-muted">
                  <Loader2 size={18} className="animate-spin inline" />
                </td>
              </tr>
            )}
            {!loading && keys.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-text-muted text-sm">
                  No keys found. Run a scan to discover keys.
                </td>
              </tr>
            )}
            {keys.map(key => (
              <KeyRow
                key={key.id}
                k={key}
                selected={selected.has(key.id)}
                working={actionInProgress.has(key.id)}
                fmt={fmt}
                onToggle={() => toggleSelect(key.id)}
                onTest={() => setRetestDialog({ ids: [key.id] })}
                onImport={() => handleImport(key.id)}
                onDelete={() => handleDelete(key.id)}
              />
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-text-muted">
            Page {currentPage} of {totalPages}
          </span>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={offset === 0}
              onClick={() => handlePageChange(Math.max(0, offset - PAGE_SIZE))}
            >
              Previous
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={offset + PAGE_SIZE >= total}
              onClick={() => handlePageChange(offset + PAGE_SIZE)}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      {pickerGroup && (
        <ModelPickerDialog
          key={`${pickerGroup.provider}-${pickerGroup.ids.join(',')}`}
          open={true}
          provider={pickerGroup.provider}
          chatModels={pickerGroup.chatModels}
          embeddingModels={pickerGroup.embeddingModels}
          initialChat={pickerGroup.initialChat}
          initialEmbedding={pickerGroup.initialEmbedding}
          step={totalStepsRef.current - importQueueRef.current.length}
          totalSteps={totalStepsRef.current}
          accountCount={pickerGroup.ids.length}
          onConfirm={handlePickerConfirm}
          onCancel={handlePickerCancel}
        />
      )}

      {retestDialog && (
        <RetestDialog
          keyIds={retestDialog.ids}
          onClose={() => { setRetestDialog(null); load() }}
        />
      )}
    </div>
  )
}

// ─── Re-Test Dialog ─────────────────────────────────────────────────────────

interface RetestResult {
  id: number
  maskedKey: string
  provider: string
  valid: boolean
  error?: string
}

function RetestDialog({ keyIds, onClose }: { keyIds: number[]; onClose: () => void }) {
  const [running, setRunning] = useState(true)
  const [progress, setProgress] = useState(0)
  const [results, setResults] = useState<RetestResult[]>([])
  const [removing, setRemoving] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    abortRef.current = controller
    ;(async () => {
      try {
        const resp = await fetch('/api/scanner/keys/validate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids: keyIds }),
          signal: controller.signal,
          credentials: 'same-origin',
        })
        const reader = resp.body?.getReader()
        if (!reader) { setRunning(false); return }

        const decoder = new TextDecoder()
        let buffer = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })

          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue
            try {
              const data = JSON.parse(line.slice(6))
              if (data.done) { setRunning(false); return }
              setProgress(p => p + 1)
              setResults(prev => [...prev, {
                id: data.id,
                maskedKey: data.masked_key,
                provider: data.provider,
                valid: data.valid,
                error: data.error,
              }])
            } catch { /* skip malformed lines */ }
          }
        }
      } catch (err: any) {
        if (err.name !== 'AbortError') {
          setResults(prev => [...prev, { id: 0, maskedKey: '???', provider: '???', valid: false, error: err.message }])
        }
      }
      setRunning(false)
    })()
    return () => { controller.abort() }
  }, [])

  const validCount = results.filter(r => r.valid).length
  const invalidCount = results.filter(r => !r.valid).length
  const invalidIds = results.filter(r => !r.valid).map(r => r.id)

  async function handleRemoveInvalid() {
    if (invalidIds.length === 0) return
    setRemoving(true)
    try {
      await api.scanner.bulkDelete(invalidIds)
      setResults(prev => prev.filter(r => r.valid))
    } catch { /* ignore */ }
    setRemoving(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => !running && onClose()}>
      <div
        className="bg-surface-raised border border-border rounded-xl p-6 w-full max-w-xl max-h-[80vh] flex flex-col shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-text-primary">
            {running ? 'Testing Keys...' : 'Test Results'}
          </h3>
          {!running && (
            <button onClick={onClose} className="text-text-muted hover:text-text-primary transition-colors cursor-pointer text-lg">
              <X size={16} />
            </button>
          )}
        </div>

        {running && (
          <div className="mb-4 space-y-2">
            <div className="flex items-center gap-2 text-sm text-text-secondary">
              <Loader2 size={14} className="animate-spin" />
              Testing {progress} of {keyIds.length}...
            </div>
            <div className="w-full bg-[rgba(255,255,255,0.08)] rounded-full h-2">
              <div
                className="bg-accent h-2 rounded-full transition-all"
                style={{ width: `${(progress / keyIds.length) * 100}%` }}
              />
            </div>
          </div>
        )}

        {!running && (
          <div className="flex items-center gap-4 mb-4 text-sm">
            <span className="text-success font-medium">{validCount} valid</span>
            <span className="text-error font-medium">{invalidCount} invalid</span>
            <span className="text-text-muted">{keyIds.length} total</span>
            {invalidCount > 0 && (
              <Button
                variant="destructive"
                size="sm"
                onClick={handleRemoveInvalid}
                disabled={removing}
                className="ml-auto"
              >
                {removing ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                Remove {invalidCount} Invalid
              </Button>
            )}
          </div>
        )}

        <div className="overflow-y-auto flex-1 space-y-1">
          {results.map(r => (
            <div key={r.id} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-[rgba(255,255,255,0.02)]">
              {r.valid ? (
                <CheckCircle2 size={14} className="text-success shrink-0" />
              ) : (
                <XCircle size={14} className="text-error shrink-0" />
              )}
              <span className={`inline-flex items-center rounded-sm px-1.5 py-0.5 text-xs font-medium border ${providerColor(r.provider)}`}>
                {r.provider}
              </span>
              <span className="text-xs font-mono text-text-secondary truncate">{r.maskedKey}</span>
              {r.error && <span className="text-xs text-error truncate ml-auto" title={r.error}>{r.error}</span>}
            </div>
          ))}
        </div>

        {!running && (
          <div className="flex justify-end mt-4 pt-3 border-t border-border">
            <Button variant="secondary" size="sm" onClick={onClose}>Close</Button>
          </div>
        )}
      </div>
    </div>
  )
}

function KeyRow({
  k,
  selected,
  working,
  fmt,
  onToggle,
  onTest,
  onImport,
  onDelete,
}: {
  k: DiscoveredKey
  selected: boolean
  working: boolean
  fmt: (ts: string | Date) => string
  onToggle: () => void
  onTest: () => void
  onImport: () => void
  onDelete: () => void
}) {
  return (
    <tr className={`border-b border-border last:border-0 hover:bg-[rgba(255,255,255,0.02)] transition-colors ${selected ? 'bg-accent-muted/30' : ''}`}>
      <td className="px-4 py-3">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          className="rounded border-border"
        />
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <ValidityIcon valid={k.valid} />
          <span className="font-mono text-xs text-text-primary">{k.masked_key}</span>
          {k.imported && <Badge variant="accent">Imported</Badge>}
        </div>
      </td>
      <td className="px-4 py-3">
        <span className={`inline-flex items-center rounded-sm px-2 py-0.5 text-xs font-medium border ${providerColor(k.provider)}`}>
          {k.provider}
        </span>
      </td>
      <td className="px-4 py-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-xs text-text-secondary">{k.source}</span>
          {k.source_repo && (
            <span className="text-xs text-text-muted truncate max-w-40" title={k.source_repo}>
              {k.source_repo}
            </span>
          )}
        </div>
      </td>
      <td className="px-4 py-3">
        <ValidityBadge valid={k.valid} />
      </td>
      <td className="px-4 py-3">
        <span className="text-xs text-text-muted">{fmt(k.discovered_at)}</span>
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center justify-end gap-1">
          {working ? (
            <Loader2 size={14} className="animate-spin text-text-muted" />
          ) : (
            <>
              <Button variant="ghost" size="sm" onClick={onTest} title="Test key">
                <FlaskConical size={14} />
              </Button>
              {!k.imported && (
                <Button variant="ghost" size="sm" onClick={onImport} title="Import key">
                  <Download size={14} />
                  Import
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={onDelete} title="Delete key" className="text-error hover:text-error hover:bg-error/10">
                <Trash2 size={14} />
              </Button>
            </>
          )}
        </div>
      </td>
    </tr>
  )
}

// ─── History Tab ──────────────────────────────────────────────────────────────

function HistoryTab({ fmt }: { fmt: (ts: string | Date) => string }) {
  const [history, setHistory] = useState<ScanHistory[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    setLoading(true)
    api.scanner
      .history(50)
      .then(setHistory)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load history'))
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-text-muted">
        <Loader2 size={18} className="animate-spin" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-error/10 border border-error/30 rounded-lg px-4 py-3 text-sm text-error">
        {error}
      </div>
    )
  }

  return (
    <div className="bg-surface-raised border border-border rounded-xl overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            <th className="px-4 py-3 text-left text-xs text-text-muted uppercase tracking-wider font-medium">Source</th>
            <th className="px-4 py-3 text-left text-xs text-text-muted uppercase tracking-wider font-medium">Started</th>
            <th className="px-4 py-3 text-left text-xs text-text-muted uppercase tracking-wider font-medium">Completed</th>
            <th className="px-4 py-3 text-left text-xs text-text-muted uppercase tracking-wider font-medium">Status</th>
            <th className="px-4 py-3 text-right text-xs text-text-muted uppercase tracking-wider font-medium">Found</th>
            <th className="px-4 py-3 text-right text-xs text-text-muted uppercase tracking-wider font-medium">New</th>
            <th className="px-4 py-3 text-right text-xs text-text-muted uppercase tracking-wider font-medium">Valid</th>
          </tr>
        </thead>
        <tbody>
          {history.length === 0 && (
            <tr>
              <td colSpan={7} className="px-4 py-10 text-center text-text-muted text-sm">
                No scan history yet.
              </td>
            </tr>
          )}
          {history.map(h => (
            <tr key={h.id} className="border-b border-border last:border-0 hover:bg-[rgba(255,255,255,0.02)] transition-colors">
              <td className="px-4 py-3 text-text-primary">{h.source}</td>
              <td className="px-4 py-3 text-text-muted text-xs">{fmt(h.started_at)}</td>
              <td className="px-4 py-3 text-text-muted text-xs">{h.completed_at ? fmt(h.completed_at) : '—'}</td>
              <td className="px-4 py-3">
                <HistoryStatusBadge status={h.status} />
                {h.error_message && (
                  <p className="text-xs text-error mt-1 max-w-xs truncate" title={h.error_message}>
                    {h.error_message}
                  </p>
                )}
              </td>
              <td className="px-4 py-3 text-right text-text-primary font-medium">{h.keys_found}</td>
              <td className="px-4 py-3 text-right text-text-primary font-medium">{h.keys_new}</td>
              <td className="px-4 py-3 text-right text-success font-medium">{h.keys_valid}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function HistoryStatusBadge({ status }: { status: string }) {
  if (status === 'completed') return <Badge variant="success">Completed</Badge>
  if (status === 'running') return <Badge variant="warning">Running</Badge>
  if (status === 'failed') return <Badge variant="error">Failed</Badge>
  return <Badge variant="neutral">{status}</Badge>
}

// ─── Patterns Tab ─────────────────────────────────────────────────────────────

function PatternsTab({ showToast }: { showToast: (msg: string) => void }) {
  const [patterns, setPatterns] = useState<ScanKeyPattern[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [toggling, setToggling] = useState<Set<number>>(new Set())

  useEffect(() => {
    api.scanner
      .patterns()
      .then(setPatterns)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load patterns'))
      .finally(() => setLoading(false))
  }, [])

  async function handleToggle(p: ScanKeyPattern) {
    setToggling(prev => new Set(prev).add(p.id))
    try {
      await api.scanner.upsertPattern({ ...p, enabled: !p.enabled })
      setPatterns(prev => prev.map(x => x.id === p.id ? { ...x, enabled: !x.enabled } : x))
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Failed to update pattern')
    } finally {
      setToggling(prev => { const s = new Set(prev); s.delete(p.id); return s })
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-text-muted">
        <Loader2 size={18} className="animate-spin" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-error/10 border border-error/30 rounded-lg px-4 py-3 text-sm text-error">
        {error}
      </div>
    )
  }

  return (
    <div className="bg-surface-raised border border-border rounded-xl overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            <th className="px-4 py-3 text-left text-xs text-text-muted uppercase tracking-wider font-medium">Provider</th>
            <th className="px-4 py-3 text-left text-xs text-text-muted uppercase tracking-wider font-medium">Prefix</th>
            <th className="px-4 py-3 text-left text-xs text-text-muted uppercase tracking-wider font-medium">Pattern (Regex)</th>
            <th className="px-4 py-3 text-left text-xs text-text-muted uppercase tracking-wider font-medium">Search Term</th>
            <th className="px-4 py-3 text-center text-xs text-text-muted uppercase tracking-wider font-medium">Enabled</th>
          </tr>
        </thead>
        <tbody>
          {patterns.length === 0 && (
            <tr>
              <td colSpan={5} className="px-4 py-10 text-center text-text-muted text-sm">
                No patterns configured.
              </td>
            </tr>
          )}
          {patterns.map(p => (
            <tr key={p.id} className="border-b border-border last:border-0 hover:bg-[rgba(255,255,255,0.02)] transition-colors">
              <td className="px-4 py-3">
                <span className={`inline-flex items-center rounded-sm px-2 py-0.5 text-xs font-medium border ${providerColor(p.provider)}`}>
                  {p.provider}
                </span>
              </td>
              <td className="px-4 py-3 font-mono text-xs text-text-primary">{p.prefix}</td>
              <td className="px-4 py-3 font-mono text-xs text-text-muted max-w-56 truncate" title={p.regex}>
                {p.regex}
              </td>
              <td className="px-4 py-3 text-xs text-text-secondary">{p.search_term}</td>
              <td className="px-4 py-3 text-center">
                {toggling.has(p.id) ? (
                  <Loader2 size={14} className="animate-spin text-text-muted inline" />
                ) : (
                  <button
                    onClick={() => handleToggle(p)}
                    className={`w-9 h-5 rounded-full transition-colors relative focus:outline-none ${p.enabled ? 'bg-accent' : 'bg-border'}`}
                    aria-checked={p.enabled}
                    role="switch"
                  >
                    <span
                      className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${p.enabled ? 'translate-x-4' : 'translate-x-0.5'}`}
                    />
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
