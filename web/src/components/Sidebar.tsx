import {
  LayoutGrid,
  Users,
  Activity,
  FileText,
  Settings,
  Moon,
  Sun,
  ChevronsLeft,
  ChevronsRight,
  LogOut,
  Box,
} from 'lucide-react';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { useTheme } from '../hooks/useTheme';
import { ToggleSwitch } from './ui/ToggleSwitch';
import { useLocation, useNavigate, Link } from 'react-router-dom';
import { api } from '../lib/api';

export const SIDEBAR_COLLAPSED_KEY = 'llm-proxy:sidebar-collapsed';
export const SIDEBAR_WIDTH_EXPANDED = 220;
export const SIDEBAR_WIDTH_COLLAPSED = 60;

const NAV_ITEMS = [
  { path: '/', icon: LayoutGrid, label: 'Dashboard' },
  { path: '/accounts', icon: Users, label: 'Accounts' },
  { path: '/rate-limits', icon: Activity, label: 'Rate Limits' },
  { path: '/logs', icon: FileText, label: 'Usage Logs' },
  { path: '/settings', icon: Settings, label: 'Settings' },
];

export function Sidebar() {
  const [collapsed, setCollapsed] = useLocalStorage(SIDEBAR_COLLAPSED_KEY, false);
  const [theme, toggleTheme] = useTheme();
  const location = useLocation();
  const navigate = useNavigate();
  const isMobile = useMediaQuery('(max-width: 768px)');

  const isCollapsed = isMobile || collapsed;
  const width = isCollapsed ? SIDEBAR_WIDTH_COLLAPSED : SIDEBAR_WIDTH_EXPANDED;

  function isActive(path: string) {
    if (path === '/') return location.pathname === '/';
    return location.pathname.startsWith(path);
  }

  async function handleLogout() {
    try {
      await api.auth.logout();
    } finally {
      navigate('/login');
    }
  }

  return (
    <aside
      aria-label="Main navigation"
      className="fixed top-0 left-0 h-screen bg-surface-raised border-r border-border flex flex-col z-10 transition-all duration-200"
      style={{ width }}
    >
      {/* Logo */}
      <div className="px-3 py-4 border-b border-border">
        {isCollapsed ? (
          <div className="flex items-center justify-center">
            {isMobile ? (
              <div className="w-9 h-9 bg-linear-to-br from-[#7c5bf0] to-[#5b8cf0] rounded-xl flex items-center justify-center shrink-0">
                <Box size={16} className="text-white" />
              </div>
            ) : (
              <button
                aria-expanded={false}
                onClick={() => setCollapsed(false)}
                className="w-9 h-9 bg-linear-to-br from-[#7c5bf0] to-[#5b8cf0] rounded-xl flex items-center justify-center shrink-0 cursor-pointer"
                title="Expand sidebar"
              >
                <ChevronsRight size={14} className="text-white" />
              </button>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-linear-to-br from-[#7c5bf0] to-[#5b8cf0] rounded-xl flex items-center justify-center shrink-0">
              <Box size={16} className="text-white" />
            </div>
            <span className="text-base font-semibold text-text-primary whitespace-nowrap">
              LLM Proxy
            </span>
            <button
              aria-expanded={true}
              onClick={() => setCollapsed(true)}
              className="ml-auto text-text-muted hover:text-text-primary transition-colors p-1"
              title="Collapse sidebar"
            >
              <ChevronsLeft size={14} />
            </button>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav aria-label="Primary" className="flex-1 py-3 px-2 overflow-y-auto">
        <div className="flex flex-col gap-0.5">
          {NAV_ITEMS.map((item) => {
            const active = isActive(item.path);
            const Icon = item.icon;

            if (isCollapsed) {
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  title={item.label}
                  className={`flex items-center justify-center w-10 h-10 rounded-xl mx-auto transition-colors ${
                    active
                      ? 'bg-accent-muted text-accent-light'
                      : 'text-text-muted hover:text-text-primary hover:bg-[rgba(255,255,255,0.04)]'
                  }`}
                >
                  <Icon size={18} />
                </Link>
              );
            }

            return (
              <Link
                key={item.path}
                to={item.path}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-lg transition-colors ${
                  active
                    ? 'bg-accent-muted text-accent-light font-medium'
                    : 'text-text-muted hover:text-text-primary hover:bg-[rgba(255,255,255,0.04)]'
                }`}
              >
                <Icon size={18} />
                <span className="text-sm">{item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>

      {/* Bottom */}
      <div className="border-t border-border p-2 flex flex-col gap-1">
        {isCollapsed ? (
          <>
            <button
              onClick={toggleTheme}
              title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              className="flex items-center justify-center w-10 h-10 mx-auto rounded-xl text-text-muted hover:text-text-primary hover:bg-[rgba(255,255,255,0.04)] transition-colors"
            >
              {theme === 'dark' ? <Moon size={18} /> : <Sun size={18} />}
            </button>
            <button
              onClick={handleLogout}
              title="Logout"
              className="flex items-center justify-center w-10 h-10 mx-auto rounded-xl text-text-muted hover:text-text-primary hover:bg-[rgba(255,255,255,0.04)] transition-colors"
            >
              <LogOut size={18} />
            </button>
          </>
        ) : (
          <>
            <div className="flex items-center justify-between px-3 py-2">
              <div className="flex items-center gap-2.5 text-text-muted">
                {theme === 'dark' ? <Moon size={18} /> : <Sun size={18} />}
                <span className="text-sm">
                  {theme === 'dark' ? 'Dark mode' : 'Light mode'}
                </span>
              </div>
              <ToggleSwitch
                checked={theme === 'dark'}
                onChange={() => toggleTheme()}
              />
            </div>
            <button
              onClick={handleLogout}
              className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-text-muted hover:text-text-primary hover:bg-[rgba(255,255,255,0.04)] transition-colors w-full"
            >
              <LogOut size={18} />
              <span className="text-sm">Logout</span>
            </button>
          </>
        )}
      </div>
    </aside>
  );
}
