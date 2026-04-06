import { createFileRoute, Outlet, redirect } from "@tanstack/react-router"
import {
  LayoutDashboard,
  Users,
  Blocks,
  Gauge,
  ScrollText,
  KeyRound,
  ScanSearch,
  Settings,
} from "lucide-react"
import { SidebarLayout } from "@/core/layout/sidebar-layout"
import type { NavGroup } from "@/core/layout/types"
import { useAuthStore } from "@/features/auth/store"
import { api } from "@/lib/api"

const nav: NavGroup[] = [
  {
    label: "Overview",
    items: [
      { label: "Dashboard", href: "/", icon: LayoutDashboard },
    ],
  },
  {
    label: "Management",
    items: [
      { label: "Accounts", href: "/accounts", icon: Users },
      { label: "Providers", href: "/providers", icon: Blocks },
      { label: "Rate Limits", href: "/rate-limits", icon: Gauge },
    ],
  },
  {
    label: "Monitoring",
    items: [
      { label: "Usage Logs", href: "/logs", icon: ScrollText },
    ],
  },
  {
    label: "Tools",
    items: [
      { label: "Keys Test", href: "/keys-test", icon: KeyRound },
      { label: "Scanner", href: "/scanner", icon: ScanSearch },
    ],
  },
  {
    label: "System",
    items: [
      { label: "Settings", href: "/settings", icon: Settings },
    ],
  },
]

export const Route = createFileRoute("/_authenticated")({
  beforeLoad: async () => {
    const { isAuthenticated, setAuth } = useAuthStore.getState()
    if (!isAuthenticated) {
      try {
        await api.settings.get()
        setAuth()
      } catch {
        throw redirect({ to: "/login" })
      }
    }
  },
  component: () => (
    <SidebarLayout nav={nav}>
      <Outlet />
    </SidebarLayout>
  ),
})
