import { useState } from "react"
import { Link } from "@tanstack/react-router"
import { PanelLeftClose, PanelLeft } from "lucide-react"
import { cn } from "@/core/lib/utils"
import { Button } from "@/core/components/ui/button"
import { ScrollArea } from "@/core/components/ui/scroll-area"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/core/components/ui/tooltip"
import { BrandLogo } from "./brand-logo"
import { LayoutHeader } from "./layout-header"
import type { LayoutProps } from "./types"

export function SidebarLayout({ children, nav, headerSlot }: LayoutProps) {
  const [collapsed, setCollapsed] = useState(false)

  return (
    <TooltipProvider delayDuration={0}>
      <div className="flex h-screen overflow-hidden">
        {/* Sidebar */}
        <aside
          className={cn(
            "sidebar-gradient-overlay theme-transition hidden flex-col border-r bg-surface-sidebar transition-all duration-300 md:flex",
            collapsed ? "w-16" : "w-64",
          )}
          style={{ borderColor: "hsl(var(--sidebar-border))" }}
        >
          {/* Logo */}
          <div
            className={cn(
              "flex h-14 items-center border-b px-4",
              collapsed && "justify-center px-0",
            )}
            style={{ borderColor: "hsl(var(--sidebar-border))" }}
          >
            {collapsed ? (
              <BrandLogo />
            ) : (
              <span
                className="text-lg font-medium"
                style={{ color: "hsl(var(--sidebar-foreground-hover))" }}
              >
                App
              </span>
            )}
          </div>

          {/* Nav */}
          <ScrollArea className="flex-1 py-4">
            <nav className="flex flex-col gap-1 px-2">
              {nav.map((group, gi) => (
                <div key={gi} className={gi > 0 ? "mt-4" : ""}>
                  {group.label && !collapsed && (
                    <p
                      className="mb-1 px-3 text-xs font-medium uppercase tracking-wider"
                      style={{ color: "hsl(var(--sidebar-foreground-muted))" }}
                    >
                      {group.label}
                    </p>
                  )}
                  {group.items.map((item) => {
                    const linkContent = (
                      <Link
                        key={item.href}
                        to={item.href}
                        className={cn(
                          "sidebar-nav-item flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors duration-150",
                          collapsed && "justify-center px-0",
                        )}
                        activeOptions={{ exact: true }}
                        activeProps={{ className: "active" }}
                      >
                        {item.icon && (
                          <item.icon className="h-4 w-4 shrink-0" />
                        )}
                        {!collapsed && <span>{item.label}</span>}
                        {!collapsed && item.badge && (
                          <span className="ml-auto rounded-full bg-primary/20 px-2 py-0.5 text-xs text-primary">
                            {item.badge}
                          </span>
                        )}
                      </Link>
                    )

                    if (collapsed) {
                      return (
                        <Tooltip key={item.href}>
                          <TooltipTrigger asChild>{linkContent}</TooltipTrigger>
                          <TooltipContent side="right">
                            {item.label}
                          </TooltipContent>
                        </Tooltip>
                      )
                    }
                    return linkContent
                  })}
                </div>
              ))}
            </nav>
          </ScrollArea>

          {/* Collapse toggle */}
          <div
            className="border-t p-2"
            style={{ borderColor: "hsl(var(--sidebar-border))" }}
          >
            <Button
              variant="ghost"
              size="icon"
              className="sidebar-nav-item w-full"
              onClick={() => setCollapsed(!collapsed)}
            >
              {collapsed ? (
                <PanelLeft className="h-4 w-4" />
              ) : (
                <PanelLeftClose className="h-4 w-4" />
              )}
            </Button>
          </div>
        </aside>

        {/* Main area */}
        <div className="flex flex-1 flex-col overflow-hidden">
          {/* Global header */}
          <LayoutHeader
            nav={nav}
            headerSlot={headerSlot}
            className="header-gradient-overlay theme-transition"
          />

          {/* Content */}
          <main className="flex-1 overflow-y-auto p-6" data-content>
            {children}
          </main>
        </div>
      </div>
    </TooltipProvider>
  )
}
