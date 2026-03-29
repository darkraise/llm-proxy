import { useCallback, useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/Layout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Accounts from './pages/Accounts'
import RateLimits from './pages/RateLimits'
import UsageLogs from './pages/UsageLogs'
import Settings from './pages/Settings'
import { ToastProvider } from './components/ui/Toast'
import { DateFormatContext } from './hooks/useDateFormat'
import { formatDateTime, DEFAULT_FORMAT, type DateFormatKey } from './lib/dateformat'

export default function App() {
  const [formatKey, setFormatKey] = useState<DateFormatKey>(DEFAULT_FORMAT)

  // Listen for format changes from Settings page
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (detail) setFormatKey(detail as DateFormatKey)
    }
    window.addEventListener('datetime-format-changed', handler)
    return () => window.removeEventListener('datetime-format-changed', handler)
  }, [])

  // Also listen for settings loaded (from Layout after auth)
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (detail) setFormatKey(detail as DateFormatKey)
    }
    window.addEventListener('datetime-format-loaded', handler)
    return () => window.removeEventListener('datetime-format-loaded', handler)
  }, [])

  const fmt = useCallback((ts: string | Date) => formatDateTime(ts, formatKey), [formatKey])

  return (
    <DateFormatContext.Provider value={{ formatKey, fmt }}>
      <ToastProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route element={<Layout />}>
              <Route index element={<Dashboard />} />
              <Route path="/accounts" element={<Accounts />} />
              <Route path="/rate-limits" element={<RateLimits />} />
              <Route path="/logs" element={<UsageLogs />} />
              <Route path="/settings" element={<Settings />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </ToastProvider>
    </DateFormatContext.Provider>
  )
}
