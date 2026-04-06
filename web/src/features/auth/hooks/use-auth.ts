import { useRouter } from "@tanstack/react-router"
import { api } from "@/lib/api"
import { useAuthStore } from "../store"

export function useAuth() {
  const router = useRouter()
  const { isAuthenticated, setAuth, clearAuth } = useAuthStore()

  async function login(password: string) {
    await api.auth.login(password)
    setAuth()
    await router.navigate({ to: "/" })
  }

  async function logout() {
    await api.auth.logout()
    clearAuth()
    await router.navigate({ to: "/login" })
  }

  return { isAuthenticated, login, logout }
}
