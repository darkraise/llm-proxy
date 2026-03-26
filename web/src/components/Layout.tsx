import { useState, useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar, SIDEBAR_COLLAPSED_KEY } from './Sidebar';
import { useLocalStorage } from '../hooks/useLocalStorage';

export default function Layout() {
  const [collapsed] = useLocalStorage(SIDEBAR_COLLAPSED_KEY, false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia('(max-width: 768px)');
    setIsMobile(mql.matches);
    const handler = () => setIsMobile(mql.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  const isCollapsed = isMobile || collapsed;

  return (
    <div className="flex min-h-screen bg-surface">
      <Sidebar />
      <main
        className="flex-1 p-6 transition-all duration-200 overflow-auto"
        style={{ marginLeft: isCollapsed ? 60 : 220 }}
      >
        <Outlet />
      </main>
    </div>
  );
}
