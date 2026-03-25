import { FormEvent, useEffect, useRef, useState } from 'react'
import { api, ApiError } from '../lib/api'

interface SaveStatus {
  ok: boolean
  msg: string
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card p-5">
      <h2 className="text-sm font-semibold text-text-primary mb-4 pb-2 border-b border-border">
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
      <label className="label">{label}</label>
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
        className="btn-primary disabled:opacity-50"
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
  const [retries, setRetries] = useState(settings.max_retries ?? '3')
  const [retention, setRetention] = useState(settings.log_retention_days ?? '30')
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
      })
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
            className="input"
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
            className="input"
            min={0}
            max={10}
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
            className="input"
            min={1}
            max={365}
            value={retention}
            onChange={(e) => setRetention(e.target.value)}
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
  const [proxyKey, setProxyKey] = useState(settings.proxy_api_key ?? '')
  const [showKey, setShowKey] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [pwSaving, setPwSaving] = useState(false)
  const [status, setStatus] = useState<SaveStatus | null>(null)
  const [pwStatus, setPwStatus] = useState<SaveStatus | null>(null)

  async function handleSaveAuth(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    setStatus(null)
    try {
      await api.settings.update({
        proxy_auth_enabled: proxyAuth ? 'true' : 'false',
        proxy_api_key: proxyKey,
      })
      setStatus({ ok: true, msg: 'Saved.' })
    } catch (err) {
      setStatus({ ok: false, msg: err instanceof Error ? err.message : 'Save failed' })
    } finally {
      setSaving(false)
    }
  }

  async function handleChangePassword(e: FormEvent) {
    e.preventDefault()
    if (newPassword !== confirmPassword) {
      setPwStatus({ ok: false, msg: 'Passwords do not match.' })
      return
    }
    if (newPassword.length < 8) {
      setPwStatus({ ok: false, msg: 'Password must be at least 8 characters.' })
      return
    }
    setPwSaving(true)
    setPwStatus(null)
    try {
      await api.settings.update({ admin_password: newPassword })
      setNewPassword('')
      setConfirmPassword('')
      setPwStatus({ ok: true, msg: 'Password changed. Please log in again.' })
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Failed to change password'
      setPwStatus({ ok: false, msg })
    } finally {
      setPwSaving(false)
    }
  }

  return (
    <Section title="Security">
      <div className="space-y-6">
        {/* Proxy auth */}
        <form onSubmit={handleSaveAuth} className="space-y-4">
          <Field label="Proxy Authentication" hint="Require an API key for all proxied requests.">
            <div className="flex items-center gap-2 mt-1">
              <input
                id="proxy-auth"
                type="checkbox"
                className="checkbox"
                checked={proxyAuth}
                onChange={(e) => setProxyAuth(e.target.checked)}
              />
              <label htmlFor="proxy-auth" className="text-sm text-text-primary">
                Enable proxy auth
              </label>
            </div>
          </Field>

          {proxyAuth && (
            <Field label="Proxy API Key" hint="Clients must send this as a Bearer token.">
              <div className="flex gap-2">
                <input
                  className="input font-mono flex-1"
                  type={showKey ? 'text' : 'password'}
                  value={proxyKey}
                  onChange={(e) => setProxyKey(e.target.value)}
                  placeholder="sk-proxy-..."
                  autoComplete="off"
                />
                <button
                  type="button"
                  onClick={() => setShowKey((v) => !v)}
                  className="btn-secondary px-2"
                >
                  {showKey ? 'Hide' : 'Show'}
                </button>
              </div>
            </Field>
          )}

          <SaveButton saving={saving} status={status} />
        </form>

        {/* Change password */}
        <div className="border-t border-border pt-4">
          <p className="text-sm font-medium text-text-primary mb-3">Change Admin Password</p>
          <form onSubmit={handleChangePassword} className="space-y-3">
            <Field label="New Password">
              <input
                type="password"
                className="input"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
                placeholder="Minimum 8 characters"
                required
              />
            </Field>
            <Field label="Confirm Password">
              <input
                type="password"
                className="input"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                placeholder="Repeat password"
                required
              />
            </Field>
            <SaveButton saving={pwSaving} status={pwStatus} />
          </form>
        </div>
      </div>
    </Section>
  )
}

// ─── Ollama Fallback Section ─────────────────────────────────────────────────

function OllamaSettings({ settings }: { settings: Record<string, string> }) {
  const [enabled, setEnabled] = useState(settings.ollama_fallback_enabled === 'true')
  const [url, setUrl] = useState(settings.ollama_fallback_url ?? 'http://localhost:11434')
  const [model, setModel] = useState(settings.ollama_fallback_model ?? '')
  const [timeout, setTimeout] = useState(settings.ollama_fallback_timeout ?? '60')
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<SaveStatus | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    setStatus(null)
    try {
      await api.settings.update({
        ollama_fallback_enabled: enabled ? 'true' : 'false',
        ollama_fallback_url: url,
        ollama_fallback_model: model,
        ollama_fallback_timeout: timeout,
      })
      setStatus({ ok: true, msg: 'Saved.' })
    } catch (err) {
      setStatus({ ok: false, msg: err instanceof Error ? err.message : 'Save failed' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Section title="Ollama Fallback">
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field
          label="Enable Ollama Fallback"
          hint="Route requests to a local Ollama instance when all upstream providers fail."
        >
          <div className="flex items-center gap-2 mt-1">
            <input
              id="ollama-enabled"
              type="checkbox"
              className="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            <label htmlFor="ollama-enabled" className="text-sm text-text-primary">
              Enable fallback
            </label>
          </div>
        </Field>

        {enabled && (
          <>
            <Field label="Ollama URL" hint="Base URL of your Ollama instance.">
              <input
                type="url"
                className="input"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="http://localhost:11434"
              />
            </Field>
            <Field label="Fallback Model" hint="Model to use when falling back to Ollama.">
              <input
                className="input font-mono"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="llama3.2"
              />
            </Field>
            <Field label="Timeout (seconds)" hint="Request timeout for Ollama calls.">
              <input
                type="number"
                className="input"
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
            className="btn-secondary"
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
            className="btn-secondary disabled:opacity-50"
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
        <div className="text-sm text-error bg-error/10 border border-error/30 rounded-md px-3 py-2">
          {error}
        </div>
      )}

      {settings === null && !error ? (
        <div className="text-sm text-text-muted text-center py-16">Loading…</div>
      ) : settings ? (
        <div className="space-y-5">
          <GeneralSettings settings={settings} />
          <SecuritySettings settings={settings} />
          <OllamaSettings settings={settings} />
          <ConfigSettings />
        </div>
      ) : null}
    </div>
  )
}
