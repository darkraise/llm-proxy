import { FormEvent, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { Box } from 'lucide-react'

export default function Setup() {
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')

    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }

    setSaving(true)
    try {
      await api.auth.setup(password)
      navigate('/login')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Setup failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface p-4">
      <div className="bg-surface-raised border border-border rounded-xl p-8 w-full max-w-md">
        <div className="flex flex-col items-center mb-6">
          <div className="w-12 h-12 bg-linear-to-br from-[#7c5bf0] to-[#5b8cf0] rounded-xl flex items-center justify-center mb-4">
            <Box size={24} className="text-white" />
          </div>
          <h1 className="text-xl font-semibold text-text-primary">Welcome to LLM Proxy</h1>
          <p className="text-sm text-text-secondary mt-1">Set up your admin password to get started.</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-xs uppercase tracking-wider text-text-secondary block mb-1">Admin Password</label>
            <input
              type="password"
              className="input w-full"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Minimum 8 characters"
              autoComplete="new-password"
              autoFocus
              required
            />
          </div>

          <div>
            <label className="text-xs uppercase tracking-wider text-text-secondary block mb-1">Confirm Password</label>
            <input
              type="password"
              className="input w-full"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Repeat password"
              autoComplete="new-password"
              required
            />
          </div>

          {error && (
            <p className="text-sm text-error">{error}</p>
          )}

          <button
            type="submit"
            disabled={saving}
            className="w-full bg-accent-muted text-accent-light hover:bg-[rgba(124,91,240,0.2)] rounded-lg text-sm font-medium px-4 py-2.5 transition-colors disabled:opacity-50"
          >
            {saving ? 'Setting up...' : 'Set Password & Continue'}
          </button>
        </form>
      </div>
    </div>
  )
}
