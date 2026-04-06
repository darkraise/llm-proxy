# Frontend Migration to darkraise-web-template Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the llm-proxy React frontend with one built on the darkraise-web-template foundation — adopting TanStack Router, React Query, React Table, the template's theme engine, and its layout/UI component library.

**Architecture:** Copy the template's `src/core/` (UI primitives, layout, theme engine), `src/features/` (charts, data-table, forms, dashboard), and `src/styles/` verbatim. Adapt auth to password-only session cookies. Create React Query hooks wrapping the existing typed API client. Build all 8 pages from scratch using template components.

**Tech Stack:** React 19, TanStack Router/Query/Form/Table, Zustand, Zod, Radix UI, Tailwind CSS v4, Recharts, Sonner, Lucide icons

**Template source:** `D:\Repositories\Personal\darkraise-web-template`
**Target:** `D:\Repositories\Personal\llm-proxy\web`

---

## File Structure

### Carried from template (verbatim copy)
- `src/core/` — entire directory (components/ui, hooks, layout, lib, providers, theme)
- `src/features/charts/` — chart wrappers and hooks
- `src/features/data-table/` — DataTable and supporting components
- `src/features/forms/` — form field wrappers
- `src/features/dashboard/` — StatCard, KPICard, etc.
- `src/styles/globals.css` — theme tokens and global styles
- `components.json` — shadcn config

### Carried from current frontend (kept as-is)
- `src/lib/api.ts` — typed API client (615 lines)
- `src/lib/known-models.ts` — curated model lists per provider
- `src/lib/providers.ts` — provider list caching
- `src/lib/dateformat.ts` — date/time format presets and formatter

### New files to create
- `src/app.tsx` — RouterProvider wrapper
- `src/main.tsx` — React DOM root
- `src/features/auth/store.ts` — Zustand auth store (simplified: isAuthenticated only)
- `src/features/auth/hooks/use-auth.ts` — login/logout using api.ts
- `src/features/auth/components/auth-layout.tsx` — adapted from template (remove register links)
- `src/features/auth/components/login-form.tsx` — password-only form
- `src/features/auth/index.ts` — barrel export
- `src/routes/__root.tsx` — AppProviders wrapper
- `src/routes/_authenticated.tsx` — auth guard + SidebarLayout with llm-proxy nav
- `src/routes/_guest.tsx` — guest guard + AuthLayout
- `src/routes/_guest/login.tsx` — renders LoginForm
- `src/routes/_authenticated/index.tsx` — Dashboard
- `src/routes/_authenticated/accounts.tsx` — Accounts
- `src/routes/_authenticated/providers.tsx` — Providers
- `src/routes/_authenticated/rate-limits.tsx` — Rate Limits
- `src/routes/_authenticated/logs.tsx` — Usage Logs
- `src/routes/_authenticated/keys-test.tsx` — Keys Test
- `src/routes/_authenticated/scanner.tsx` — Scanner
- `src/routes/_authenticated/settings.tsx` — Settings
- `src/hooks/use-accounts.ts` — React Query hooks for accounts API
- `src/hooks/use-providers.ts` — React Query hooks for providers API
- `src/hooks/use-ratelimits.ts` — React Query hooks for rate limits API
- `src/hooks/use-stats.ts` — React Query hooks for stats API
- `src/hooks/use-settings.ts` — React Query hooks for settings API
- `src/hooks/use-logs.ts` — React Query hooks for logs API
- `src/hooks/use-scanner.ts` — React Query hooks for scanner API
- `src/hooks/use-ollama.ts` — React Query hooks for Ollama API
- `src/components/account-card.tsx` — account grid card
- `src/components/account-drawer.tsx` — account edit Sheet
- `src/components/add-models-dialog.tsx` — model selection dialog
- `src/components/bulk-edit-modal.tsx` — bulk edit dialog
- `src/components/rate-limit-table.tsx` — inline-editable rate limit table
- `src/components/model-picker-dialog.tsx` — categorized model picker
- `src/components/log-drawer.tsx` — request log detail Sheet
- `src/components/breakdown-tabs.tsx` — stats breakdown by provider/account/model
- `src/components/confirm-dialog.tsx` — reusable confirmation dialog

### Modified from template
- `src/core/theme/theme.config.ts` — purple defaults, simplified switcher
- `src/core/layout/brand-logo.tsx` — llm-proxy logo
- `src/core/layout/user-menu.tsx` — simplify for single-admin, wire up useAuth().logout directly
- `src/core/layout/layout-header.tsx` — remove NotificationBell (not needed for single-admin)

### Config files (new or replaced)
- `package.json` — merged dependencies
- `vite.config.ts` — TanStack Router plugin + Tailwind v4 plugin + API proxy
- `tsconfig.json` — single flat config (no references)
- `components.json` — from template

---

## Task 1: Scaffold — Replace web/ with template infrastructure

**Files:**
- Replace: `web/package.json`
- Replace: `web/vite.config.ts`
- Replace: `web/tsconfig.json`
- Create: `web/components.json`
- Copy: `web/src/core/` (from template)
- Copy: `web/src/features/charts/`, `web/src/features/data-table/`, `web/src/features/forms/`, `web/src/features/dashboard/` (from template)
- Copy: `web/src/styles/globals.css` (from template)
- Keep: `web/src/lib/api.ts`, `web/src/lib/known-models.ts`, `web/src/lib/providers.ts`, `web/src/lib/dateformat.ts`

- [ ] **Step 1: Back up files we keep, then clean src/**

```bash
cd D:/Repositories/Personal/llm-proxy/web
mkdir -p /tmp/llm-proxy-keep
cp src/lib/api.ts src/lib/known-models.ts src/lib/providers.ts src/lib/dateformat.ts /tmp/llm-proxy-keep/
rm -rf src/
```

- [ ] **Step 2: Copy template src/core/, src/features/, src/styles/**

```bash
TEMPLATE="D:/Repositories/Personal/darkraise-web-template"
TARGET="D:/Repositories/Personal/llm-proxy/web"

mkdir -p "$TARGET/src"
cp -r "$TEMPLATE/src/core" "$TARGET/src/core"
cp -r "$TEMPLATE/src/styles" "$TARGET/src/styles"

mkdir -p "$TARGET/src/features"
cp -r "$TEMPLATE/src/features/charts" "$TARGET/src/features/charts"
cp -r "$TEMPLATE/src/features/data-table" "$TARGET/src/features/data-table"
cp -r "$TEMPLATE/src/features/forms" "$TARGET/src/features/forms"
cp -r "$TEMPLATE/src/features/dashboard" "$TARGET/src/features/dashboard"
```

- [ ] **Step 3: Restore kept lib files**

```bash
mkdir -p "$TARGET/src/lib"
cp /tmp/llm-proxy-keep/* "$TARGET/src/lib/"
```

- [ ] **Step 4: Copy components.json from template**

```bash
cp "$TEMPLATE/components.json" "$TARGET/components.json"
```

- [ ] **Step 5: Write package.json**

```json
{
  "name": "llm-proxy-admin",
  "private": true,
  "version": "0.2.0",
  "type": "module",
  "scripts": {
    "dev": "node --max-http-header-size=32768 node_modules/vite/bin/vite.js",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "@radix-ui/react-accordion": "^1.2.12",
    "@radix-ui/react-avatar": "^1.1.11",
    "@radix-ui/react-checkbox": "^1.3.3",
    "@radix-ui/react-dialog": "^1.1.15",
    "@radix-ui/react-dropdown-menu": "^2.1.16",
    "@radix-ui/react-label": "^2.1.8",
    "@radix-ui/react-popover": "^1.1.15",
    "@radix-ui/react-radio-group": "^1.3.8",
    "@radix-ui/react-scroll-area": "^1.2.10",
    "@radix-ui/react-select": "^2.2.6",
    "@radix-ui/react-separator": "^1.1.8",
    "@radix-ui/react-slot": "^1.2.4",
    "@radix-ui/react-switch": "^1.2.6",
    "@radix-ui/react-tabs": "^1.1.13",
    "@radix-ui/react-tooltip": "^1.2.8",
    "@tanstack/react-form": "^1.28.6",
    "@tanstack/react-query": "^5.96.2",
    "@tanstack/react-router": "^1.168.10",
    "@tanstack/react-table": "^8.21.3",
    "class-variance-authority": "^0.7.1",
    "clsx": "^2.1.1",
    "cmdk": "^1.1.1",
    "lucide-react": "^1.7.0",
    "react": "^19.2.4",
    "react-dom": "^19.2.4",
    "recharts": "^3.8.1",
    "sonner": "^2.0.7",
    "tailwind-merge": "^3.5.0",
    "tw-animate-css": "^1.3.4",
    "zod": "^4.3.6",
    "zustand": "^5.0.12"
  },
  "devDependencies": {
    "@tailwindcss/vite": "^4.2.2",
    "@tanstack/router-plugin": "^1.167.12",
    "@types/node": "^25.5.2",
    "@types/react": "^19.2.14",
    "@types/react-dom": "^19.2.3",
    "@vitejs/plugin-react": "^6.0.1",
    "tailwindcss": "^4.2.2",
    "typescript": "~6.0.2",
    "vite": "^8.0.3"
  }
}
```

- [ ] **Step 6: Write vite.config.ts**

```typescript
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { tanstackRouter } from "@tanstack/router-plugin/vite"
import path from "node:path"

export default defineConfig({
  plugins: [
    tanstackRouter({
      routesDirectory: "./src/routes",
      generatedRouteTree: "./src/routeTree.gen.ts",
      autoCodeSplitting: true,
    }),
    react(),
    tailwindcss(),
  ],
  base: "/",
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 3838,
    host: "0.0.0.0",
    proxy: {
      "/api": {
        target: "http://localhost:4001",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
})
```

- [ ] **Step 7: Write tsconfig.json** (single flat config, no references file)

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["src"]
}
```

- [ ] **Step 8: Delete tsconfig.app.json** (no longer needed — single flat tsconfig.json)

```bash
rm -f "$TARGET/tsconfig.app.json"
```

- [ ] **Step 9: Install dependencies**

```bash
cd "$TARGET" && npm install
```

Expected: Clean install with no errors. `node_modules/` populated.

- [ ] **Step 10: Commit scaffold**

```bash
cd D:/Repositories/Personal/llm-proxy
git add web/
git commit -m "feat(web): scaffold template infrastructure

Replace web/src with darkraise-web-template core, features, and styles.
Merge dependencies for TanStack Router/Query/Form/Table, Zustand, Zod,
Sonner. Keep existing api.ts, known-models.ts, providers.ts, dateformat.ts."
```

---

## Task 2: Foundation — Theme config, auth, entry points, routing shell

**Files:**
- Modify: `web/src/core/theme/theme.config.ts`
- Create: `web/src/features/auth/store.ts`
- Create: `web/src/features/auth/hooks/use-auth.ts`
- Create: `web/src/features/auth/components/login-form.tsx`
- Create: `web/src/features/auth/components/auth-layout.tsx`
- Create: `web/src/features/auth/types.ts`
- Create: `web/src/features/auth/index.ts`
- Create: `web/src/main.tsx`
- Create: `web/src/app.tsx`
- Create: `web/src/routes/__root.tsx`
- Create: `web/src/routes/_authenticated.tsx`
- Create: `web/src/routes/_guest.tsx`
- Create: `web/src/routes/_guest/login.tsx`
- Create: `web/src/routes/_authenticated/index.tsx` (placeholder)

- [ ] **Step 1: Update theme.config.ts**

Replace the contents of `web/src/core/theme/theme.config.ts` with:

```typescript
import type {
  AccentColor,
  SurfaceColor,
  SurfaceStyle,
  BackgroundStyle,
  FontFamily,
  Mode,
} from "./types"

export interface ThemeConfig {
  defaults: {
    accentColor: AccentColor
    surfaceColor: SurfaceColor
    surfaceStyle: SurfaceStyle
    backgroundStyle: BackgroundStyle
    fontFamily: FontFamily
    mode: Mode
  }
  switcher: {
    enabled: boolean
    axes: {
      mode: boolean
      accentColor: boolean
      surfaceColor: boolean
      surfaceStyle: boolean
      backgroundStyle: boolean
      fontFamily: boolean
    }
  }
}

export const themeConfig: ThemeConfig = {
  defaults: {
    accentColor: "purple",
    surfaceColor: "purple",
    surfaceStyle: "default",
    backgroundStyle: "solid",
    fontFamily: "default",
    mode: "dark",
  },
  switcher: {
    enabled: true,
    axes: {
      mode: true,
      accentColor: true,
      surfaceColor: false,
      surfaceStyle: false,
      backgroundStyle: false,
      fontFamily: false,
    },
  },
}
```

- [ ] **Step 2: Create auth store**

Create `web/src/features/auth/store.ts`:

```typescript
import { create } from "zustand"

interface AuthState {
  isAuthenticated: boolean
  setAuth: () => void
  logout: () => void
}

export const useAuthStore = create<AuthState>((set) => ({
  isAuthenticated: false,
  setAuth: () => set({ isAuthenticated: true }),
  logout: () => set({ isAuthenticated: false }),
}))
```

- [ ] **Step 3: Create auth hook**

Create `web/src/features/auth/hooks/use-auth.ts`:

```typescript
import { useNavigate } from "@tanstack/react-router"
import { useAuthStore } from "../store"
import { api, ApiError } from "@/lib/api"

export function useAuth() {
  const { isAuthenticated, setAuth, logout: clearAuth } = useAuthStore()
  const navigate = useNavigate()

  const login = async (password: string) => {
    try {
      await api.auth.login(password)
      setAuth()
      await navigate({ to: "/" })
    } catch (err) {
      if (err instanceof ApiError) throw err
      throw new Error("Login failed")
    }
  }

  const logout = async () => {
    try {
      await api.auth.logout()
    } finally {
      clearAuth()
      await navigate({ to: "/login" })
    }
  }

  return { isAuthenticated, login, logout }
}
```

- [ ] **Step 4: Create auth types**

Create `web/src/features/auth/types.ts`:

```typescript
export interface LoginCredentials {
  password: string
}
```

- [ ] **Step 5: Create login form**

Create `web/src/features/auth/components/login-form.tsx`:

```tsx
import { useState } from "react"
import { Button } from "@/core/components/ui/button"
import { Input } from "@/core/components/ui/input"
import { Label } from "@/core/components/ui/label"
import { useAuth } from "../hooks/use-auth"
import { ApiError } from "@/lib/api"

export function LoginForm() {
  const { login } = useAuth()
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    setLoading(true)
    try {
      await login(password)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Login failed")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mx-auto flex w-full flex-col justify-center space-y-6 sm:w-[350px]">
      <div className="flex flex-col space-y-2 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">LLM Proxy</h1>
        <p className="text-sm text-muted-foreground">
          Enter your admin password to continue
        </p>
      </div>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            placeholder="Admin password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
            required
          />
        </div>
        {error && (
          <p className="text-sm text-destructive">{error}</p>
        )}
        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? "Signing in..." : "Sign in"}
        </Button>
      </form>
    </div>
  )
}
```

- [ ] **Step 6: Create auth layout**

Create `web/src/features/auth/components/auth-layout.tsx`:

```tsx
import { Outlet } from "@tanstack/react-router"

export function AuthLayout() {
  return (
    <div className="container relative flex min-h-svh flex-col items-center justify-center md:grid lg:max-w-none lg:grid-cols-2 lg:px-0">
      <div className="relative hidden h-full flex-col bg-muted p-10 text-white lg:flex dark:border-r">
        <div className="absolute inset-0 bg-primary/10" />
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse at 20% 50%, hsl(var(--primary) / 0.15), transparent 60%), radial-gradient(ellipse at 80% 20%, hsl(var(--primary) / 0.1), transparent 50%)",
          }}
        />
        <div className="relative z-20 flex items-center text-lg font-medium">
          LLM Proxy
        </div>
        <div className="relative z-20 mt-auto">
          <blockquote className="space-y-2">
            <p className="text-lg text-foreground/80">
              Multi-provider LLM gateway with rate limiting, automatic retries,
              and unified API.
            </p>
          </blockquote>
        </div>
      </div>
      <div className="flex h-full items-center p-4 lg:p-8">
        <Outlet />
      </div>
    </div>
  )
}
```

- [ ] **Step 7: Create auth barrel export**

Create `web/src/features/auth/index.ts`:

```typescript
export { useAuth } from "./hooks/use-auth"
export { useAuthStore } from "./store"
export { LoginForm } from "./components/login-form"
export { AuthLayout } from "./components/auth-layout"
export type { LoginCredentials } from "./types"
```

- [ ] **Step 8: Create main.tsx**

Create `web/src/main.tsx`:

```tsx
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "./styles/globals.css"
import { App } from "./app"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

- [ ] **Step 9: Create app.tsx**

Create `web/src/app.tsx`:

```tsx
import { createRouter, RouterProvider } from "@tanstack/react-router"
import { routeTree } from "./routeTree.gen"

const router = createRouter({ routeTree })

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router
  }
}

export function App() {
  return <RouterProvider router={router} />
}
```

- [ ] **Step 10: Create __root.tsx**

Create `web/src/routes/__root.tsx`:

```tsx
import { createRootRoute, Outlet } from "@tanstack/react-router"
import { AppProviders } from "@/core/providers/app-providers"

export const Route = createRootRoute({
  component: () => (
    <AppProviders>
      <Outlet />
    </AppProviders>
  ),
})
```

- [ ] **Step 11: Create _authenticated.tsx**

Create `web/src/routes/_authenticated.tsx`:

```tsx
import { createFileRoute, Outlet, redirect } from "@tanstack/react-router"
import { SidebarLayout } from "@/core/layout/sidebar-layout"
import { useAuthStore } from "@/features/auth"
import { api } from "@/lib/api"
import type { NavGroup } from "@/core/layout/types"
import {
  LayoutDashboard,
  Users,
  Blocks,
  Gauge,
  ScrollText,
  KeyRound,
  ScanSearch,
  Settings,
} from "lucide-react"

const nav: NavGroup[] = [
  {
    label: "Overview",
    items: [
      { label: "Dashboard", href: "/", icon: LayoutDashboard },
    ],
  },
  {
    label: "Management",
    items: [
      { label: "Accounts", href: "/accounts", icon: Users },
      { label: "Providers", href: "/providers", icon: Blocks },
      { label: "Rate Limits", href: "/rate-limits", icon: Gauge },
    ],
  },
  {
    label: "Monitoring",
    items: [
      { label: "Usage Logs", href: "/logs", icon: ScrollText },
    ],
  },
  {
    label: "Tools",
    items: [
      { label: "Keys Test", href: "/keys-test", icon: KeyRound },
      { label: "Scanner", href: "/scanner", icon: ScanSearch },
    ],
  },
  {
    label: "System",
    items: [
      { label: "Settings", href: "/settings", icon: Settings },
    ],
  },
]

export const Route = createFileRoute("/_authenticated")({
  beforeLoad: async () => {
    if (!useAuthStore.getState().isAuthenticated) {
      try {
        await api.settings.get()
        useAuthStore.getState().setAuth()
      } catch {
        throw redirect({ to: "/login" })
      }
    }
  },
  component: () => (
    <SidebarLayout nav={nav}>
      <Outlet />
    </SidebarLayout>
  ),
})
```

- [ ] **Step 12: Modify UserMenu to wire up logout**

The template's `UserMenu` accepts an optional `onLogout` prop but the `LayoutHeader` renders it without passing one. For llm-proxy, modify `web/src/core/layout/user-menu.tsx` to import `useAuth` and call logout directly. Also simplify for single-admin (remove Profile link, remove user name/email display):

```tsx
import { LogOut, Settings } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/core/components/ui/dropdown-menu"
import { Avatar, AvatarFallback } from "@/core/components/ui/avatar"
import { Button } from "@/core/components/ui/button"
import { useAuth } from "@/features/auth"
import { Link } from "@tanstack/react-router"

export function UserMenu() {
  const { logout } = useAuth()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="relative h-8 w-8 rounded-full">
          <Avatar className="h-8 w-8">
            <AvatarFallback>A</AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56" align="end" forceMount>
        <DropdownMenuItem asChild>
          <Link to="/settings">
            <Settings className="mr-2 h-4 w-4" />
            Settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={logout}>
          <LogOut className="mr-2 h-4 w-4" />
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
```

Also remove the `NotificationBell` import from `layout-header.tsx` (not needed for single-admin). In `web/src/core/layout/layout-header.tsx`, remove the `<NotificationBell />` line and its import.

- [ ] **Step 13: Create _guest.tsx**

Create `web/src/routes/_guest.tsx`:

```tsx
import { createFileRoute, redirect } from "@tanstack/react-router"
import { AuthLayout } from "@/features/auth"
import { useAuthStore } from "@/features/auth"

export const Route = createFileRoute("/_guest")({
  beforeLoad: () => {
    if (useAuthStore.getState().isAuthenticated) {
      throw redirect({ to: "/" })
    }
  },
  component: AuthLayout,
})
```

- [ ] **Step 14: Create login route**

Create `web/src/routes/_guest/login.tsx`:

```tsx
import { createFileRoute } from "@tanstack/react-router"
import { LoginForm } from "@/features/auth"

export const Route = createFileRoute("/_guest/login")({
  component: LoginForm,
})
```

- [ ] **Step 15: Create placeholder dashboard route**

Create `web/src/routes/_authenticated/index.tsx`:

```tsx
import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/_authenticated/")({
  component: DashboardPage,
})

function DashboardPage() {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold">Dashboard</h1>
      <p className="text-muted-foreground">Coming soon...</p>
    </div>
  )
}
```

- [ ] **Step 16: Create empty route placeholders for remaining pages**

Create these files with minimal placeholder content so TanStack Router generates the full route tree. Each file follows this pattern:

`web/src/routes/_authenticated/accounts.tsx`:
```tsx
import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/_authenticated/accounts")({
  component: () => <div className="p-6"><h1 className="text-2xl font-semibold">Accounts</h1></div>,
})
```

Create the same pattern for:
- `web/src/routes/_authenticated/providers.tsx` (path: `/_authenticated/providers`)
- `web/src/routes/_authenticated/rate-limits.tsx` (path: `/_authenticated/rate-limits`)
- `web/src/routes/_authenticated/logs.tsx` (path: `/_authenticated/logs`)
- `web/src/routes/_authenticated/keys-test.tsx` (path: `/_authenticated/keys-test`)
- `web/src/routes/_authenticated/scanner.tsx` (path: `/_authenticated/scanner`)
- `web/src/routes/_authenticated/settings.tsx` (path: `/_authenticated/settings`)

- [ ] **Step 17: Update api.ts 401 handler to also clear Zustand**

In `web/src/lib/api.ts`, update the 401 handling block to also clear the Zustand auth state:

```typescript
// At the top of the file, add import:
import { useAuthStore } from "@/features/auth/store"

// In the request() function, replace the 401 block:
  if (res.status === 401) {
    useAuthStore.getState().logout()
    window.location.href = '/login'
    throw new ApiError(401, 'Unauthorized')
  }
```

- [ ] **Step 18: Verify the dev server starts**

```bash
cd D:/Repositories/Personal/llm-proxy/web && npm run dev
```

Expected: Vite starts on port 3838, TanStack Router generates `routeTree.gen.ts`, no compilation errors. Visit `http://localhost:3838/login` to see the login form.

- [ ] **Step 19: Commit foundation**

```bash
cd D:/Repositories/Personal/llm-proxy
git add web/
git commit -m "feat(web): add routing, auth, and theme foundation

TanStack Router with file-based routes, Zustand auth store for
session cookie auth, purple theme defaults with simplified switcher,
login page, and placeholder routes for all 8 pages."
```

---

## Task 3: Data Layer — React Query hooks

**Files:**
- Create: `web/src/hooks/use-accounts.ts`
- Create: `web/src/hooks/use-providers.ts`
- Create: `web/src/hooks/use-ratelimits.ts`
- Create: `web/src/hooks/use-stats.ts`
- Create: `web/src/hooks/use-settings.ts`
- Create: `web/src/hooks/use-logs.ts`
- Create: `web/src/hooks/use-scanner.ts`
- Create: `web/src/hooks/use-ollama.ts`

- [ ] **Step 1: Create use-accounts.ts**

```typescript
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { api, type AccountInput, type BulkEditPayload } from "@/lib/api"

export function useAccounts() {
  return useQuery({
    queryKey: ["accounts"],
    queryFn: () => api.accounts.list(),
  })
}

export function useCreateAccount() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: AccountInput) => api.accounts.create(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["accounts"] }),
  })
}

export function useUpdateAccount() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: AccountInput }) =>
      api.accounts.update(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["accounts"] }),
  })
}

export function useDeleteAccount() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.accounts.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["accounts"] }),
  })
}

export function useBulkUpdateAccounts() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ ids, enabled }: { ids: number[]; enabled: boolean }) =>
      api.accounts.bulkUpdate(ids, enabled),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["accounts"] }),
  })
}

export function useBulkDeleteAccounts() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (ids: number[]) => api.accounts.bulkDelete(ids),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["accounts"] }),
  })
}

export function useBulkEditAccounts() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: BulkEditPayload) => api.accounts.bulkEdit(payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["accounts"] }),
  })
}

export function useTestAccount() {
  return useMutation({
    mutationFn: (id: number) => api.accounts.test(id),
  })
}

export function useDiscoverAccountModels() {
  return useMutation({
    mutationFn: (data: { type: string; base_url: string; api_key: string; free_only: boolean }) =>
      api.accounts.discover(data),
  })
}

export function useDiscoverAccountModelsById() {
  return useMutation({
    mutationFn: (id: number) => api.accounts.discoverByAccount(id),
  })
}

export function useGetAccountKey() {
  return useMutation({
    mutationFn: (id: number) => api.accounts.getKey(id),
  })
}

export function useChatTestAccount() {
  return useMutation({
    mutationFn: ({ id, model, message }: { id: number; model: string; message: string }) =>
      api.accounts.chatTest(id, model, message),
  })
}
```

- [ ] **Step 2: Create use-providers.ts**

```typescript
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { api, type ProviderInput } from "@/lib/api"

export function useProviders() {
  return useQuery({
    queryKey: ["providers"],
    queryFn: () => api.providers.list(),
  })
}

export function useProvider(name: string) {
  return useQuery({
    queryKey: ["providers", name],
    queryFn: () => api.providers.get(name),
    enabled: !!name,
  })
}

export function useCreateProvider() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: ProviderInput) => api.providers.create(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["providers"] }),
  })
}

export function useUpdateProvider() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ name, data }: { name: string; data: Partial<ProviderInput> }) =>
      api.providers.update(name, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["providers"] }),
  })
}

export function useDeleteProvider() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (name: string) => api.providers.delete(name),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["providers"] }),
  })
}
```

- [ ] **Step 3: Create use-ratelimits.ts**

```typescript
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { api, type RateLimitDef } from "@/lib/api"

export function useRateLimits(provider: string) {
  return useQuery({
    queryKey: ["ratelimits", provider],
    queryFn: () => api.ratelimits.list(provider),
    enabled: !!provider,
  })
}

export function useRateLimitDefaults(provider: string) {
  return useQuery({
    queryKey: ["ratelimits", provider, "defaults"],
    queryFn: () => api.ratelimits.defaults(provider),
    enabled: !!provider,
  })
}

export function useProviderMetrics(provider: string) {
  return useQuery({
    queryKey: ["provider-metrics", provider],
    queryFn: () => api.ratelimits.metrics(provider),
    enabled: !!provider,
  })
}

export function useSetRateLimit() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (def: Omit<RateLimitDef, "id">) => api.ratelimits.set(def),
    onSuccess: (_data, variables) =>
      qc.invalidateQueries({ queryKey: ["ratelimits", variables.provider] }),
  })
}

export function useDeleteRateLimit() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.ratelimits.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ratelimits"] }),
  })
}

export function useSetProviderMetrics() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ provider, metrics }: { provider: string; metrics: string[] }) =>
      api.ratelimits.setMetrics(provider, metrics),
    onSuccess: (_data, variables) =>
      qc.invalidateQueries({ queryKey: ["provider-metrics", variables.provider] }),
  })
}
```

- [ ] **Step 4: Create use-stats.ts**

```typescript
import { useQuery } from "@tanstack/react-query"
import { api } from "@/lib/api"

export function useStatsOverview(from?: string, to?: string) {
  return useQuery({
    queryKey: ["stats", "overview", from, to],
    queryFn: () => api.stats.overview(from, to),
  })
}

export function useStatsRequests(params?: Parameters<typeof api.stats.requests>[0]) {
  return useQuery({
    queryKey: ["stats", "requests", params],
    queryFn: () => api.stats.requests(params),
  })
}

export function useStatsAccounts(from?: string, to?: string) {
  return useQuery({
    queryKey: ["stats", "accounts", from, to],
    queryFn: () => api.stats.accounts(from, to),
  })
}

export function useStatsProviders(from?: string, to?: string) {
  return useQuery({
    queryKey: ["stats", "providers", from, to],
    queryFn: () => api.stats.providers(from, to),
  })
}

export function useStatsModels(provider?: string, from?: string, to?: string) {
  return useQuery({
    queryKey: ["stats", "models", provider, from, to],
    queryFn: () => api.stats.models(provider, from, to),
  })
}
```

- [ ] **Step 5: Create use-settings.ts**

```typescript
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api"

export function useSettings() {
  return useQuery({
    queryKey: ["settings"],
    queryFn: () => api.settings.get(),
  })
}

export function useUpdateSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: Record<string, string>) => api.settings.update(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["settings"] }),
  })
}

export function useTestNotification() {
  return useMutation({
    mutationFn: () => api.notifications.test(),
  })
}
```

- [ ] **Step 6: Create use-logs.ts**

```typescript
import { useQuery } from "@tanstack/react-query"
import { api } from "@/lib/api"

export interface LogFilters {
  account?: string
  status?: string
  model?: string
  from?: string
  to?: string
  min_latency?: number
  limit?: number
  offset?: number
}

export function useLogs(filters: LogFilters) {
  return useQuery({
    queryKey: ["logs", filters],
    queryFn: () => api.stats.requests(filters),
  })
}
```

- [ ] **Step 7: Create use-scanner.ts**

```typescript
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { api, type AccountLimit, type ScanKeyPattern } from "@/lib/api"

export function useScannerStatus() {
  return useQuery({
    queryKey: ["scanner", "status"],
    queryFn: () => api.scanner.status(),
    refetchInterval: (query) =>
      query.state.data?.status.running ? 2000 : false,
  })
}

export function useScannerKeys(params?: Parameters<typeof api.scanner.keys>[0]) {
  return useQuery({
    queryKey: ["scanner", "keys", params],
    queryFn: () => api.scanner.keys(params),
  })
}

export function useScannerHistory(limit?: number) {
  return useQuery({
    queryKey: ["scanner", "history", limit],
    queryFn: () => api.scanner.history(limit),
  })
}

export function useScannerConfig() {
  return useQuery({
    queryKey: ["scanner", "config"],
    queryFn: () => api.scanner.config(),
  })
}

export function useScannerPatterns(provider?: string) {
  return useQuery({
    queryKey: ["scanner", "patterns", provider],
    queryFn: () => api.scanner.patterns(provider),
  })
}

export function useScannerStart() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (source?: string) => api.scanner.start(source),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["scanner"] }),
  })
}

export function useScannerStop() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.scanner.stop(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["scanner"] }),
  })
}

export function useValidateScannerKey() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.scanner.validateKey(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["scanner", "keys"] }),
  })
}

export function useDiscoverScannerModels() {
  return useMutation({
    mutationFn: (id: number) => api.scanner.discoverModels(id),
  })
}

export function useImportScannerKey() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, models, name }: { id: number; models: Record<string, string[]>; name?: string }) =>
      api.scanner.importKey(id, models, name),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["scanner", "keys"] })
      qc.invalidateQueries({ queryKey: ["accounts"] })
    },
  })
}

export function useBulkImportScannerKeys() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ ids, models, limits }: { ids: number[]; models: Record<string, string[]>; limits?: AccountLimit[] }) =>
      api.scanner.bulkImport(ids, models, limits),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["scanner", "keys"] })
      qc.invalidateQueries({ queryKey: ["accounts"] })
    },
  })
}

export function useDeleteScannerKey() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.scanner.deleteKey(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["scanner", "keys"] }),
  })
}

export function useBulkDeleteScannerKeys() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (ids: number[]) => api.scanner.bulkDelete(ids),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["scanner", "keys"] }),
  })
}

export function useUpdateScannerConfig() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: { github_token?: string; delay_seconds?: number; max_pages?: number }) =>
      api.scanner.updateConfig(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["scanner", "config"] }),
  })
}

export function useUpsertScannerPattern() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (pattern: Omit<ScanKeyPattern, "id"> & { id?: number }) =>
      api.scanner.upsertPattern(pattern),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["scanner", "patterns"] }),
  })
}

export function useDeleteScannerPattern() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.scanner.deletePattern(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["scanner", "patterns"] }),
  })
}
```

- [ ] **Step 8: Create use-ollama.ts**

```typescript
import { useMutation } from "@tanstack/react-query"
import { api } from "@/lib/api"

export function useOllamaDiscover() {
  return useMutation({
    mutationFn: (url: string) => api.ollama.discover(url),
  })
}
```

- [ ] **Step 9: Verify TypeScript compiles**

```bash
cd D:/Repositories/Personal/llm-proxy/web && npx tsc --noEmit
```

Expected: No type errors.

- [ ] **Step 10: Commit data layer**

```bash
cd D:/Repositories/Personal/llm-proxy
git add web/src/hooks/
git commit -m "feat(web): add React Query hooks for all API namespaces

Wrap every api.ts endpoint with TanStack React Query hooks:
accounts, providers, ratelimits, stats, settings, logs, scanner, ollama.
Mutations auto-invalidate related queries on success."
```

---

## Task 4: Login Page — Complete and verify

This task finalizes the login page (most code was created in Task 2).

**Files:**
- Verify: `web/src/features/auth/components/login-form.tsx` (created in Task 2)
- Verify: `web/src/features/auth/components/auth-layout.tsx` (created in Task 2)
- Verify: `web/src/routes/_guest/login.tsx` (created in Task 2)

- [ ] **Step 1: Start both backend and frontend dev servers**

```bash
cd D:/Repositories/Personal/llm-proxy && ./start-dev-backend.sh &
cd D:/Repositories/Personal/llm-proxy/web && npm run dev
```

- [ ] **Step 2: Test login flow**

Navigate to `http://localhost:3838/login`. Verify:
1. Login form renders with password field
2. Entering wrong password shows error message
3. Entering correct password redirects to dashboard
4. Navigating to `/` when not logged in redirects to `/login`
5. After login, navigating to `/login` redirects to `/`

Fix any issues found during testing.

- [ ] **Step 3: Commit if any fixes were needed**

```bash
cd D:/Repositories/Personal/llm-proxy
git add web/
git commit -m "fix(web): polish login flow"
```

---

## Task 5: Dashboard Page

**Files:**
- Modify: `web/src/routes/_authenticated/index.tsx`
- Create: `web/src/components/breakdown-tabs.tsx`

- [ ] **Step 1: Create breakdown-tabs component**

Create `web/src/components/breakdown-tabs.tsx`:

```tsx
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/core/components/ui/tabs"

interface BreakdownItem {
  label: string
  value: number
  total: number
}

interface BreakdownTabsProps {
  providers: BreakdownItem[]
  accounts: BreakdownItem[]
  models: BreakdownItem[]
}

function BreakdownList({ items }: { items: BreakdownItem[] }) {
  if (items.length === 0) {
    return <p className="py-4 text-center text-sm text-muted-foreground">No data</p>
  }
  const max = Math.max(...items.map((i) => i.value), 1)
  return (
    <div className="space-y-3">
      {items.map((item) => (
        <div key={item.label} className="space-y-1">
          <div className="flex items-center justify-between text-sm">
            <span className="truncate font-medium">{item.label}</span>
            <span className="text-muted-foreground">
              {item.value.toLocaleString()} requests
            </span>
          </div>
          <div className="h-2 w-full rounded-full bg-muted">
            <div
              className="h-2 rounded-full bg-primary"
              style={{ width: `${(item.value / max) * 100}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  )
}

export function BreakdownTabs({ providers, accounts, models }: BreakdownTabsProps) {
  return (
    <Tabs defaultValue="providers">
      <TabsList>
        <TabsTrigger value="providers">By Provider</TabsTrigger>
        <TabsTrigger value="accounts">By Account</TabsTrigger>
        <TabsTrigger value="models">By Model</TabsTrigger>
      </TabsList>
      <TabsContent value="providers">
        <BreakdownList items={providers} />
      </TabsContent>
      <TabsContent value="accounts">
        <BreakdownList items={accounts} />
      </TabsContent>
      <TabsContent value="models">
        <BreakdownList items={models} />
      </TabsContent>
    </Tabs>
  )
}
```

- [ ] **Step 2: Build the dashboard page**

Replace `web/src/routes/_authenticated/index.tsx` with the full dashboard implementation. This page uses:
- `PageHeader` from `@/core/layout/page-header`
- `StatCard` from `@/features/dashboard`
- `ChartCard`, `BarChart` from `@/features/charts`
- `BreakdownTabs` from `@/components/breakdown-tabs`
- `Select` from `@/core/components/ui/select`
- `Switch` from `@/core/components/ui/switch`
- Hooks: `useStatsOverview`, `useStatsRequests`, `useStatsProviders`, `useStatsAccounts`, `useStatsModels` from `@/hooks/use-stats`

The page should include:
- Date range selector (1h, 24h, 7d, 30d, 365d) computing `from`/`to` timestamps
- Auto-refresh toggle (when on, set `refetchInterval: 10000` on queries)
- 4 stat cards in a responsive grid
- Bar chart of request volume with provider stacking
- Breakdown tabs at the bottom

Build this as a self-contained page component. Reference the current `web/src/pages/Dashboard.tsx` (in git history) for the exact data transformations and chart configuration.

- [ ] **Step 3: Verify dashboard renders**

Start dev server, log in, verify dashboard shows stats and chart. If backend is not running, verify it renders loading states without crashing.

- [ ] **Step 4: Commit**

```bash
cd D:/Repositories/Personal/llm-proxy
git add web/src/routes/_authenticated/index.tsx web/src/components/breakdown-tabs.tsx
git commit -m "feat(web): implement dashboard page

Stats cards, request volume bar chart, and breakdown tabs by
provider/account/model. Date range selector and auto-refresh toggle."
```

---

## Task 6: Accounts Page

This is the largest and most complex page. Build it incrementally.

**Files:**
- Modify: `web/src/routes/_authenticated/accounts.tsx`
- Create: `web/src/components/account-card.tsx`
- Create: `web/src/components/account-drawer.tsx`
- Create: `web/src/components/add-models-dialog.tsx`
- Create: `web/src/components/bulk-edit-modal.tsx`
- Create: `web/src/components/model-picker-dialog.tsx`
- Create: `web/src/components/confirm-dialog.tsx`

- [ ] **Step 1: Create confirm-dialog component**

Create `web/src/components/confirm-dialog.tsx`:

```tsx
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/core/components/ui/dialog"
import { Button } from "@/core/components/ui/button"

interface ConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  confirmLabel?: string
  variant?: "default" | "destructive"
  onConfirm: () => void
  loading?: boolean
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  variant = "default",
  onConfirm,
  loading,
}: ConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant={variant} onClick={onConfirm} disabled={loading}>
            {loading ? "..." : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 2: Create account-card component**

Create `web/src/components/account-card.tsx`. This card displays:
- Provider badge (colored by provider type)
- Account name
- Model count
- Status dot (green/red/yellow based on account.status)
- Enabled toggle (Switch)
- Selection checkbox
- Click handler to open drawer

Use `Card` from `@/core/components/ui/card`, `Badge` from `@/core/components/ui/badge`, `Switch` from `@/core/components/ui/switch`, `Checkbox` from `@/core/components/ui/checkbox`.

Reference the current `web/src/components/AccountCard.tsx` for the data transformations (parsing models JSON, status display logic).

- [ ] **Step 3: Create add-models-dialog component**

Create `web/src/components/add-models-dialog.tsx`. This dialog:
- Shows discovered models categorized into chat/embedding sections
- Allows selecting/deselecting models
- Has a search filter
- Uses `Dialog` from `@/core/components/ui/dialog`, `Checkbox`, `Input`
- Uses `categorizeModels` from `@/lib/known-models`

- [ ] **Step 4: Create account-drawer component**

Create `web/src/components/account-drawer.tsx`. This is a Sheet containing:
- TanStack Form with fields: provider (Select), name (Input), API key (Input), base URL (Input), models section (with AddModelsDialog), enabled toggle
- Save and delete buttons
- Model discovery button
- Uses `Sheet` from `@/core/components/ui/sheet`
- Uses hooks: `useUpdateAccount`, `useDeleteAccount`, `useDiscoverAccountModelsById`, `useGetAccountKey`

Reference the current `web/src/components/AccountDrawer.tsx` for field layout and provider-specific URL logic.

- [ ] **Step 5: Create bulk-edit-modal component**

Create `web/src/components/bulk-edit-modal.tsx`. Dialog for editing multiple accounts:
- Model picker (what models to set)
- Default model picker
- Rate limits editor
- Uses `Dialog`, `ModelPickerDialog`

- [ ] **Step 6: Create model-picker-dialog component**

Create `web/src/components/model-picker-dialog.tsx`. Dialog for selecting chat and embedding default models:
- Two-step picker: first chat default, then embedding default
- Search across available models
- Uses `Dialog`, `Input`, `Button`

- [ ] **Step 7: Build the accounts page**

Replace `web/src/routes/_authenticated/accounts.tsx` with the full implementation:
- `PageHeader` with Add button, bulk actions dropdown, view toggle
- Toolbar with provider filter, status filter, search
- Grid view with AccountCard in responsive grid
- List view with DataTable
- AccountDrawer for editing
- BulkEditModal for bulk operations
- ConfirmDialog for delete confirmations
- Uses hooks: `useAccounts`, `useCreateAccount`, `useBulkUpdateAccounts`, `useBulkDeleteAccounts`, `useBulkEditAccounts`

Reference the current `web/src/pages/Accounts.tsx` for the full feature set and data flow.

- [ ] **Step 8: Verify accounts page works**

Test: list accounts, create account, edit account, delete account, bulk enable/disable, grid/list view toggle, search/filter.

- [ ] **Step 9: Commit**

```bash
cd D:/Repositories/Personal/llm-proxy
git add web/src/routes/_authenticated/accounts.tsx web/src/components/
git commit -m "feat(web): implement accounts page

Account CRUD with grid/list views, account drawer editor, model
discovery, bulk operations, and search/filter toolbar."
```

---

## Task 7: Providers Page

**Files:**
- Modify: `web/src/routes/_authenticated/providers.tsx`

- [ ] **Step 1: Build the providers page**

Replace `web/src/routes/_authenticated/providers.tsx` with the full implementation:
- `PageHeader` with "Add Custom" button
- Filter tabs: All / Built-in / Custom
- Card grid showing each provider with display name, type badge, base URL, capabilities, enabled toggle
- Edit Sheet with form: name, display_name, base_url, models_url, api_standard (Select), auth_type (Select), auth_header, capabilities checkboxes, validation steps, enabled toggle
- Delete confirmation for custom providers
- Uses hooks: `useProviders`, `useCreateProvider`, `useUpdateProvider`, `useDeleteProvider`
- Uses: `PageHeader`, `Card`, `Badge`, `Switch`, `Sheet`, `Select`, `Input`, `Checkbox`, `Button`, `Tabs`, `ConfirmDialog`

Reference the current `web/src/pages/Providers.tsx` for the form fields and validation step handling.

- [ ] **Step 2: Verify providers page**

Test: view providers, toggle enabled, create custom provider, edit provider, delete custom provider.

- [ ] **Step 3: Commit**

```bash
cd D:/Repositories/Personal/llm-proxy
git add web/src/routes/_authenticated/providers.tsx
git commit -m "feat(web): implement providers page

Provider listing with filter tabs, enable/disable toggle, custom
provider CRUD with edit sheet."
```

---

## Task 8: Rate Limits Page

**Files:**
- Modify: `web/src/routes/_authenticated/rate-limits.tsx`
- Create: `web/src/components/rate-limit-table.tsx`

- [ ] **Step 1: Create rate-limit-table component**

Create `web/src/components/rate-limit-table.tsx`. An inline-editable table:
- Columns: model (or "default"), metric (Select: rpm/rpd/tpm/tpd), max_value (Input number), window_secs (Input number), actions (delete button)
- Add row button
- Save button that calls `useSetRateLimit` for each changed row
- Uses `Table` components from `@/core/components/ui/table`, `Select`, `Input`, `Button`

Reference the current `web/src/components/RateLimitTable.tsx` for the editing UX.

- [ ] **Step 2: Build the rate limits page**

Replace `web/src/routes/_authenticated/rate-limits.tsx`:
- `PageHeader`
- Provider Tabs (one per provider that has accounts — derived from `useProviders`)
- RateLimitTable per tab
- Uses hooks: `useRateLimits`, `useSetRateLimit`, `useDeleteRateLimit`, `useProviders`

Reference the current `web/src/pages/RateLimits.tsx`.

- [ ] **Step 3: Verify rate limits page**

Test: switch providers, view limits, add limit, edit limit, delete limit.

- [ ] **Step 4: Commit**

```bash
cd D:/Repositories/Personal/llm-proxy
git add web/src/routes/_authenticated/rate-limits.tsx web/src/components/rate-limit-table.tsx
git commit -m "feat(web): implement rate limits page

Provider-tabbed rate limit management with inline-editable table."
```

---

## Task 9: Usage Logs Page

**Files:**
- Modify: `web/src/routes/_authenticated/logs.tsx`
- Create: `web/src/components/log-drawer.tsx`

- [ ] **Step 1: Create log-drawer component**

Create `web/src/components/log-drawer.tsx`. A Sheet showing detailed request log info:
- Timestamp, account, provider, model, endpoint
- Status with badge (success/error)
- Latency, tokens (prompt/completion)
- Error message if present
- Uses `Sheet` from `@/core/components/ui/sheet`, `Badge`, `Separator`

- [ ] **Step 2: Build the usage logs page**

Replace `web/src/routes/_authenticated/logs.tsx`:
- `PageHeader`
- Toolbar with filters: account Select, model Select, status Select, date range, min latency Input
- DataTable with columns: timestamp, account, model, endpoint, status badge, latency, tokens
- Row click opens LogDrawer
- Pagination with page size selector (25/50/100)
- Uses hooks: `useLogs` from `@/hooks/use-logs`, `useAccounts` (for filter dropdown)
- Uses: `DataTable` from `@/features/data-table`, `Select`, `Input`, `Button`, `Badge`

Use `formatDateTime` from `@/lib/dateformat` for timestamp display.

Reference the current `web/src/pages/UsageLogs.tsx`.

- [ ] **Step 3: Verify logs page**

Test: view logs, filter by status, paginate, click row to see detail drawer.

- [ ] **Step 4: Commit**

```bash
cd D:/Repositories/Personal/llm-proxy
git add web/src/routes/_authenticated/logs.tsx web/src/components/log-drawer.tsx
git commit -m "feat(web): implement usage logs page

Log viewer with filter toolbar, data table, pagination, and detail drawer."
```

---

## Task 10: Keys Test Page

**Files:**
- Modify: `web/src/routes/_authenticated/keys-test.tsx`

- [ ] **Step 1: Build the keys test page**

Replace `web/src/routes/_authenticated/keys-test.tsx`:
- `PageHeader`
- Top section: provider Select, API key Input, "Discover Models" Button
- Results panel: list of discovered models categorized (chat/embedding), rate limit headers display
- Chat test section: model Select (populated from discovered models), message Textarea, send Button
- Response display: latency, token counts, response content
- Uses mutations: `api.keys.test()`, `api.keys.chatTest()` (via inline useMutation or dedicated hooks)
- Uses: `PageHeader`, `Select`, `Input`, `Textarea`, `Button`, `Card`, `Badge`, `Separator`
- Uses: `categorizeModels` from `@/lib/known-models`

Reference the current `web/src/pages/KeysTest.tsx` for the discovery and chat test flow.

- [ ] **Step 2: Verify keys test page**

Test: select provider, enter key, discover models, run chat test.

- [ ] **Step 3: Commit**

```bash
cd D:/Repositories/Personal/llm-proxy
git add web/src/routes/_authenticated/keys-test.tsx
git commit -m "feat(web): implement keys test page

API key testing with model discovery, rate limit header display,
and interactive chat testing."
```

---

## Task 11: Scanner Page

**Files:**
- Modify: `web/src/routes/_authenticated/scanner.tsx`

- [ ] **Step 1: Build the scanner page**

Replace `web/src/routes/_authenticated/scanner.tsx`:
- `PageHeader` with Start/Stop Button and scanner status indicator
- Three Tabs: Keys, History, Patterns
- **Keys tab**: DataTable of discovered keys — columns: provider Badge, masked key, source, valid status, imported status, actions (validate, discover models, import, delete). Bulk import and bulk delete for selected rows.
- **History tab**: DataTable of scan runs — columns: timestamp, source, status Badge, keys found/new/valid, duration, error
- **Patterns tab**: editable list per provider — prefix, regex, search_term, enabled toggle, add/delete
- Scanner config section: GitHub token Input (masked), delay NumberField, max pages NumberField
- Uses hooks from `@/hooks/use-scanner`: `useScannerStatus`, `useScannerKeys`, `useScannerHistory`, `useScannerConfig`, `useScannerPatterns`, `useScannerStart`, `useScannerStop`, etc.
- Uses: `PageHeader`, `Tabs`, `DataTable`, `Card`, `Input`, `Button`, `Badge`, `Switch`, `Select`, `ConfirmDialog`

Reference the current `web/src/pages/Scanner.tsx` for the full feature set.

- [ ] **Step 2: Verify scanner page**

Test: view scanner status, start/stop scan (if GitHub token configured), view keys, view history, manage patterns.

- [ ] **Step 3: Commit**

```bash
cd D:/Repositories/Personal/llm-proxy
git add web/src/routes/_authenticated/scanner.tsx
git commit -m "feat(web): implement scanner page

Key scanner with discovered keys table, scan history, pattern
management, and scanner configuration."
```

---

## Task 12: Settings Page

**Files:**
- Modify: `web/src/routes/_authenticated/settings.tsx`

- [ ] **Step 1: Build the settings page**

Replace `web/src/routes/_authenticated/settings.tsx`:
- `PageHeader`
- **General section** (`FormSection`): request_timeout NumberField, max_retries NumberField, log_retention_days NumberField, datetime_format SelectField (using `DATE_FORMAT_PRESETS` from `@/lib/dateformat`). Save button.
- **Notifications section** (`FormSection`): Test notification Button with result display.
- **Ollama section** (`FormSection`): ollama_auto_discover SwitchField, ollama_url TextField. Save button.
- **Import/Export section** (`FormSection`):
  - Config import: file upload textarea + import Button (calls `api.config.import`)
  - Config export: download Button (links to `api.config.exportUrl()`)
  - Settings import: file upload textarea + import Button (calls `api.settingsConfig.import`)
  - Settings export: download Button (links to `api.settingsConfig.exportUrl()`)
- Uses hooks: `useSettings`, `useUpdateSettings`, `useTestNotification`
- Uses: `PageHeader`, `FormSection`, `Card`, `Button`, `Input`, `Select`, `Switch`, `Textarea`, `Separator`

Reference the current `web/src/pages/Settings.tsx` for the section layout and save logic.

- [ ] **Step 2: Verify settings page**

Test: view settings, change a value, save, verify persistence. Test import/export buttons.

- [ ] **Step 3: Commit**

```bash
cd D:/Repositories/Personal/llm-proxy
git add web/src/routes/_authenticated/settings.tsx
git commit -m "feat(web): implement settings page

General, notifications, Ollama, and import/export settings sections
with independent save actions."
```

---

## Task 13: Final Verification — Production build and integration

**Files:**
- None created (verification only)

- [ ] **Step 1: Run TypeScript type check**

```bash
cd D:/Repositories/Personal/llm-proxy/web && npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 2: Run production build**

```bash
cd D:/Repositories/Personal/llm-proxy/web && npm run build
```

Expected: Build succeeds, output in `web/dist/`. Verify `dist/index.html` exists.

- [ ] **Step 3: Test with Go binary**

```bash
cd D:/Repositories/Personal/llm-proxy && go build ./cmd/llm-proxy
```

Expected: Go binary builds successfully, embedding `web/dist/` via `go:embed`.

- [ ] **Step 4: Run the full binary and test**

Start the binary and verify:
1. Admin UI loads at `:4001`
2. Login works
3. All 8 pages render and function
4. Theme switcher works (dark/light + accent colors)
5. Sidebar navigation works on desktop and mobile
6. API proxy works (proxy server on `:4000` handles requests)

- [ ] **Step 5: Run Go tests**

```bash
cd D:/Repositories/Personal/llm-proxy && go test ./...
```

Expected: All tests pass (frontend changes shouldn't affect backend tests).

- [ ] **Step 6: Final commit if any fixes needed**

```bash
cd D:/Repositories/Personal/llm-proxy
git add -A
git commit -m "fix(web): final polish for production build"
```

- [ ] **Step 7: Clean up template demo files**

Remove any template files that were copied but aren't needed:
- `src/features/dashboard/components/activity-feed.tsx` (if not used)
- `src/features/dashboard/components/kpi-card.tsx` (if not used)
- `src/features/dashboard/components/metric-grid.tsx` (if not used)
- `src/features/dashboard/components/progress-card.tsx` (if not used)
- `src/features/data-table/export-csv.ts` (if not used)
- Any unused UI components in `src/core/components/ui/`
- `src/core/layout/notification-bell.tsx` (not needed for single-admin)
- `src/core/layout/stacked-layout.tsx`, `split-panel-layout.tsx`, `top-nav-layout.tsx` (alternative layouts not used)

Only remove files confirmed unused by checking imports:

```bash
cd D:/Repositories/Personal/llm-proxy/web
# For each candidate file, check if anything imports it:
grep -r "activity-feed" src/ --include="*.ts" --include="*.tsx"
# If no results, safe to delete
```

- [ ] **Step 8: Commit cleanup**

```bash
cd D:/Repositories/Personal/llm-proxy
git add -A
git commit -m "chore(web): remove unused template demo files"
```
