import { FormEvent, useEffect, useRef, useState } from 'react'
import { api, type OllamaModel } from '../lib/api'
import { ToggleSwitch } from '../components/ui/ToggleSwitch'
import { Select } from '../components/ui/Select'
import { Button } from '../components/ui/Button'
import { DATE_FORMAT_PRESETS, DEFAULT_FORMAT } from '../lib/dateformat'

interface SaveStatus {
  ok: boolean
  msg: string
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-surface-raised border border-border rounded-xl p-5">
      <h2 className="text-sm font-medium text-text-primary mb-4">
        {title}
      </h2>
      {children}
    </div>
  )
}

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs uppercase tracking-wider text-text-secondary">{label}</label>
      {children}
      {hint && <p className="text-xs text-text-muted mt-0.5">{hint}</p>}
    </div>
  )
}

function SaveButton({ saving, status }: { saving: boolean; status: SaveStatus | null }) {
  return (
    <div className="flex items-center gap-3 pt-3 mt-3 border-t border-border">
      <button
        type="submit"
        disabled={saving}
        className="bg-accent-muted text-accent-light hover:bg-[rgba(124,91,240,0.2)] rounded-lg text-sm font-medium px-4 py-2 disabled:opacity-50"
      >
        {saving ? 'Saving…' : 'Save'}
      </button>
      {status && (
        <span className={`text-xs ${status.ok ? 'text-success' : 'text-error'}`}>
          {status.msg}
        </span>
      )}
    </div>
  )
}

// ─── General Section ─────────────────────────────────────────────────────────

function GeneralSettings({ settings }: { settings: Record<string, string> }) {
  const [timeout, setTimeout] = useState(settings.request_timeout ?? '30')
  const [retries, setRetries] = useState(settings.max_retries ?? '12')
  const [retention, setRetention] = useState(settings.log_retention_days ?? '30')
  const [dateFormat, setDateFormat] = useState(settings.datetime_format ?? DEFAULT_FORMAT)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<SaveStatus | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    setStatus(null)
    try {
      await api.settings.update({
        request_timeout: timeout,
        max_retries: retries,
        log_retention_days: retention,
        datetime_format: dateFormat,
      })
      window.dispatchEvent(new CustomEvent('datetime-format-changed', { detail: dateFormat }))
      setStatus({ ok: true, msg: 'Saved.' })
    } catch (err) {
      setStatus({ ok: false, msg: err instanceof Error ? err.message : 'Save failed' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Section title="General">
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field
          label="Request Timeout (seconds)"
          hint="Maximum time to wait for an upstream provider response."
        >
          <input
            type="number"
            className="bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.1)] rounded-lg px-3 py-2 text-sm text-text-primary focus:ring-2 focus:ring-accent focus:border-transparent w-full"
            min={1}
            max={300}
            value={timeout}
            onChange={(e) => setTimeout(e.target.value)}
          />
        </Field>
        <Field
          label="Max Retries"
          hint="How many times to retry a failed request before giving up."
        >
          <input
            type="number"
            className="bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.1)] rounded-lg px-3 py-2 text-sm text-text-primary focus:ring-2 focus:ring-accent focus:border-transparent w-full"
            min={1}
            max={50}
            value={retries}
            onChange={(e) => setRetries(e.target.value)}
          />
        </Field>
        <Field
          label="Log Retention (days)"
          hint="Request logs older than this are pruned automatically."
        >
          <input
            type="number"
            className="bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.1)] rounded-lg px-3 py-2 text-sm text-text-primary focus:ring-2 focus:ring-accent focus:border-transparent w-full"
            min={1}
            max={365}
            value={retention}
            onChange={(e) => setRetention(e.target.value)}
          />
        </Field>
        <Field
          label="Date/Time Format"
          hint="Display format for timestamps across the dashboard and logs."
        >
          <Select
            value={dateFormat}
            onChange={(v) => setDateFormat(v)}
            options={DATE_FORMAT_PRESETS.map((p) => ({
              value: p.key,
              label: `${p.label} — ${p.example}`,
            }))}
          />
        </Field>
        <SaveButton saving={saving} status={status} />
      </form>
    </Section>
  )
}

// ─── Security Section ─────────────────────────────────────────────────────────

function SecuritySettings({ settings }: { settings: Record<string, string> }) {
  const [proxyAuth, setProxyAuth] = useState(settings.proxy_auth_enabled === 'true')
  const [proxyKey, setProxyKey] = useState('')
  const keyConfigured = settings.proxy_api_key_configured === 'true'
  const [showKey, setShowKey] = useState(false)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<SaveStatus | null>(null)

  async function handleSaveAuth(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    setStatus(null)
    try {
      const payload: Record<string, string> = {
        proxy_auth_enabled: proxyAuth ? 'true' : 'false',
      }
      if (proxyKey) payload.proxy_api_key = proxyKey
      await api.settings.update(payload)
      setProxyKey('')
      setStatus({ ok: true, msg: 'Saved.' })
    } catch (err) {
      setStatus({ ok: false, msg: err instanceof Error ? err.message : 'Save failed' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Section title="Security">
      <form onSubmit={handleSaveAuth} className="space-y-4">
        <Field label="Proxy Authentication" hint="Require an API key for all proxied requests.">
          <div className="mt-1">
            <ToggleSwitch
              checked={proxyAuth}
              onChange={setProxyAuth}
              label="Enable proxy auth"
            />
          </div>
        </Field>

        {proxyAuth && (
          <Field
            label="Proxy API Key"
            hint={keyConfigured
              ? 'A key is configured. Enter a new value to replace it, or leave blank to keep current.'
              : 'Set an API key that clients must send as a Bearer token.'}
          >
            <div className="flex gap-2">
              <input
                className="bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.1)] rounded-lg px-3 py-2 text-sm text-text-primary focus:ring-2 focus:ring-accent focus:border-transparent font-mono flex-1"
                type={showKey ? 'text' : 'password'}
                value={proxyKey}
                onChange={(e) => setProxyKey(e.target.value)}
                placeholder={keyConfigured ? '••••••••  (blank = keep current)' : 'sk-proxy-...'}
                autoComplete="off"
              />
              <button
                type="button"
                onClick={() => setShowKey((v) => !v)}
                className="bg-[rgba(255,255,255,0.05)] text-text-secondary hover:bg-[rgba(255,255,255,0.08)] rounded-lg text-sm font-medium px-4 py-2"
              >
                {showKey ? 'Hide' : 'Show'}
              </button>
            </div>
          </Field>
        )}

        <SaveButton saving={saving} status={status} />
      </form>
    </Section>
  )
}

// ─── Ollama Fallback Section ─────────────────────────────────────────────────

function OllamaSettings({ settings }: { settings: Record<string, string> }) {
  const [enabled, setEnabled] = useState(settings.fallback_enabled === 'true')
  const [url, setUrl] = useState(settings.fallback_url ?? 'http://localhost:11434')
  const [chatModel, setChatModel] = useState(settings.fallback_chat_model ?? '')
  const [embeddingModel, setEmbeddingModel] = useState(settings.fallback_embedding_model ?? '')
  const [timeout, setTimeout] = useState(settings.fallback_timeout ?? '60')
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<SaveStatus | null>(null)
  const [models, setModels] = useState<OllamaModel[]>([])
  const [fetching, setFetching] = useState(false)
  const [fetchError, setFetchError] = useState('')

  async function fetchModels() {
    setFetching(true)
    setFetchError('')
    try {
      const result = await api.ollama.discover(url)
      setModels(result)
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : 'Failed to fetch models')
    } finally {
      setFetching(false)
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    setStatus(null)
    try {
      await api.settings.update({
        fallback_enabled: enabled ? 'true' : 'false',
        fallback_url: url,
        fallback_chat_model: chatModel,
        fallback_embedding_model: embeddingModel,
        fallback_timeout: timeout,
      })
      setStatus({ ok: true, msg: 'Saved.' })
    } catch (err) {
      setStatus({ ok: false, msg: err instanceof Error ? err.message : 'Save failed' })
    } finally {
      setSaving(false)
    }
  }

  const inputClass = 'bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.1)] rounded-lg px-3 py-2 text-sm text-text-primary focus:ring-2 focus:ring-accent focus:border-transparent w-full'

  // Classify fetched models into likely embedding vs chat
  const embeddingFamilies = ['bert', 'nomic-bert', 'nomic']
  const embeddingKeywords = ['embed', 'bge', 'gte', 'e5', 'nomic']
  const isLikelyEmbedding = (m: OllamaModel) =>
    embeddingFamilies.includes(m.family.toLowerCase()) ||
    embeddingKeywords.some((k) => m.name.toLowerCase().includes(k))

  const chatModels = models.filter((m) => !isLikelyEmbedding(m))
  const embeddingModels = models.filter((m) => isLikelyEmbedding(m))

  return (
    <Section title="Ollama Fallback">
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field
          label="Enable Ollama Fallback"
          hint="Route requests to a local Ollama instance when all upstream providers fail."
        >
          <div className="mt-1">
            <ToggleSwitch
              checked={enabled}
              onChange={setEnabled}
              label="Enable fallback"
            />
          </div>
        </Field>

        {enabled && (
          <>
            <Field label="Ollama URL" hint="Base URL of your Ollama instance.">
              <div className="flex gap-2">
                <input
                  type="url"
                  className={inputClass}
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="http://localhost:11434"
                />
                <Button
                  type="button"
                  variant="secondary"
                  onClick={fetchModels}
                  disabled={fetching || !url}
                  className="shrink-0"
                >
                  {fetching ? 'Fetching...' : 'Fetch Models'}
                </Button>
              </div>
              {fetchError && (
                <p className="text-xs text-red-400 mt-1">{fetchError}</p>
              )}
              {models.length > 0 && (
                <p className="text-xs text-text-secondary mt-1">
                  Found {models.length} model{models.length !== 1 ? 's' : ''}
                </p>
              )}
            </Field>

            <Field label="Chat Model" hint="Model for chat completions fallback.">
              {models.length > 0 ? (
                <Select
                  value={chatModel}
                  onChange={setChatModel}
                  placeholder="Select chat model..."
                  options={[
                    { value: '', label: 'None (disabled)' },
                    ...chatModels.map((m) => ({ value: m.name, label: m.name })),
                    ...embeddingModels.map((m) => ({ value: m.name, label: `${m.name} (embedding)` })),
                  ]}
                />
              ) : (
                <input
                  className={inputClass + ' font-mono'}
                  value={chatModel}
                  onChange={(e) => setChatModel(e.target.value)}
                  placeholder="llama3.2"
                />
              )}
            </Field>

            <Field label="Embedding Model" hint="Model for embeddings fallback. Leave empty to disable.">
              {models.length > 0 ? (
                <Select
                  value={embeddingModel}
                  onChange={setEmbeddingModel}
                  placeholder="Select embedding model..."
                  options={[
                    { value: '', label: 'None (disabled)' },
                    ...embeddingModels.map((m) => ({ value: m.name, label: m.name })),
                    ...chatModels.map((m) => ({ value: m.name, label: `${m.name} (chat)` })),
                  ]}
                />
              ) : (
                <input
                  className={inputClass + ' font-mono'}
                  value={embeddingModel}
                  onChange={(e) => setEmbeddingModel(e.target.value)}
                  placeholder="nomic-embed-text"
                />
              )}
            </Field>

            <Field label="Timeout (seconds)" hint="Request timeout for Ollama calls.">
              <input
                type="number"
                className={inputClass}
                min={1}
                max={600}
                value={timeout}
                onChange={(e) => setTimeout(e.target.value)}
              />
            </Field>
          </>
        )}

        <SaveButton saving={saving} status={status} />
      </form>
    </Section>
  )
}

// ─── Notification Settings Section ───────────────────────────────────────────

interface ChannelConfig {
  email: {
    enabled: boolean
    smtp_host: string
    smtp_port: number
    smtp_user: string
    smtp_password: string
    from: string
    to: string
  }
  telegram: {
    enabled: boolean
    bot_token: string
    chat_id: string
  }
  discord: {
    enabled: boolean
    webhook_url: string
  }
}

interface AlertConfig {
  provider_unstable: { enabled: boolean; cooldown_min: number }
  error_rate_exceeded: { enabled: boolean; cooldown_min: number; threshold_pct: number; window_minutes: number }
  providers_exhausted: { enabled: boolean; cooldown_min: number }
  account_auth_failure: { enabled: boolean; cooldown_min: number }
  daily_summary: { enabled: boolean; cooldown_min: number; hour: number }
  provider_recovered: { enabled: boolean; cooldown_min: number }
}

const DEFAULT_CHANNELS: ChannelConfig = {
  email: { enabled: false, smtp_host: '', smtp_port: 587, smtp_user: '', smtp_password: '', from: '', to: '' },
  telegram: { enabled: false, bot_token: '', chat_id: '' },
  discord: { enabled: false, webhook_url: '' },
}

const DEFAULT_ALERTS: AlertConfig = {
  provider_unstable: { enabled: true, cooldown_min: 30 },
  error_rate_exceeded: { enabled: true, cooldown_min: 15, threshold_pct: 10, window_minutes: 5 },
  providers_exhausted: { enabled: true, cooldown_min: 5 },
  account_auth_failure: { enabled: true, cooldown_min: 60 },
  daily_summary: { enabled: false, cooldown_min: 1440, hour: 8 },
  provider_recovered: { enabled: true, cooldown_min: 30 },
}

const INPUT_CLS = 'bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.1)] rounded-lg px-3 py-2 text-sm text-text-primary focus:ring-2 focus:ring-accent focus:border-transparent w-full'

function ChannelCard({
  title,
  enabled,
  onToggle,
  children,
}: {
  title: string
  enabled: boolean
  onToggle: (v: boolean) => void
  children: React.ReactNode
}) {
  return (
    <div className="border border-border rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-text-primary">{title}</span>
        <ToggleSwitch checked={enabled} onChange={onToggle} label={`Enable ${title}`} />
      </div>
      {enabled && <div className="space-y-3 pt-1">{children}</div>}
    </div>
  )
}

function NotificationSettings({ settings }: { settings: Record<string, string> }) {
  const [channels, setChannels] = useState<ChannelConfig>(() => {
    try {
      return { ...DEFAULT_CHANNELS, ...JSON.parse(settings.notification_channels ?? '{}') }
    } catch {
      return DEFAULT_CHANNELS
    }
  })

  const [alerts, setAlerts] = useState<AlertConfig>(() => {
    try {
      const parsed = JSON.parse(settings.notification_alerts ?? '{}')
      const merged = { ...DEFAULT_ALERTS }
      for (const key of Object.keys(DEFAULT_ALERTS) as (keyof AlertConfig)[]) {
        if (parsed[key]) merged[key] = { ...DEFAULT_ALERTS[key], ...parsed[key] }
      }
      return merged
    } catch {
      return DEFAULT_ALERTS
    }
  })

  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [status, setStatus] = useState<SaveStatus | null>(null)
  const [testStatus, setTestStatus] = useState<SaveStatus | null>(null)

  function setEmail<K extends keyof ChannelConfig['email']>(key: K, value: ChannelConfig['email'][K]) {
    setChannels((prev) => ({ ...prev, email: { ...prev.email, [key]: value } }))
  }

  function setTelegram<K extends keyof ChannelConfig['telegram']>(key: K, value: ChannelConfig['telegram'][K]) {
    setChannels((prev) => ({ ...prev, telegram: { ...prev.telegram, [key]: value } }))
  }

  function setDiscord<K extends keyof ChannelConfig['discord']>(key: K, value: ChannelConfig['discord'][K]) {
    setChannels((prev) => ({ ...prev, discord: { ...prev.discord, [key]: value } }))
  }

  function setAlert<K extends keyof AlertConfig, F extends keyof AlertConfig[K]>(
    key: K,
    field: F,
    value: AlertConfig[K][F],
  ) {
    setAlerts((prev) => ({ ...prev, [key]: { ...prev[key], [field]: value } }))
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    setStatus(null)
    try {
      await api.settings.update({
        notification_channels: JSON.stringify(channels),
        notification_alerts: JSON.stringify(alerts),
      })
      setStatus({ ok: true, msg: 'Saved.' })
    } catch (err) {
      setStatus({ ok: false, msg: err instanceof Error ? err.message : 'Save failed' })
    } finally {
      setSaving(false)
    }
  }

  async function handleTest() {
    setTesting(true)
    setTestStatus(null)
    try {
      const res = await api.notifications.test()
      setTestStatus(res.success ? { ok: true, msg: 'Test notification sent.' } : { ok: false, msg: res.error ?? 'Test failed.' })
    } catch (err) {
      setTestStatus({ ok: false, msg: err instanceof Error ? err.message : 'Test failed' })
    } finally {
      setTesting(false)
    }
  }

  const ALERT_LABELS: Record<keyof AlertConfig, string> = {
    provider_unstable: 'Provider Unstable',
    error_rate_exceeded: 'Error Rate Exceeded',
    providers_exhausted: 'All Providers Exhausted',
    account_auth_failure: 'Account Auth Failure',
    daily_summary: 'Daily Summary',
    provider_recovered: 'Provider Recovered',
  }

  return (
    <Section title="Notifications">
      <form onSubmit={handleSave} className="space-y-6">

        {/* Channels */}
        <div className="space-y-3">
          <p className="text-xs uppercase tracking-wider text-text-secondary">Channels</p>

          <ChannelCard
            title="Email"
            enabled={channels.email.enabled}
            onToggle={(v) => setEmail('enabled', v)}
          >
            <Field label="SMTP Host">
              <input className={INPUT_CLS} type="text" value={channels.email.smtp_host} onChange={(e) => setEmail('smtp_host', e.target.value)} placeholder="smtp.example.com" />
            </Field>
            <Field label="SMTP Port">
              <input className={INPUT_CLS} type="number" value={channels.email.smtp_port} onChange={(e) => setEmail('smtp_port', Number(e.target.value))} min={1} max={65535} />
            </Field>
            <Field label="SMTP User">
              <input className={INPUT_CLS} type="text" value={channels.email.smtp_user} onChange={(e) => setEmail('smtp_user', e.target.value)} placeholder="user@example.com" />
            </Field>
            <Field label="SMTP Password">
              <input className={INPUT_CLS} type="password" value={channels.email.smtp_password} onChange={(e) => setEmail('smtp_password', e.target.value)} autoComplete="off" placeholder="••••••••" />
            </Field>
            <Field label="From">
              <input className={INPUT_CLS} type="text" value={channels.email.from} onChange={(e) => setEmail('from', e.target.value)} placeholder="noreply@example.com" />
            </Field>
            <Field label="To (comma-separated)">
              <input className={INPUT_CLS} type="text" value={channels.email.to} onChange={(e) => setEmail('to', e.target.value)} placeholder="admin@example.com, ops@example.com" />
            </Field>
          </ChannelCard>

          <ChannelCard
            title="Telegram"
            enabled={channels.telegram.enabled}
            onToggle={(v) => setTelegram('enabled', v)}
          >
            <Field label="Bot Token">
              <input className={INPUT_CLS} type="password" value={channels.telegram.bot_token} onChange={(e) => setTelegram('bot_token', e.target.value)} autoComplete="off" placeholder="123456:ABC-..." />
            </Field>
            <Field label="Chat ID">
              <input className={INPUT_CLS} type="text" value={channels.telegram.chat_id} onChange={(e) => setTelegram('chat_id', e.target.value)} placeholder="-100123456789" />
            </Field>
          </ChannelCard>

          <ChannelCard
            title="Discord"
            enabled={channels.discord.enabled}
            onToggle={(v) => setDiscord('enabled', v)}
          >
            <Field label="Webhook URL">
              <input className={INPUT_CLS} type="password" value={channels.discord.webhook_url} onChange={(e) => setDiscord('webhook_url', e.target.value)} autoComplete="off" placeholder="https://discord.com/api/webhooks/..." />
            </Field>
          </ChannelCard>
        </div>

        {/* Alerts */}
        <div className="space-y-3">
          <p className="text-xs uppercase tracking-wider text-text-secondary">Alert Rules</p>
          <div className="space-y-2">
            {(Object.keys(alerts) as (keyof AlertConfig)[]).map((key) => {
              const alert = alerts[key]
              return (
                <div key={key} className="border border-border rounded-lg px-4 py-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-text-primary">{ALERT_LABELS[key]}</span>
                    <ToggleSwitch
                      checked={alert.enabled}
                      onChange={(v) => setAlert(key, 'enabled' as never, v as never)}
                      label={ALERT_LABELS[key]}
                    />
                  </div>
                  {alert.enabled && (
                    <div className="flex flex-wrap gap-3">
                      <div className="flex items-center gap-2">
                        <label className="text-xs text-text-secondary whitespace-nowrap">Cooldown (min)</label>
                        <input
                          className="bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.1)] rounded-lg px-3 py-1.5 text-sm text-text-primary focus:ring-2 focus:ring-accent focus:border-transparent w-20"
                          type="number"
                          min={1}
                          value={alert.cooldown_min}
                          onChange={(e) => setAlert(key, 'cooldown_min' as never, Number(e.target.value) as never)}
                        />
                      </div>
                      {key === 'error_rate_exceeded' && (
                        <>
                          <div className="flex items-center gap-2">
                            <label className="text-xs text-text-secondary whitespace-nowrap">Threshold %</label>
                            <input
                              className="bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.1)] rounded-lg px-3 py-1.5 text-sm text-text-primary focus:ring-2 focus:ring-accent focus:border-transparent w-20"
                              type="number"
                              min={1}
                              max={100}
                              value={(alert as AlertConfig['error_rate_exceeded']).threshold_pct}
                              onChange={(e) => setAlert(key, 'threshold_pct' as never, Number(e.target.value) as never)}
                            />
                          </div>
                          <div className="flex items-center gap-2">
                            <label className="text-xs text-text-secondary whitespace-nowrap">Window (min)</label>
                            <input
                              className="bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.1)] rounded-lg px-3 py-1.5 text-sm text-text-primary focus:ring-2 focus:ring-accent focus:border-transparent w-20"
                              type="number"
                              min={1}
                              value={(alert as AlertConfig['error_rate_exceeded']).window_minutes}
                              onChange={(e) => setAlert(key, 'window_minutes' as never, Number(e.target.value) as never)}
                            />
                          </div>
                        </>
                      )}
                      {key === 'daily_summary' && (
                        <div className="flex items-center gap-2">
                          <label className="text-xs text-text-secondary whitespace-nowrap">Hour (0–23)</label>
                          <input
                            className="bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.1)] rounded-lg px-3 py-1.5 text-sm text-text-primary focus:ring-2 focus:ring-accent focus:border-transparent w-20"
                            type="number"
                            min={0}
                            max={23}
                            value={(alert as AlertConfig['daily_summary']).hour}
                            onChange={(e) => setAlert(key, 'hour' as never, Number(e.target.value) as never)}
                          />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3 pt-3 mt-3 border-t border-border">
          <button
            type="submit"
            disabled={saving}
            className="bg-accent-muted text-accent-light hover:bg-[rgba(124,91,240,0.2)] rounded-lg text-sm font-medium px-4 py-2 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button
            type="button"
            onClick={handleTest}
            disabled={testing}
            className="bg-[rgba(255,255,255,0.05)] text-text-secondary hover:bg-[rgba(255,255,255,0.08)] rounded-lg text-sm font-medium px-4 py-2 disabled:opacity-50"
          >
            {testing ? 'Sending…' : 'Send Test'}
          </button>
          {status && (
            <span className={`text-xs ${status.ok ? 'text-success' : 'text-error'}`}>{status.msg}</span>
          )}
          {testStatus && (
            <span className={`text-xs ${testStatus.ok ? 'text-success' : 'text-error'}`}>{testStatus.msg}</span>
          )}
        </div>
      </form>
    </Section>
  )
}

// ─── Config Section ───────────────────────────────────────────────────────────

function ConfigSettings() {
  const importRef = useRef<HTMLInputElement>(null)
  const [importing, setImporting] = useState(false)
  const [status, setStatus] = useState<SaveStatus | null>(null)

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setImporting(true)
    setStatus(null)
    try {
      const text = await file.text()
      const res = await api.config.import(text)
      setStatus({ ok: true, msg: `Imported ${res.imported} provider(s).` })
    } catch (err) {
      setStatus({ ok: false, msg: err instanceof Error ? err.message : 'Import failed' })
    } finally {
      setImporting(false)
      e.target.value = ''
    }
  }

  return (
    <Section title="Configuration">
      <div className="space-y-4">
        <p className="text-sm text-text-secondary">
          Export your current configuration as YAML or import providers from a YAML file.
        </p>

        <div className="flex flex-wrap gap-3">
          <a
            href={api.config.exportUrl()}
            download
            className="bg-[rgba(255,255,255,0.05)] text-text-secondary hover:bg-[rgba(255,255,255,0.08)] rounded-lg text-sm font-medium px-4 py-2 flex items-center gap-1.5"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <path d="M.5 9.9a.5.5 0 0 1 .5.5v2.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2.5a.5.5 0 0 1 1 0v2.5a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2v-2.5a.5.5 0 0 1 .5-.5z" />
              <path d="M7.646 11.854a.5.5 0 0 0 .708 0l3-3a.5.5 0 0 0-.708-.708L8.5 10.293V1.5a.5.5 0 0 0-1 0v8.793L5.354 8.146a.5.5 0 1 0-.708.708l3 3z" />
            </svg>
            Export YAML
          </a>

          <button
            onClick={() => importRef.current?.click()}
            disabled={importing}
            className="bg-[rgba(255,255,255,0.05)] text-text-secondary hover:bg-[rgba(255,255,255,0.08)] rounded-lg text-sm font-medium px-4 py-2 flex items-center gap-1.5 disabled:opacity-50"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <path d="M.5 9.9a.5.5 0 0 1 .5.5v2.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2.5a.5.5 0 0 1 1 0v2.5a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2v-2.5a.5.5 0 0 1 .5-.5z" />
              <path d="M7.646 1.146a.5.5 0 0 1 .708 0l3 3a.5.5 0 0 1-.708.708L8.5 2.707V11.5a.5.5 0 0 1-1 0V2.707L5.354 4.854a.5.5 0 1 1-.708-.708l3-3z" />
            </svg>
            {importing ? 'Importing…' : 'Import YAML'}
          </button>

          <input
            ref={importRef}
            type="file"
            accept=".yml,.yaml"
            className="hidden"
            onChange={handleImport}
          />
        </div>

        {status && (
          <p className={`text-sm ${status.ok ? 'text-success' : 'text-error'}`}>
            {status.msg}
          </p>
        )}
      </div>
    </Section>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function Settings() {
  const [settings, setSettings] = useState<Record<string, string> | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    api.settings
      .get()
      .then(setSettings)
      .catch(() => setError('Failed to load settings.'))
  }, [])

  return (
    <div className="p-6 space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-text-primary">Settings</h1>
        <p className="text-sm text-text-secondary mt-0.5">Configure proxy behaviour</p>
      </div>

      {error && (
        <div className="text-error bg-error/10 border border-error/30 rounded-md px-3 py-2">
          {error}
        </div>
      )}

      {settings === null && !error ? (
        <div className="text-text-muted text-center py-16">Loading…</div>
      ) : settings ? (
        <div className="space-y-5">
          <GeneralSettings settings={settings} />
          <SecuritySettings settings={settings} />
          <OllamaSettings settings={settings} />
          <NotificationSettings settings={settings} />
          <ConfigSettings />
        </div>
      ) : null}
    </div>
  )
}
