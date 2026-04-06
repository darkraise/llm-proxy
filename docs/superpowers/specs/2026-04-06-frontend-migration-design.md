# Frontend Migration to darkraise-web-template

**Date:** 2026-04-06
**Status:** Approved
**Scope:** Full rewrite of `web/` frontend to adopt the darkraise-web-template foundation

## Summary

Migrate the llm-proxy React frontend from its current hand-rolled architecture to the darkraise-web-template foundation. The template provides the layout system, theme engine, UI primitives, and TanStack ecosystem. Pages are built from scratch for llm-proxy's actual needs.

The Go backend is unchanged — it continues to embed `web/dist/` via `go:embed`.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Migration depth | Full adoption | Avoid maintaining two parallel patterns |
| Auth model | Password-only, session cookies | Backend unchanged, single-admin tool doesn't need JWT |
| Theme scope | Dark/light + accent color picker | Simplified from template's full 6-axis system |
| Visual direction | Template default style, purple surface, solid mode | Matches template conventions, purple accent carried from current design |
| Page scope | All 8 pages migrated | No deferred pages, avoids two-style code |

## Architecture

### What We Carry From the Template (Verbatim)

- `src/core/` — UI primitives (24 shadcn-style components), layout (sidebar-layout, header, page-header, mobile-drawer, search-command, user-menu), theme engine (provider, palettes, token generation, surface styles, switcher), hooks (useMediaQuery, useBreakpoint), lib/utils (cn), providers (AppProviders composing QueryClient + ThemeProvider + Toaster)
- `src/features/charts/` — ChartCard, AreaChart, BarChart, LineChart, PieChart, ChartTooltip, useChartColors
- `src/features/data-table/` — DataTable, ColumnHeader, ColumnVisibility, DataTablePagination, DataTableToolbar, DataTableEmpty, DataTableSkeleton, RowActions, CSV export
- `src/features/forms/` — FieldWrapper, TextField, TextareaField, NumberField, SelectField, CheckboxField, SwitchField, RadioGroupField, FormSection, FormActions
- `src/features/dashboard/` — StatCard, KPICard

### What We Adapt

- `src/features/auth/` — Simplified to password-only login with session cookies. Zustand store tracks `isAuthenticated` only (no user object, no JWT). `useAuth` hook calls existing `api.auth.login()`. Route guard verifies session with a lightweight API call on fresh page load.
- `src/core/theme/theme.config.ts` — Purple surface, solid background, default style, dark mode default. Switcher shows only mode and accent color.

### What We Build New

- All 8 page routes using template components as building blocks
- React Query hooks wrapping each `api.ts` namespace
- Page-specific components (AccountCard, AccountDrawer, RateLimitTable, etc.) rebuilt with template primitives

## Project Structure

```
web/src/
├── core/                          # From template (verbatim)
│   ├── components/ui/             # 24 shadcn-style primitives
│   ├── hooks/                     # useMediaQuery, useBreakpoint
│   ├── layout/                    # sidebar-layout, header, page-header, etc.
│   ├── lib/                       # cn() utility
│   ├── providers/                 # AppProviders
│   └── theme/                     # Theme engine
│
├── features/                      # Template + adapted
│   ├── auth/                      # Adapted (password-only, session cookies)
│   │   ├── store.ts               # Zustand: { isAuthenticated, setAuth, logout }
│   │   ├── hooks/use-auth.ts      # login(password) → api.auth.login → setAuth
│   │   └── components/
│   │       ├── auth-layout.tsx    # From template
│   │       └── login-form.tsx     # Password-only
│   ├── charts/                    # From template
│   ├── data-table/                # From template
│   ├── forms/                     # From template
│   └── dashboard/                 # From template
│
├── hooks/                         # New: React Query hooks
│   ├── use-accounts.ts
│   ├── use-providers.ts
│   ├── use-ratelimits.ts
│   ├── use-stats.ts
│   ├── use-settings.ts
│   ├── use-logs.ts
│   ├── use-scanner.ts
│   └── use-ollama.ts
│
├── lib/
│   ├── api.ts                     # Existing typed API client (carried over)
│   ├── known-models.ts            # Existing (carried over)
│   └── providers.ts               # Existing (carried over)
│
├── components/                    # New: page-specific components
│   ├── account-card.tsx
│   ├── account-drawer.tsx
│   ├── add-models-dialog.tsx
│   ├── bulk-edit-modal.tsx
│   ├── rate-limit-table.tsx
│   ├── model-picker-dialog.tsx
│   ├── log-drawer.tsx
│   ├── breakdown-tabs.tsx
│   └── confirm-dialog.tsx
│
├── routes/                        # TanStack Router file-based
│   ├── __root.tsx
│   ├── _authenticated.tsx         # Auth guard + SidebarLayout
│   ├── _authenticated/
│   │   ├── index.tsx              # Dashboard
│   │   ├── accounts.tsx
│   │   ├── providers.tsx
│   │   ├── rate-limits.tsx
│   │   ├── logs.tsx
│   │   ├── keys-test.tsx
│   │   ├── scanner.tsx
│   │   └── settings.tsx
│   └── _guest/
│       └── login.tsx
│
├── styles/
│   └── globals.css                # From template
│
├── app.tsx                        # RouterProvider
├── main.tsx                       # React DOM root
└── routeTree.gen.ts               # Auto-generated
```

## Authentication

- **Zustand store** holds `isAuthenticated: boolean` with `setAuth()` and `logout()` actions. No user object, no token storage — the session cookie is the source of truth.
- **`useAuth` hook** exposes `login(password: string)` calling `api.auth.login(password)`. On success: `setAuth()`. On failure: return error message.
- **Login form** is a single password field using TanStack Form + Zod.
- **Route guard** in `_authenticated.tsx` checks `useAuthStore.getState().isAuthenticated`. On fresh page load where Zustand is empty but a session cookie may exist, the guard makes a lightweight API call (`api.settings.get()`) to verify the session. If it succeeds, calls `setAuth()`. If it fails (401), redirects to `/login`.
- **401 handling** in `api.ts` continues to redirect to `/login` and additionally calls `useAuthStore.getState().logout()`.

## Theme Configuration

```typescript
// theme.config.ts overrides
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
}
```

## Navigation Sidebar

Defined in `_authenticated.tsx`:

| Group | Items |
|-------|-------|
| Overview | Dashboard |
| Management | Accounts, Providers, Rate Limits |
| Monitoring | Usage Logs |
| Tools | Keys Test, Scanner |
| System | Settings |

## Pages

### Login (`_guest/login.tsx`)

AuthLayout (template split layout with decorative gradient mesh). Single password field, submit button, error display.

### Dashboard (`_authenticated/index.tsx`)

- PageHeader with auto-refresh toggle and date range selector (1h, 24h, 7d, 30d, 365d)
- 4 StatCards: total requests, total tokens, error count, average latency
- ChartCard with BarChart: request volume over time, stacked by provider, legend toggles
- BreakdownTabs: three Tabs (by Provider, by Account, by Model) with ranked progress bars
- Hooks: `useStatsOverview(range)`, `useStatsRequests(range)`, `useStatsProviders(range)`, `useStatsAccounts(range)`, `useStatsModels(range)`

### Accounts (`_authenticated/accounts.tsx`)

- PageHeader with Add button, bulk action dropdown, grid/list view toggle
- Toolbar: provider filter, status filter, search
- Grid view: AccountCard components (provider badge, model count, status dot, enabled toggle, checkbox). Click opens AccountDrawer.
- List view: DataTable with columns — name, provider, models, status, enabled, actions
- AccountDrawer (Sheet): TanStack Form with provider Select, name, API key, base URL, models (AddModelsDialog), rate limits (RateLimitTable), enabled toggle
- BulkEditModal: Dialog for bulk models/defaults/limits editing
- Hooks: `useAccounts()`, `useCreateAccount()`, `useUpdateAccount()`, `useDeleteAccount()`, `useDiscoverModels()`

### Providers (`_authenticated/providers.tsx`)

- PageHeader with "Add Custom" button
- Filter tabs: All / Built-in / Custom
- DataTable or card grid: display name, type badge, base URL, API standard, capabilities, enabled toggle
- Edit Sheet: form with name, display_name, base_url, models_url, api_standard, auth_type, capabilities, validation steps
- Delete for custom providers only
- Hooks: `useProviders()`, `useUpdateProvider()`, `useCreateProvider()`, `useDeleteProvider()`

### Rate Limits (`_authenticated/rate-limits.tsx`)

- PageHeader
- Provider Tabs (one per provider with accounts)
- RateLimitTable per tab: inline-editable, columns for model/default, metric (rpm/rpd/tpm/tpd), max value, window seconds. Add/delete rows.
- Sync defaults action
- Hooks: `useRateLimits(provider)`, `useSetRateLimit()`, `useDefaults()`

### Usage Logs (`_authenticated/logs.tsx`)

- PageHeader
- Toolbar: account, model, status, date range, min latency filters
- DataTable: timestamp, account, model, endpoint, status badge, latency, tokens in/out
- Row click → LogDrawer (Sheet) with full request metadata
- Pagination (25/50/100)
- Hooks: `useLogs(filters)`

### Keys Test (`_authenticated/keys-test.tsx`)

- PageHeader
- Provider Select, API key input, "Discover Models" button
- Results: discovered models with categorization, rate limit headers
- Chat test section: model Select, message input, response display with latency/tokens
- Hooks: mutations `useDiscoverModels()`, `useChatTest()`

### Scanner (`_authenticated/scanner.tsx`)

- PageHeader with Start/Stop button and status indicator
- Three Tabs: Keys, History, Patterns
- Keys: DataTable of discovered keys with actions (import, delete, bulk import)
- History: DataTable of scan runs
- Patterns: editable per-provider pattern list
- Config section: GitHub token, delay, max pages
- Hooks: `useScannerStatus()`, `useScannerStart()`, `useScannerStop()`, `useScannerKeys()`, `useScannerPatterns()`

### Settings (`_authenticated/settings.tsx`)

- PageHeader
- FormSections with independent save actions:
  - General: timeout, retries, log retention, datetime format
  - Notifications: test button
  - Ollama: auto-discovery toggle, URL
  - Import/Export: config YAML import/export, settings import/export
- Hooks: `useSettings()`, `useUpdateSettings()`

## Migration Steps

1. **Scaffold** — Copy template infrastructure into `web/`. Merge package.json dependencies. Keep vite config port 3838 and `/api` proxy to `:4001`.
2. **Foundation** — Set up routing, adapted auth, theme config, sidebar nav.
3. **Data layer** — Carry over `api.ts`, `known-models.ts`, `providers.ts`. Create React Query hooks.
4. **Pages** — Build each page: Login → Dashboard → Accounts → Providers → Rate Limits → Logs → Keys Test → Scanner → Settings.
5. **Verify** — `npm run build` produces `web/dist/` compatible with Go embed.

## Dependencies

**Added:** `@tanstack/react-router`, `@tanstack/router-plugin`, `@tanstack/react-query`, `@tanstack/react-form`, `@tanstack/react-table`, `zustand`, `zod`, `sonner`, `cmdk`, `tw-animate-css`, additional Radix packages (accordion, avatar, checkbox, label, popover, radio-group, scroll-area, separator, tabs).

**Removed:** `react-router-dom`, `tailwindcss-animate`, `@radix-ui/react-toggle-group`.

**Kept:** `react`, `react-dom`, `recharts`, `lucide-react`, `clsx`, `tailwind-merge`, `class-variance-authority`, overlapping Radix packages.
