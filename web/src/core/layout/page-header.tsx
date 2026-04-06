import { Link } from "@tanstack/react-router"
import { ChevronRight } from "lucide-react"
import type { PageHeaderProps } from "./types"

export function PageHeader({
  breadcrumbs,
  title,
  description,
  actions,
  tabs,
}: PageHeaderProps) {
  return (
    <div className="space-y-4 pb-4">
      {breadcrumbs && breadcrumbs.length > 0 && (
        <nav className="flex items-center gap-1 text-sm text-muted-foreground">
          {breadcrumbs.map((crumb, i) => (
            <span key={crumb.label} className="flex items-center gap-1">
              {i > 0 && <ChevronRight className="h-3.5 w-3.5" />}
              {crumb.href ? (
                <Link
                  to={crumb.href}
                  className="transition-colors duration-150 hover:text-foreground"
                >
                  {crumb.label}
                </Link>
              ) : (
                <span className="text-foreground">{crumb.label}</span>
              )}
            </span>
          ))}
        </nav>
      )}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-medium">{title}</h1>
          {description && (
            <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          )}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
      {tabs && tabs.length > 0 && (
        <nav className="flex gap-4 border-b border-border">
          {tabs.map((tab) => (
            <Link
              key={tab.value}
              to={tab.href}
              className="border-b-2 border-transparent px-1 pb-2 text-sm text-muted-foreground transition-colors duration-150 hover:text-foreground [&.active]:border-primary [&.active]:text-foreground"
              activeProps={{ className: "active" }}
            >
              {tab.label}
            </Link>
          ))}
        </nav>
      )}
    </div>
  )
}
