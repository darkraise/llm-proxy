import { createFileRoute, redirect } from "@tanstack/react-router"
import { AuthLayout } from "@/features/auth"
import { useAuthStore } from "@/features/auth/store"

export const Route = createFileRoute("/_guest")({
  beforeLoad: () => {
    if (useAuthStore.getState().isAuthenticated) {
      throw redirect({ to: "/" })
    }
  },
  component: AuthLayout,
})
