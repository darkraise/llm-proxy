import { FormEvent, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Box } from 'lucide-react'
import { api, ApiError } from '../lib/api'

export default function Login() {
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await api.auth.login(password)
      navigate('/')
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.status === 401 ? 'Invalid password.' : err.message)
      } else {
        setError('Network error. Please try again.')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-surface flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex items-center justify-center gap-3 mb-8">
          <div className="w-10 h-10 bg-linear-to-br from-[#7c5bf0] to-[#5b8cf0] rounded-[10px] flex items-center justify-center">
            <Box size={20} className="text-white" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-text-primary">LLM Proxy</h1>
            <p className="text-sm text-text-secondary">Admin Dashboard</p>
          </div>
        </div>

        {/* Card */}
        <div className="bg-surface-raised border border-border rounded-xl p-6">
          <h2 className="text-base font-medium text-text-primary mb-1">Sign in</h2>
          <p className="text-sm text-text-secondary mb-5">
            Enter your admin password to continue.
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="password" className="label">
                Password
              </label>
              <input
                id="password"
                type="password"
                autoFocus
                autoComplete="current-password"
                className="input"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>

            {error && (
              <p className="text-error bg-error/10 border border-error/30 rounded-md px-3 py-2">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading || !password}
              className="w-full bg-accent-muted text-accent-light hover:bg-[rgba(124,91,240,0.2)] rounded-lg text-sm font-medium px-4 py-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
