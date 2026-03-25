import { FormEvent, useState } from 'react'
import { useNavigate } from 'react-router-dom'
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
          <div className="w-10 h-10 bg-accent rounded-lg flex items-center justify-center">
            <svg width="20" height="20" viewBox="0 0 16 16" fill="white">
              <path d="M8 0L0 4v8l8 4 8-4V4L8 0zM1.5 4.9L8 1.6l6.5 3.3v6.2L8 14.4l-6.5-3.3V4.9z" />
            </svg>
          </div>
          <div>
            <h1 className="text-lg font-semibold text-text-primary">LLM Proxy</h1>
            <p className="text-xs text-text-muted">Admin Dashboard</p>
          </div>
        </div>

        {/* Card */}
        <div className="card p-6">
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
              <p className="text-sm text-error bg-error/10 border border-error/30 rounded-md px-3 py-2">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading || !password}
              className="btn-primary w-full disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
