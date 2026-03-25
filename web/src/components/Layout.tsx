import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { api } from '../lib/api'

const navItems = [
  {
    to: '/',
    label: 'Dashboard',
    end: true,
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
        <path d="M1.5 1h4v5h-4zM1.5 8.5h4v6h-4zM8.5 7h6v6h-6zM8.5 1h6v4h-6z" />
      </svg>
    ),
  },
  {
    to: '/accounts',
    label: 'Accounts',
    end: false,
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
        <path d="M0 3.5A1.5 1.5 0 0 1 1.5 2h13A1.5 1.5 0 0 1 16 3.5v2A1.5 1.5 0 0 1 14.5 7h-13A1.5 1.5 0 0 1 0 5.5v-2zm1.5-.5a.5.5 0 0 0-.5.5v2a.5.5 0 0 0 .5.5h13a.5.5 0 0 0 .5-.5v-2a.5.5 0 0 0-.5-.5h-13zM0 10.5A1.5 1.5 0 0 1 1.5 9h13a1.5 1.5 0 0 1 1.5 1.5v2a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 0 12.5v-2zm1.5-.5a.5.5 0 0 0-.5.5v2a.5.5 0 0 0 .5.5h13a.5.5 0 0 0 .5-.5v-2a.5.5 0 0 0-.5-.5h-13z" />
      </svg>
    ),
  },
  {
    to: '/rate-limits',
    label: 'Rate Limits',
    end: false,
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
        <path d="M8 1a1 1 0 0 1 1 1v.5h2.5a.5.5 0 0 1 0 1H10v.5a1 1 0 0 1-2 0V3.5H4.5a.5.5 0 0 1 0-1H7V2a1 1 0 0 1 1-1zm3 6a1 1 0 0 1 1 1v.5h.5a.5.5 0 0 1 0 1H12v.5a1 1 0 0 1-2 0V9.5H1.5a.5.5 0 0 1 0-1H10V8a1 1 0 0 1 1-1zm-6 5a1 1 0 0 1 1 1v.5h7.5a.5.5 0 0 1 0 1H6v.5a1 1 0 0 1-2 0v-.5H1.5a.5.5 0 0 1 0-1H4V13a1 1 0 0 1 1-1z" />
      </svg>
    ),
  },
  {
    to: '/logs',
    label: 'Usage Logs',
    end: false,
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
        <path d="M5 4a.5.5 0 0 0 0 1h6a.5.5 0 0 0 0-1H5zm-.5 2.5A.5.5 0 0 1 5 6h6a.5.5 0 0 1 0 1H5a.5.5 0 0 1-.5-.5zM5 8a.5.5 0 0 0 0 1h6a.5.5 0 0 0 0-1H5zm0 2a.5.5 0 0 0 0 1h3a.5.5 0 0 0 0-1H5z" />
        <path d="M2 2a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V2zm10-1H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1z" />
      </svg>
    ),
  },
  {
    to: '/settings',
    label: 'Settings',
    end: false,
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
        <path d="M9.405 1.05c-.413-1.4-2.397-1.4-2.81 0l-.1.34a1.464 1.464 0 0 1-2.105.872l-.31-.17c-1.283-.698-2.686.705-1.987 1.987l.169.311c.446.82.023 1.841-.872 2.105l-.34.1c-1.4.413-1.4 2.397 0 2.81l.34.1a1.464 1.464 0 0 1 .872 2.105l-.17.31c-.698 1.283.705 2.686 1.987 1.987l.311-.169a1.464 1.464 0 0 1 2.105.872l.1.34c.413 1.4 2.397 1.4 2.81 0l.1-.34a1.464 1.464 0 0 1 2.105-.872l.31.17c1.283.698 2.686-.705 1.987-1.987l-.169-.311a1.464 1.464 0 0 1 .872-2.105l.34-.1c1.4-.413 1.4-2.397 0-2.81l-.34-.1a1.464 1.464 0 0 1-.872-2.105l.17-.31c.698-1.283-.705-2.686-1.987-1.987l-.311.169a1.464 1.464 0 0 1-2.105-.872l-.1-.34zM8 10.93a2.929 2.929 0 1 1 0-5.86 2.929 2.929 0 0 1 0 5.858z" />
      </svg>
    ),
  },
]

export default function Layout() {
  const navigate = useNavigate()

  async function handleLogout() {
    try {
      await api.auth.logout()
    } finally {
      navigate('/login')
    }
  }

  return (
    <div className="flex h-full">
      {/* Sidebar */}
      <aside className="fixed inset-y-0 left-0 w-56 bg-surface-raised border-r border-border flex flex-col z-10">
        {/* Logo */}
        <div className="px-4 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 bg-accent rounded-md flex items-center justify-center flex-shrink-0">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="white">
                <path d="M8 0L0 4v8l8 4 8-4V4L8 0zM1.5 4.9L8 1.6l6.5 3.3v6.2L8 14.4l-6.5-3.3V4.9z" />
              </svg>
            </div>
            <span className="text-sm font-semibold text-text-primary">LLM Proxy</span>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 py-3 px-2 space-y-0.5 overflow-y-auto">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `flex items-center gap-2.5 px-2.5 py-2 rounded-md text-sm transition-colors ${
                  isActive
                    ? 'bg-accent/10 text-accent font-medium'
                    : 'text-text-secondary hover:text-text-primary hover:bg-surface-overlay'
                }`
              }
            >
              {item.icon}
              {item.label}
            </NavLink>
          ))}
        </nav>

        {/* Logout */}
        <div className="p-2 border-t border-border">
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-sm text-text-secondary hover:text-text-primary hover:bg-surface-overlay transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M10 12.5a.5.5 0 0 1-.5.5h-8a.5.5 0 0 1-.5-.5v-9a.5.5 0 0 1 .5-.5h8a.5.5 0 0 1 .5.5v2a.5.5 0 0 0 1 0v-2A1.5 1.5 0 0 0 9.5 2h-8A1.5 1.5 0 0 0 0 3.5v9A1.5 1.5 0 0 0 1.5 14h8a1.5 1.5 0 0 0 1.5-1.5v-2a.5.5 0 0 0-1 0v2z"
              />
              <path
                fillRule="evenodd"
                d="M15.854 8.354a.5.5 0 0 0 0-.708l-3-3a.5.5 0 0 0-.708.708L14.293 7.5H5.5a.5.5 0 0 0 0 1h8.793l-2.147 2.146a.5.5 0 0 0 .708.708l3-3z"
              />
            </svg>
            Logout
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="ml-56 flex-1 min-h-full overflow-auto">
        <Outlet />
      </main>
    </div>
  )
}
