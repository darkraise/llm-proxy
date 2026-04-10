import { createRootRoute, Outlet } from "@tanstack/react-router"
import { AppProviders } from "@/providers/app-providers"

export const Route = createRootRoute({
  component: () => (
    <AppProviders>
      <Outlet />
    </AppProviders>
  ),
})
