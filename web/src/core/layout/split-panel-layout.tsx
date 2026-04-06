import { useState, useCallback } from "react"
import { cn } from "@/core/lib/utils"
import { SearchCommand } from "./search-command"
import { BrandLogo } from "./brand-logo"
import { LayoutHeader } from "./layout-header"
import type { LayoutProps } from "./types"
import type { ReactNode } from "react"

interface SplitPanelLayoutProps extends LayoutProps {
  panel: ReactNode
  defaultPanelWidth?: number
  minPanelWidth?: number
  maxPanelWidth?: number
}

export function SplitPanelLayout({
  children,
  nav,
  headerSlot,
  panel,
  defaultPanelWidth = 320,
  minPanelWidth = 240,
  maxPanelWidth = 480,
}: SplitPanelLayoutProps) {
  const [panelWidth, setPanelWidth] = useState(defaultPanelWidth)
  const [isDragging, setIsDragging] = useState(false)

  const handleMouseDown = useCallback(() => {
    setIsDragging(true)
    const handleMouseMove = (e: MouseEvent) => {
      const width = Math.min(Math.max(e.clientX, minPanelWidth), maxPanelWidth)
      setPanelWidth(width)
    }
    const handleMouseUp = () => {
      setIsDragging(false)
      document.removeEventListener("mousemove", handleMouseMove)
      document.removeEventListener("mouseup", handleMouseUp)
    }
    document.addEventListener("mousemove", handleMouseMove)
    document.addEventListener("mouseup", handleMouseUp)
  }, [minPanelWidth, maxPanelWidth])

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <LayoutHeader nav={nav} headerSlot={headerSlot} className="gap-4">
        <BrandLogo />
        <SearchCommand
          navItems={nav.flatMap((g) =>
            g.items.map((i) => ({ label: i.label, href: i.href })),
          )}
        />
      </LayoutHeader>

      <div className="flex flex-1 overflow-hidden">
        {/* List panel */}
        <div
          className="flex-shrink-0 overflow-y-auto border-r border-border"
          style={{ width: panelWidth }}
        >
          {panel}
        </div>

        {/* Resize handle */}
        <div
          className={cn(
            "w-1 cursor-col-resize bg-transparent transition-colors hover:bg-primary/20",
            isDragging && "bg-primary/30",
          )}
          onMouseDown={handleMouseDown}
        />

        {/* Content */}
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  )
}
