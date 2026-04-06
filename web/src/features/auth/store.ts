import { create } from "zustand"

interface AuthState {
  isAuthenticated: boolean
  setAuth: () => void
  clearAuth: () => void
}

export const useAuthStore = create<AuthState>((set) => ({
  isAuthenticated: false,
  setAuth: () => set({ isAuthenticated: true }),
  clearAuth: () => set({ isAuthenticated: false }),
}))
