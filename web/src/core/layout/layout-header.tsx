import type { ReactNode } from "react"
import { cn } from "@/core/lib/utils"
import { ThemeSwitcher } from "@/core/theme"
import { SearchCommand } from "./search-command"
import { UserMenu } from "./user-menu"
import { NotificationBell } from "./notification-bell"
import { MobileDrawer } from "./mobile-drawer"
import type { NavGroup } from "./types"

interface LayoutHeaderProps {
  nav: NavGroup[]
  headerSlot?: ReactNode
  className?: string
  children?: ReactNode
}

export function LayoutHeader({
  nav,
  headerSlot,
  className,
  children,
}: LayoutHeaderProps) {
  const flatNavItems = nav.flatMap((g) =>
    g.items.map((i) => ({ label: i.label, href: i.href })),
  )

  return (
    <header
      className={cn(
        "flex h-14 items-center gap-2 border-b border-border bg-surface-header px-4",
        className,
      )}
    >
      <MobileDrawer nav={nav} />
      {children ?? <SearchCommand navItems={flatNavItems} />}
      <div className="ml-auto flex items-center gap-1">
        {headerSlot}
        <ThemeSwitcher />
        <NotificationBell />
        <UserMenu />
      </div>
    </header>
  )
}
