# Darkraise UI Migration and 9router Feature Borrow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate llm-proxy's frontend from its vendored `src/core/` copy of the darkraise-web-template to the published `darkraise-ui@^1.0.5` npm package, then borrow a prioritized set of features from the 9router project across routing/fallback, pricing, combos, UI polish, observability, provider management, integrations, and security.

**Architecture:** Phase 0 is a mechanical refactor that swaps vendored UI code for a published package without changing any feature behavior. Phases 1–8 layer new backend features and admin UI onto the refreshed frontend, each phase shippable on its own. Every phase ends with a commit and verification against the same build/test gates.

**Tech Stack:** Go 1.22+, SQLite via modernc.org/sqlite, React 19.2, Vite 8, Tailwind CSS 4, TanStack Router/Query/Form/Table, Zustand, Sonner, Radix UI (bundled via darkraise-ui), Recharts, lucide-react, darkraise-ui 1.0.5, npm as the package manager.

**Scope note:** Phase 0 is specified in full TDD-style detail below and is ready to execute. Phases 1–8 are summarized as a roadmap appendix. Each of those phases should be written up as its own dedicated plan document (following the same granularity as Phase 0) immediately before that phase is executed — do not try to expand them inline in this document, because decisions made during Phase 0 and earlier phases will shape them.

---

## File Structure (Phase 0)

**Files to delete wholesale:**
- `web/src/core/` — all 57 vendored template files

**Files to create:**
- `web/src/providers/app-providers.tsx` — app-owned replacement for the deleted `web/src/core/providers/app-providers.tsx`, imports `ThemeProvider` from `darkraise-ui/theme` and `Toaster` from `darkraise-ui/components/sonner`, keeps the existing QueryClient config
- `web/src/theme.config.ts` — app-owned theme defaults and switcher axes configuration

**Files to modify:**
- `web/package.json` — add `darkraise-ui@^1.0.5`, remove all direct Radix packages, `cmdk`, `class-variance-authority`, `clsx`, `tailwind-merge`, `sonner`, `tw-animate-css`
- `web/src/styles/globals.css` — replace the entire file with a single `@import "darkraise-ui/styles.css";` line, because the existing file is a verbatim copy of the package stylesheet with no llm-proxy-specific additions
- `web/src/routes/__root.tsx` — import `AppProviders` from the new local path instead of `@/core/providers`
- Every file that currently imports from `@/core/*` — rewrite to `darkraise-ui`, `darkraise-ui/layout`, `darkraise-ui/theme`, `darkraise-ui/hooks`, or `darkraise-ui/lib` as appropriate

**Files to leave alone:**
- All of `web/src/features/`, `web/src/components/`, `web/src/routes/`, `web/src/hooks/`, `web/src/lib/` except for import rewrites — these are app-specific code
- `web/vite.config.ts`, `web/tsconfig.json` — no config changes needed; Tailwind v4 Vite plugin already handles everything the package expects
- The Go backend — Phase 0 touches only `web/`

---

## Phase 0 — Frontend Migration to darkraise-ui

Goal of this phase: end up on `darkraise-ui@^1.0.5` with every existing feature route working identically, zero direct Radix dependencies remaining, and `web/src/core/` deleted.

Verification gates (these are the "tests" for this phase because it is a pure refactor):

1. `cd web && npm run build` — runs `tsc --noEmit && vite build` and must exit 0
2. `cd web && npm run dev` — Vite dev server must start with no errors or warnings about missing modules
3. Manual smoke test: log in, then visit `/` (dashboard), `/accounts`, `/providers`, `/rate-limits`, `/logs`, `/settings`, `/keys-test`, `/scanner`. On each route: the page renders, the sidebar nav collapses and expands, the theme toggle works, opening a sheet or dialog works, any tables render, any toasts fire, no console errors.

### Task 0.1: Baseline the current build

Before touching anything, verify the existing build and dev server work cleanly so any failures later are clearly attributable to the migration, not pre-existing breakage.

**Files:**
- Read only: `web/package.json`, `web/package-lock.json`

- [ ] **Step 1: Record the current dependency snapshot**

Run: `cd D:/Repositories/Personal/llm-proxy/web && npm ls --depth=0`
Expected: a list of top-level dependencies including all the individual `@radix-ui/react-*` packages, `cmdk`, `class-variance-authority`, `clsx`, `tailwind-merge`, `sonner`, `tw-animate-css`, `lucide-react`, `recharts`, `zustand`, `zod`, and the `@tanstack/*` packages. No `darkraise-ui` yet. Note the output mentally or copy it into the session scratchpad — it will be compared against the post-migration output in Task 0.8 Step 4.

- [ ] **Step 2: Run the current build to confirm green baseline**

Run: `cd D:/Repositories/Personal/llm-proxy/web && npm run build`
Expected: exits 0, `web/dist/` is populated. If this fails, STOP — fix the baseline before migrating.

- [ ] **Step 3: Start the dev server and smoke-check one route**

Run: `cd D:/Repositories/Personal/llm-proxy/web && npm run dev` in a second shell. The Vite dev server listens on port 3838 (configured in `web/vite.config.ts`) and proxies `/api` to the Go admin backend on `localhost:4001`. Open `http://localhost:3838/` in a browser and log in.
Expected: dashboard loads, no console errors, no Vite HMR errors in the terminal. Kill the dev server after confirming.

- [ ] **Step 4: Confirm the working tree is clean for the web/ directory**

Run: `cd D:/Repositories/Personal/llm-proxy && git status web/`
Expected: nothing to commit in `web/`. The project root has other in-flight changes per the initial git status; those are out of scope for this phase.

### Task 0.2: Install darkraise-ui

**Files:**
- Modify: `web/package.json`
- Modify: `web/package-lock.json` (via npm)

- [ ] **Step 1: Add darkraise-ui as a dependency**

Run: `cd D:/Repositories/Personal/llm-proxy/web && npm install darkraise-ui@^1.0.5`
Expected: `darkraise-ui` appears in `web/package.json` under `dependencies`, `package-lock.json` updates. Exit 0.

- [ ] **Step 2: Verify the installed version resolves cleanly**

Run: `cd D:/Repositories/Personal/llm-proxy/web && npm ls darkraise-ui`
Expected: prints `darkraise-ui@1.0.5` (or newer patch) with no `UNMET DEPENDENCY` or peer-dep warnings.

- [ ] **Step 3: Confirm subpath resolution by importing in a throwaway check**

Run: `cd D:/Repositories/Personal/llm-proxy/web && node --input-type=module -e "import('darkraise-ui/theme').then(m => console.log(Object.keys(m).sort()))"`
Expected: prints an array containing at least `ThemeProvider`, `useTheme`, `themeConfig`. If it errors with `ERR_PACKAGE_PATH_NOT_EXPORTED`, the installed version does not match the expected exports map — stop and reconcile before proceeding. The `--input-type=module` flag is required so Node evaluates the `import()` expression in ESM mode; without it, `node -e` defaults to CommonJS and may misresolve the bare specifier.

### Task 0.3: Create the app-owned theme config

The existing theme defaults live inside `src/core/theme/theme.config.ts`. After Phase 0, `src/core/` is deleted, so the defaults must move to app-owned code.

**Files:**
- Create: `web/src/theme.config.ts`
- Read only: `web/src/core/theme/theme.config.ts` (to copy current defaults)

- [ ] **Step 1: Read the current defaults from the vendored file**

Run: Read `web/src/core/theme/theme.config.ts` end-to-end. The current llm-proxy defaults (as of writing this plan) are `accentColor: "purple"`, `surfaceColor: "purple"`, `surfaceStyle: "default"`, `backgroundStyle: "solid"`, `fontFamily: "default"`, `mode: "dark"`, with only `mode` and `accentColor` axes enabled in the switcher. Confirm these values still match before copying them into the new file — if llm-proxy has since tweaked them, use whatever the current file says, not these.

- [ ] **Step 2: Create the app theme config**

Write `web/src/theme.config.ts` with the exact defaults from the current vendored file. Using the values confirmed in Step 1:

```ts
import type { ThemeConfig } from "darkraise-ui/theme"

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

The `ThemeConfig` type has the same shape in darkraise-ui as in the vendored copy, so this compiles against the package type unchanged. The `ThemeProvider` component accepts a `config?: ThemeConfig` prop (confirmed in `darkraise-web-template/packages/ui/src/theme/theme-provider.tsx`) — Task 0.4 wires it up.

- [ ] **Step 3: Typecheck against the project config**

Run: `cd D:/Repositories/Personal/llm-proxy/web && npx tsc --noEmit -p tsconfig.json`
Expected: the command runs a full project typecheck. It will still report errors elsewhere (the vendored `src/core/` files may produce duplicate-export warnings once the new file exists, and Task 0.4's new providers file does not yet exist). What matters here: no errors originate from `src/theme.config.ts` itself. Do NOT pass the file directly as a positional argument — invoking `tsc` with explicit files bypasses `tsconfig.json` entirely, disables the `@/*` path alias, and switches module resolution to the classic default, which would fail to resolve the `darkraise-ui/theme` bare specifier.

### Task 0.4: Create the app-owned providers module

The existing `src/core/providers/app-providers.tsx` owns the `QueryClient` (staleTime 60_000, retry 1) and wires up `ThemeProvider` and `Toaster`. Move that to app code so it survives `src/core/` deletion.

**Files:**
- Create: `web/src/providers/app-providers.tsx`
- Create: `web/src/providers/index.ts`
- Read only: `web/src/core/providers/app-providers.tsx`

- [ ] **Step 1: Read the current providers file**

Run: Read `web/src/core/providers/app-providers.tsx` and confirm it exports `AppProviders` and creates the `QueryClient` with `staleTime: 60 * 1000` and `retry: 1`. If the existing file has extra custom wiring (error boundaries, devtools, persistence adapters), carry those over too.

- [ ] **Step 2: Write the new providers file**

Write `web/src/providers/app-providers.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { ThemeProvider } from "darkraise-ui/theme"
import { Toaster } from "darkraise-ui/components/sonner"
import { themeConfig } from "@/theme.config"

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60 * 1000,
      retry: 1,
    },
  },
})

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider config={themeConfig}>
        {children}
        <Toaster />
      </ThemeProvider>
    </QueryClientProvider>
  )
}
```

- [ ] **Step 3: Write the barrel file**

Write `web/src/providers/index.ts`:

```ts
export { AppProviders } from "./app-providers"
```

- [ ] **Step 4: Typecheck the new files**

Run: `cd D:/Repositories/Personal/llm-proxy/web && npx tsc --noEmit`
Expected: the build still has errors because `src/core/` still coexists — that's fine. Grep the output for `src/providers/app-providers.tsx` or `src/providers/index.ts` and confirm there are no errors in those new files specifically.

### Task 0.5: Rewrite imports in every consuming file

This is the bulk of the migration: every file that currently imports from `@/core/*` must be updated. App-specific code is under `src/features/`, `src/components/`, `src/routes/`, `src/hooks/`, and `src/lib/`.

**Files to modify** (identify with grep, do not try to enumerate by hand):
- Every file in `web/src/` outside `web/src/core/` that matches `@/core/`

Mapping rules:

| Old import | New import |
| --- | --- |
| `@/core/components/ui/<name>` | `darkraise-ui/components/<name>` |
| `@/core/layout/<name>` | `darkraise-ui/layout` (pull the named export) |
| `@/core/theme/use-theme` or `@/core/theme/theme-provider` | `darkraise-ui/theme` |
| `@/core/theme/theme.config` | `@/theme.config` |
| `@/core/hooks/use-breakpoint` | `darkraise-ui/hooks` (named export `useBreakpoint`) |
| `@/core/hooks/use-media-query` | `darkraise-ui/hooks` (named export `useMediaQuery`) |
| `@/core/lib/utils` (cn) | `darkraise-ui/lib` |
| `@/core/providers/app-providers` | `@/providers/app-providers` |
| `@/core/components/ui/sonner` (Toaster) | `darkraise-ui/components/sonner` |

Lucide icons stay on `lucide-react` — darkraise-ui does not re-export them. 30+ files import icons directly; do not rewrite those imports.

**Strict-mode caveat:** `web/tsconfig.json` has `noUnusedLocals: true` and `noUnusedParameters: true` enabled. The rewrite steps below must not leave any named import unused — if a file previously imported `Button` and `ButtonVariants` but now uses only `Button`, the leftover `ButtonVariants` will fail the build at Task 0.7 Step 3. After rewriting, visually scan each modified file (or use an IDE's "remove unused imports" action) before running the build.

- [ ] **Step 1: Inventory every file that imports from `@/core`**

Run via Grep tool with pattern `from ["']@/core/` over `web/src/` excluding `web/src/core/`. Record the list. Expected: dozens of files across routes, features, and components.

- [ ] **Step 2: Rewrite UI component imports**

For each file in the inventory, rewrite all `@/core/components/ui/<name>` imports to `darkraise-ui/components/<name>`. Keep the named exports identical — `Button`, `Card`, `CardHeader`, `Sheet`, `Dialog`, etc. all come through with the same names.

Example before:

```tsx
import { Button } from "@/core/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/core/components/ui/card"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/core/components/ui/sheet"
```

After:

```tsx
import { Button } from "darkraise-ui/components/button"
import { Card, CardContent, CardHeader, CardTitle } from "darkraise-ui/components/card"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "darkraise-ui/components/sheet"
```

- [ ] **Step 3: Rewrite layout imports**

For each file that imports from `@/core/layout/*`, rewrite to `darkraise-ui/layout`. The layout subpath barrel exports `SidebarLayout`, `TopNavLayout`, `StackedLayout`, `SplitPanelLayout`, `PageHeader`, `SearchCommand`, `UserMenu`, `NotificationBell`, `MobileDrawer`, `BrandLogo`, `SidebarNav`, `SidebarGroup`, `SidebarItem`, `LayoutHeader`, `LayoutSwitcher`, `useBrandStore`, `useLayoutStore`, and the `LayoutVariant` type.

Example before:

```tsx
import { SidebarLayout } from "@/core/layout/sidebar-layout"
import { PageHeader } from "@/core/layout/page-header"
import type { NavItem, NavGroup } from "@/core/layout/types"
```

After:

```tsx
import { SidebarLayout, PageHeader } from "darkraise-ui/layout"
import type { NavItem, NavGroup } from "darkraise-ui/layout"
```

- [ ] **Step 4: Rewrite theme imports**

Replace `@/core/theme/theme-provider`, `@/core/theme/use-theme`, `@/core/theme/theme-switcher`, and `@/core/theme/types` imports with `darkraise-ui/theme`. Replace `@/core/theme/theme.config` with `@/theme.config`.

Example before:

```tsx
import { useTheme } from "@/core/theme/use-theme"
import type { AccentColor } from "@/core/theme/types"
```

After:

```tsx
import { useTheme } from "darkraise-ui/theme"
import type { AccentColor } from "darkraise-ui/theme"
```

- [ ] **Step 5: Rewrite hooks imports**

Replace `@/core/hooks/use-breakpoint` with `darkraise-ui/hooks` (named export `useBreakpoint`). Replace `@/core/hooks/use-media-query` with `darkraise-ui/hooks` (named export `useMediaQuery`).

- [ ] **Step 6: Rewrite the cn utility import**

Replace every `@/core/lib/utils` import with `darkraise-ui/lib`. The named export `cn` is identical.

- [ ] **Step 7: Rewrite the providers import in the root route**

Open `web/src/routes/__root.tsx`. Change:

```tsx
import { AppProviders } from "@/core/providers/app-providers"
```

to:

```tsx
import { AppProviders } from "@/providers/app-providers"
```

- [ ] **Step 8: Confirm no references to `@/core` remain outside `web/src/core/` itself**

Run via Grep tool with pattern `@/core/` over `web/src/` — expected output should include only files under `web/src/core/` (which will be deleted next). If any file outside `web/src/core/` still matches, fix it before moving on.

### Task 0.6: Replace globals.css with the darkraise-ui stylesheet

Verification against the package source (`darkraise-web-template/packages/ui/src/styles/theme.css`) confirms that llm-proxy's current `web/src/styles/globals.css` is a byte-for-byte copy of the darkraise-ui stylesheet, modulo equivalent CSS value wrappings on the `--chart-*` tokens (darkraise-ui writes them as `hsl(217 91% 60%)` in `:root`, llm-proxy writes them as `217 91% 60%` and wraps via `@theme inline` — both resolve to the same final color). The package ships every single declaration that currently lives in globals.css: the `@import` lines, the `@custom-variant dark`, the `@utility scrollbar-none`, the full `@theme inline` token block (plus two extra `@keyframes collapsible-*` that llm-proxy lacks), the `:root` fallback values, and the entire `@layer base` block with `.card-surface`, `.overlay-surface`, `.sidebar-nav-item`, `.theme-transition`, `.sidebar-gradient-overlay`, `.header-gradient-overlay`, `main[data-content]::before`, and the custom scrollbar rules.

There is nothing llm-proxy-specific to preserve. Task 0.6 therefore collapses to a single replacement.

**Files:**
- Modify: `web/src/styles/globals.css`

- [ ] **Step 1: Replace the entire file contents with a single import**

Open `web/src/styles/globals.css`, delete every line, and write exactly:

```css
@import "darkraise-ui/styles.css";
```

That is the entire file. No `@theme inline`, no `:root`, no `@layer base`, no custom utilities — all of it is now served by the package. The `@source ".."` directive at the bottom of the package stylesheet is relative to its own dist location, so it correctly scans `node_modules/darkraise-ui/dist/` for utility classes used by the bundled components; Tailwind v4's Vite plugin picks up llm-proxy's own source files automatically from the project root.

- [ ] **Step 2: Confirm `main.tsx` still imports globals.css**

Run: Read `web/src/main.tsx` and confirm the first CSS import is still `import "@/styles/globals.css"` (no path change needed — only the file contents changed).

- [ ] **Step 3: Reload the dev server and confirm the dashboard still has color**

Run: `cd D:/Repositories/Personal/llm-proxy/web && npm run dev` and hard-reload the dashboard in the browser. Expected: page renders with theme colors applied, no white-on-white elements, no `undefined CSS variable` warnings in the console, no missing utility class warnings from Tailwind. If the page is unstyled, verify that darkraise-ui resolved correctly in Task 0.2 Step 3 and that the single-line import is spelled exactly as above. Kill the dev server after confirming.

### Task 0.7: Delete src/core/

At this point, nothing outside `src/core/` references anything inside `src/core/`. Delete the whole directory.

**Files:**
- Delete: `web/src/core/` (recursive)

- [ ] **Step 1: Sanity check before deletion**

Run: Grep tool with pattern `from ["']@/core/` over `web/src/` excluding `web/src/core/`. Expected: zero matches. If there are matches, return to Task 0.5 and fix them — do not proceed.

- [ ] **Step 2: Delete the directory**

Run: `rm -rf D:/Repositories/Personal/llm-proxy/web/src/core`
Expected: command succeeds silently.

- [ ] **Step 3: Verify the typecheck and build still pass**

Run: `cd D:/Repositories/Personal/llm-proxy/web && npm run build`
Expected: `tsc --noEmit` passes and `vite build` passes, producing `web/dist/`. If any file still imports from `@/core/` at this point, the build will fail with unresolved module errors. For each failing import, look up the correct darkraise-ui subpath using this rule: whatever came after `@/core/` in the old path (e.g., `components/ui/button`, `layout/page-header`, `theme/use-theme`) maps to the corresponding subpath under `darkraise-ui/` (e.g., `darkraise-ui/components/button`, `darkraise-ui/layout`, `darkraise-ui/theme`). If the build also fails with `noUnusedLocals` errors (TS6133), prune the unused named imports from the offending files and re-run.

### Task 0.8: Strip redundant direct dependencies

Packages that were only used by the now-deleted `src/core/` can be removed from `web/package.json`. Anything used by app code stays.

**Files:**
- Modify: `web/package.json`
- Modify: `web/package-lock.json` (via npm)

Packages to remove (confirmed not used by any file outside `src/core/`): all `@radix-ui/react-*`, `cmdk`, `class-variance-authority`, `clsx`, `tailwind-merge`, `sonner`, `tw-animate-css`.

Packages to keep as direct deps:
- `lucide-react` — imported by 32 app files for icons; darkraise-ui does not re-export it
- `recharts` — imported directly by `src/features/charts/`
- `zustand` — imported directly by `src/features/auth/store.ts`
- `zod` — available for future form validation
- `@tanstack/react-router`, `@tanstack/react-query`, `@tanstack/react-form`, `@tanstack/react-table` — imported directly by app routes, hooks, and features
- `react`, `react-dom` — obvious
- The `devDependencies` block stays untouched

- [ ] **Step 1: Verify each target package is truly unused by app code**

For each package in the removal list, run Grep with pattern `from ["']<package-name>["']` over `web/src/` (no exclusion needed, since `src/core/` is gone). Expected: zero matches for every package. If any returns a match, remove that package from the removal list — keep it as a direct dep.

- [ ] **Step 2: Remove the packages in one npm call**

Run: `cd D:/Repositories/Personal/llm-proxy/web && npm uninstall @radix-ui/react-accordion @radix-ui/react-avatar @radix-ui/react-checkbox @radix-ui/react-dialog @radix-ui/react-dropdown-menu @radix-ui/react-label @radix-ui/react-popover @radix-ui/react-radio-group @radix-ui/react-scroll-area @radix-ui/react-select @radix-ui/react-separator @radix-ui/react-slot @radix-ui/react-switch @radix-ui/react-tabs @radix-ui/react-tooltip cmdk class-variance-authority clsx tailwind-merge sonner tw-animate-css`
Expected: `package.json` shrinks, `package-lock.json` updates, exit 0.

- [ ] **Step 3: Run the build again**

Run: `cd D:/Repositories/Personal/llm-proxy/web && npm run build`
Expected: exits 0. If it fails with missing module errors, the preflight grep missed something — re-add the offending package and move on.

- [ ] **Step 4: Compare the dep list to the baseline for a sanity check**

Run: `cd D:/Repositories/Personal/llm-proxy/web && npm ls --depth=0`
Expected: compared against what was noted in Task 0.1 Step 1, the output now has `darkraise-ui@1.0.5` added and has lost every package listed in the strip set above. Nothing else should have changed. If anything unexpected is missing (e.g. `lucide-react`, `recharts`, `zustand`, `zod`, any `@tanstack/*`), stop and restore it — those are app-level direct dependencies and must remain.

### Task 0.9: Full manual smoke test

Phase 0 is a pure refactor, so the only meaningful verification is walking every feature route and confirming nothing regressed.

- [ ] **Step 1: Start the dev server**

Run: `cd D:/Repositories/Personal/llm-proxy/web && npm run dev` in one shell. Separately, start the Go backend: `cd D:/Repositories/Personal/llm-proxy && ./start-dev-backend.sh`.
Expected: both servers start without errors.

- [ ] **Step 2: Log in**

Open `http://localhost:3838/login`, enter the admin password, submit.
Expected: redirect to `/`, dashboard renders.

- [ ] **Step 3: Walk every authenticated route**

Visit in order: `/`, `/accounts`, `/providers`, `/rate-limits`, `/logs`, `/settings`, `/keys-test`, `/scanner`.
For each route, verify:
- Page header renders with title and any action buttons
- Sidebar nav highlights the current route
- Main content area renders without placeholder text or empty cards
- No `Cannot read property` or `undefined is not a function` errors in the browser console
- No 404s on JS or CSS chunks in the network tab

- [ ] **Step 4: Exercise interactive elements**

On `/accounts`: open the account drawer, close it. On `/providers`: open the provider sheet, close it. On `/logs`: open a log detail drawer, close it. On `/settings`: toggle any switch and confirm a Sonner toast appears. On the dashboard: change the time range dropdown.
Expected: every interaction works the same as before migration.

- [ ] **Step 5: Toggle the theme**

Open the user menu or theme switcher (wherever it lives in the layout) and switch between light and dark mode.
Expected: `data-mode` attribute on `<html>` flips, CSS variables update, page recolors, no flash of unstyled content.

- [ ] **Step 6: Stop the servers**

Kill both dev server processes.

### Task 0.10: Commit Phase 0

- [ ] **Step 1: Reset any stray route-tree regeneration**

`web/src/routeTree.gen.ts` is tracked in git (not gitignored). The TanStack Router plugin regenerates it on dev-server startup, so the smoke test in Task 0.9 may have modified it. If the change is spurious (no new routes added this phase), discard it so the commit stays clean.

Run: `cd D:/Repositories/Personal/llm-proxy && git diff --stat web/src/routeTree.gen.ts`
If the diff is non-empty, run: `git checkout -- web/src/routeTree.gen.ts`

- [ ] **Step 2: Stage and commit**

Run:

```bash
cd D:/Repositories/Personal/llm-proxy
git add web/package.json web/package-lock.json web/src
git rm -r web/src/core
git commit -m "$(cat <<'EOF'
refactor(web): migrate from vendored template to darkraise-ui@1.0.5

Replace the copy of darkraise-web-template under web/src/core/ with the
published darkraise-ui npm package. App code now imports from
darkraise-ui/components, darkraise-ui/layout, darkraise-ui/theme,
darkraise-ui/hooks, and darkraise-ui/lib. Theme config and providers
become app-owned at web/src/theme.config.ts and
web/src/providers/app-providers.tsx. The global stylesheet collapses to
a single @import line because the previous content was a verbatim copy
of the package stylesheet with no llm-proxy-specific rules.

Strips direct dependencies now bundled by darkraise-ui: all Radix
packages, cmdk, class-variance-authority, clsx, tailwind-merge, sonner,
tw-animate-css. Keeps lucide-react, recharts, zustand, zod, and
@tanstack/* because app code imports them directly.
EOF
)"
```

Expected: commit succeeds, `git status web/` is clean afterwards.

- [ ] **Step 3: Verify the post-commit build one more time**

Run: `cd D:/Repositories/Personal/llm-proxy/web && npm run build`
Expected: exits 0.

#### Rollback (if the smoke test or post-commit build reveals a regression)

Phase 0 is a single commit with no external side effects beyond `node_modules/`, so rollback is straightforward.

- **Before the commit lands** (Task 0.9 smoke test failed): run `cd D:/Repositories/Personal/llm-proxy && git reset HEAD web/ && git checkout -- web/` to unstage and discard every change under `web/`. Then run `cd web && npm ci` to restore `node_modules/` to the state described by the original lock file.
- **After the commit lands** (Task 0.10 Step 3 failed or a regression was found later): run `git revert <commit-hash>` to create a revert commit. Then run `cd web && npm ci` to reinstall the original dependency set.
- **Never** use `git reset --hard` or `rm -rf node_modules` as the first response — both destroy information that makes diagnosing the root cause harder. The `git checkout` / `git revert` path is fully reversible.

---

## Phases 1–8 — 9router Feature Borrow Roadmap

Each phase below should be written up as its own dedicated plan document (`docs/superpowers/plans/YYYY-MM-DD-<phase-name>.md`) immediately before that phase is executed, with the same task granularity as Phase 0. The entries here fix scope, dependencies, and sequencing but intentionally do not enumerate task-level steps, because later phases will be shaped by decisions made in earlier ones.

### Phase 1 — Routing and rate-limit refactor

**Goal:** Land the routing/fallback improvements from 9router section A of the borrow list.

**Scope:**
- A1 per-model account cooldowns (cooldown key is `account_id + model` instead of `account_id` alone)
- A2 exponential backoff ladder with levels 0→1s, 1→2s, 2→4s, up to 120s, applied when provider responses do not carry usable `X-RateLimit-*` headers
- A3 sticky round-robin with configurable per-provider `sticky_limit` (default 1 for current behavior)
- A4 global strategy toggle: `fill-first` vs `round-robin`
- A5 per-provider strategy override
- A6 expanded failover on 401, 402, 403, 429, 5xx with per-code backoff weights

**Primary files touched:**
- `internal/provider/pool.go` — selection logic
- `internal/provider/ratelimit.go` — cooldown bookkeeping, backoff ladder
- `internal/proxy/handler.go` — retry loop and failover decisions
- `internal/store/sqlite.go` — new columns on the accounts or rate-limit tables for per-model cooldown keys and backoff level
- `internal/admin/handler.go`, `internal/admin/provider_handler.go` — expose strategy settings
- `web/src/routes/_authenticated/settings.tsx`, `web/src/routes/_authenticated/providers.tsx` — UI for the new settings

**Dependencies:** Phase 0 complete. No dependencies on Phases 2–8.

**Deliverables:** Go unit tests for the ladder and selection logic, integration test in `test/integration_test.go` covering a 429 → backoff → success flow, admin UI controls for the new settings, migration or schema bump for the new columns.

**Rough effort:** 3–5 days.

### Phase 2 — Pricing, cost, and quota tracking

**Goal:** Surface per-request cost and per-account subscription quotas (9router section D).

**Scope:**
- D1 `pricing` table keyed by `(provider, model)` with input, output, cached, and reasoning token rates
- D2 `cost_cents` column on `RequestLog`, populated at log-write time by the `logWriter` background worker
- D3 per-provider and per-model cost breakdown charts on the dashboard using the existing Recharts setup
- D4 `account_quotas` table storing monthly caps and reset dates
- D5 quota poller as a new background worker that hits provider billing endpoints where available and updates `account_quotas`
- D6 budget cutoff in `Pool.SelectExcluding` — skip accounts whose cost-to-date exceeds their budget
- D7 a cost calculator utility page in the admin UI

**Primary files touched:**
- `internal/store/sqlite.go` — new tables and the cost column
- `internal/server/server.go` (the background worker goroutines currently live here; if Phase 2 decides to extract them into a dedicated `background.go`, do that as the first task of the phase) — add the quota poller as a fifth background goroutine alongside `logWriter`, `rateLimitWriter`, `logPruner`
- `internal/proxy/handler.go` — attach token usage and cost to the log entry before dispatch
- `internal/admin/stats_handler.go` — cost breakdown endpoints
- `web/src/features/dashboard/` and `web/src/routes/_authenticated/index.tsx` — new charts
- New admin route in `web/src/routes/_authenticated/cost-calculator.tsx`

**Dependencies:** Phase 0 for the frontend. Independent of Phase 1 but easier if Phase 1 has landed because both touch the log writer.

**Deliverables:** Seeded pricing table with current official rates, per-request cost in the log detail drawer, cost-over-time chart on the dashboard, quota reset countdown on the accounts page.

**Rough effort:** 4–6 days.

### Phase 3 — Combos, aliases, and capabilities

**Goal:** Model combos, global aliases, capability metadata, adapter audit, new formats (9router section C).

**Scope:**
- C1 `combos` table: named fallback or round-robin lists of `(provider, model)` tuples exposed as a single model name to clients, resolved in `proxy.Handler` before pool selection
- C2 global model aliases stored in settings
- C3 capability flags per model (vision, tools, reasoning, streaming) with client-side filtering
- C4 adapter audit: `/v1/messages` must round-trip to OpenAI backends and `/v1/chat/completions` must round-trip to Anthropic/Google backends
- C5 OpenAI Responses API adapter variant (`/v1/responses`)
- C6 `/v1/audio/speech` TTS passthrough

**Primary files touched:**
- `internal/store/sqlite.go` — `combos` table
- `internal/proxy/handler.go` — combo resolution prior to pool selection
- `internal/adapter/*` — audit every translator, add Responses API variant, add TTS adapter
- `internal/admin/combos_handler.go` (new)
- `web/src/routes/_authenticated/combos.tsx` (new)

**Dependencies:** Phase 1 (combos need the new pool selection semantics).

**Deliverables:** Combos CRUD in admin UI, passing adapter audit with new integration tests, working TTS passthrough for at least one provider, Responses API shape accepted and translated.

**Rough effort:** 4–6 days.

### Phase 4 — UI polish sweep

**Goal:** Visual improvements from 9router section I, layered onto darkraise-ui wrappers.

**Scope:**
- I1 hover-reveal row actions across tables and cards
- I2 frosted-glass sidebar via the `glassmorphism` surface style already bundled in darkraise-ui
- I3 warmer accent color — default to terracotta or amber in `theme.config.ts`
- I4 gradient primary buttons via a local `GradientButton` wrapper
- I5 inline click-to-edit fields as a reusable component
- I6 thin scrollbar CSS
- I7 Card padding variants via a local CVA wrapper (reintroduces cva as a direct dep if the Phase 0 strip removed it)
- I8 SegmentedControl built on `darkraise-ui/components/toggle-group`
- I9 optional traffic-light modal header as a decorative wrapper over `darkraise-ui/components/dialog`
- I10 reusable `EmptyState` component
- I11 per-card loading skeletons using `darkraise-ui/components/skeleton`
- I12 button press feedback via `active:scale-[0.99]`
- I13 zoom-in modal animation (likely already provided by tw-animate-css inside the package)
- I14 Card.ListItem sub-component pattern

**Primary files touched:**
- `web/src/components/ui/` — new wrappers (only wrappers, no re-implementation of base primitives)
- `web/src/theme.config.ts` — accent and surface style defaults
- `web/src/styles/globals.css` — scrollbar styling
- Every page that displays rows or cards — minor className diffs to adopt the new patterns

**Dependencies:** Phase 0. Can be interleaved with Phases 1–3 rather than gated behind them.

**Deliverables:** Consistent row-action hover behavior, new theme defaults, a `GradientButton`, `EmptyState`, `InlineEdit`, and `SegmentedControl` in `web/src/components/ui/`, updated dashboards using the new skeletons and card variants.

**Rough effort:** 2–3 days spread over other phases.

### Phase 5 — Observability and logs

**Goal:** Structured logging namespaces, live console page, body capture, replay (9router section E).

**Scope:**
- E1 structured namespace logging tags (CHAT, AUTH, ROUTING, COMBO, RATELIMIT) across existing log sites
- E2 live console log page streaming recent requests over SSE
- E3 opt-in full request/response body capture with size cap and TTL
- E4 replay action in the log detail drawer
- E5 per-namespace log level configuration in settings, applied without restart

**Primary files touched:**
- `internal/server/log.go`, `internal/proxy/handler.go`, `internal/admin/*` — standardize log call sites
- `internal/admin/console_handler.go` (new) — SSE endpoint
- `internal/store/sqlite.go` — optional `request_bodies` table with TTL
- `web/src/routes/_authenticated/console.tsx` (new)
- `web/src/components/log-drawer.tsx` — replay button

**Dependencies:** Phase 0. Independent of Phases 1–4 but should land after Phase 1 so ratelimit events are tagged correctly.

**Deliverables:** Namespaced log output, live console page, replay working from the log drawer, body capture toggle in settings with correct TTL cleanup.

**Rough effort:** 4–5 days.

### Phase 6 — Provider and account management

**Goal:** OAuth providers, token refresh, proxy pools, provider metadata (9router section B). This is the largest phase.

**Scope:**
- B1 OAuth provider support: new `oauth` package, per-provider flow (Anthropic, Google, Qwen, Kiro, iFlow), callback routes in the admin server, new `account_credentials` table variant
- B2 OAuth token refresh as a new background worker alongside the existing three (or four after Phase 2)
- B3 per-account proxy pool assignment: new `proxy_pools` table, HTTP client factory keyed by account
- B4 provider icons and metadata catalog enrichment
- B5 dynamic model discovery for OpenAI-compatible providers (hit `/v1/models` on demand)
- B6 audit and fill gaps in custom provider node support (OpenAI-compatible and Anthropic-compatible base URLs)
- B7 per-account health check via the existing scanner

**Primary files touched:**
- `internal/oauth/` (new package)
- `internal/store/sqlite.go` — `account_credentials`, `proxy_pools` tables
- `internal/server/server.go` (the background worker goroutines currently live here; if Phase 2 decides to extract them into a dedicated `background.go`, do that as the first task of the phase) — token refresh worker
- `internal/admin/oauth_handler.go`, `internal/admin/proxy_pool_handler.go` (new)
- `internal/provider/pool.go` — per-account HTTP client resolution
- `web/src/routes/_authenticated/accounts.tsx`, `web/src/routes/_authenticated/proxy-pools.tsx` (new)

**Dependencies:** Phase 1 (Pool changes), Phase 2 (quota model if reused for OAuth subscription tiers).

**Deliverables:** Working OAuth connect flow for at least one provider end-to-end, automatic token refresh verified, proxy pool routing exercised in an integration test, health-check button on the accounts page.

**Rough effort:** 7–10 days.

### Phase 7 — Integrations and setup UX

**Goal:** CLI-tools config generator, OAuth buttons on the provider sheet, translator tester (9router section G).

**Scope:**
- G1 CLI-tools config generator page with copy-paste snippets for Claude Code, Cursor, Cline, Codex, OpenCode
- G2 OAuth login buttons on the provider create sheet (depends on Phase 6)
- G3 translator tester page — paste a request, see the translated shape for each backend, no Monaco

**Primary files touched:**
- `web/src/routes/_authenticated/cli-tools.tsx` (new)
- `web/src/routes/_authenticated/translator.tsx` (new)
- `web/src/components/provider-sheet.tsx` — OAuth buttons

**Dependencies:** Phase 6 (B1) for the OAuth buttons. G1 and G3 can ship earlier if desired.

**Deliverables:** Generator page with snippet templates for each supported CLI tool, translator page exposing the adapter layer for debugging.

**Rough effort:** 2–3 days.

### Phase 8 — Security and operations

**Goal:** Per-key rate limiting, key scoping, OAuth expiry alerts, optional local HTTPS (9router section H, minus the explicitly skipped MITM work).

**Scope:**
- H1 per-API-key rate limiting on the proxy server: new `api_key_limits` table, middleware in `proxy.Handler`
- H2 API key scoping — allow or deny specific models and endpoints per bearer token
- H3 OAuth expiry alerts through the existing `notify` package (depends on Phase 6)
- H5 optional self-signed localhost HTTPS on first run

**Primary files touched:**
- `internal/store/sqlite.go` — `api_key_limits` table
- `internal/proxy/middleware.go` — new rate-limit and scope middleware
- `internal/server/server.go` — optional self-signed cert generation
- `internal/notify/` — new alert types for OAuth expiry
- `web/src/routes/_authenticated/keys-test.tsx`, `web/src/routes/_authenticated/settings.tsx` — scoping and limit UI

**Explicitly skipped:** H4 (MITM HTTPS proxy with root CA install) — operational burden not worth the compatibility gain.

**Other items deferred from the borrow list:** G4 (cloud sync via machine ID) and G5 (i18n framework with 32 locales) were flagged "recommend skip" in the original borrow list and are not assigned to any phase above. If either becomes a priority, add a dedicated phase at that point. Section J of the borrow list (9router's custom component library, Material Symbols, Monaco for forms, XY Flow, lowdb) is intentionally not in scope — darkraise-ui, Lucide, and SQLite already cover these needs.

**Dependencies:** Phase 6 for H3.

**Deliverables:** Per-key throttling enforced in an integration test, scope denials returning the right status codes, OAuth expiry alerts firing through notify, optional HTTPS dev server.

**Rough effort:** 3–5 days.

---

## Cross-cutting verification

Every phase ends with the same gates before committing:

1. `cd D:/Repositories/Personal/llm-proxy && go test ./...` exits 0
2. `cd D:/Repositories/Personal/llm-proxy/web && npm run build` exits 0
3. Manual smoke test of at least the routes touched by the phase
4. Commit message uses conventional format: `<type>(<scope>): <subject>` (feat, fix, refactor, etc.)

## Total effort estimate

Phase 0 is 1–2 days of work. Phases 1–8 total roughly 4–6 weeks of focused work. The roadmap phases can be re-ordered within their dependency constraints if priorities shift, but Phase 0 must land first.
