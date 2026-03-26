import { Outlet } from 'react-router-dom';
import { Sidebar, SIDEBAR_COLLAPSED_KEY, SIDEBAR_WIDTH_COLLAPSED, SIDEBAR_WIDTH_EXPANDED } from './Sidebar';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { useMediaQuery } from '../hooks/useMediaQuery';

export default function Layout() {
  const [collapsed] = useLocalStorage(SIDEBAR_COLLAPSED_KEY, false);
  const isMobile = useMediaQuery('(max-width: 768px)');

  const isCollapsed = isMobile || collapsed;

  return (
    <div className="flex min-h-screen bg-surface">
      <Sidebar />
      <main
        className="flex-1 p-6 transition-all duration-200 overflow-auto"
        style={{ marginLeft: isCollapsed ? SIDEBAR_WIDTH_COLLAPSED : SIDEBAR_WIDTH_EXPANDED }}
      >
        <Outlet />
      </main>
    </div>
  );
}
