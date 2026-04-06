import { Menu } from "lucide-react"
import { Link } from "@tanstack/react-router"
import { Button } from "@/core/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/core/components/ui/sheet"
import type { NavGroup } from "./types"

interface MobileDrawerProps {
  nav: NavGroup[]
}

export function MobileDrawer({ nav }: MobileDrawerProps) {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="md:hidden">
          <Menu className="h-5 w-5" />
          <span className="sr-only">Open menu</span>
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-72">
        <SheetHeader>
          <SheetTitle>Navigation</SheetTitle>
        </SheetHeader>
        <nav className="mt-4 flex flex-col gap-1">
          {nav.map((group, gi) => (
            <div key={gi}>
              {group.label && (
                <p className="mb-1 px-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  {group.label}
                </p>
              )}
              {group.items.map((item) => (
                <Link
                  key={item.href}
                  to={item.href}
                  className="flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors duration-150 hover:bg-accent [&.active]:bg-accent [&.active]:text-accent-foreground"
                  activeProps={{ className: "active" }}
                >
                  {item.icon && <item.icon className="h-4 w-4" />}
                  {item.label}
                </Link>
              ))}
            </div>
          ))}
        </nav>
      </SheetContent>
    </Sheet>
  )
}
