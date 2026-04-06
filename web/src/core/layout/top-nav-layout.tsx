import { Link } from "@tanstack/react-router"
import { cn } from "@/core/lib/utils"
import { SearchCommand } from "./search-command"
import { BrandLogo } from "./brand-logo"
import { LayoutHeader } from "./layout-header"
import type { LayoutProps } from "./types"

export function TopNavLayout({ children, nav, headerSlot }: LayoutProps) {
  const flatNavItems = nav.flatMap((g) =>
    g.items.map((i) => ({ label: i.label, href: i.href })),
  )

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <LayoutHeader
        nav={nav}
        className="gap-4"
        headerSlot={
          <>
            <SearchCommand navItems={flatNavItems} />
            {headerSlot}
          </>
        }
      >
        <BrandLogo />
        <nav className="hidden items-center gap-1 md:flex">
          {nav.flatMap((group) =>
            group.items.map((item) => (
              <Link
                key={item.href}
                to={item.href}
                className={cn(
                  "flex items-center gap-2 rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors duration-150 hover:text-foreground [&.active]:bg-accent [&.active]:text-accent-foreground",
                )}
                activeProps={{ className: "active" }}
              >
                {item.icon && <item.icon className="h-4 w-4" />}
                {item.label}
              </Link>
            )),
          )}
        </nav>
      </LayoutHeader>

      <main className="flex-1 overflow-y-auto p-6">{children}</main>
    </div>
  )
}
