import type { ReactNode } from "react"
import type { LucideIcon } from "lucide-react"

export interface NavItem {
  label: string
  href: string
  icon?: LucideIcon
  badge?: string
  children?: NavItem[]
}

export interface NavGroup {
  label?: string
  items: NavItem[]
}

export interface LayoutProps {
  children: ReactNode
  nav: NavGroup[]
  headerSlot?: ReactNode
}

export interface BreadcrumbItem {
  label: string
  href?: string
}

export interface TabItem {
  label: string
  value: string
  href: string
}

export interface PageHeaderProps {
  breadcrumbs?: BreadcrumbItem[]
  title: string
  description?: string
  actions?: ReactNode
  tabs?: TabItem[]
}
