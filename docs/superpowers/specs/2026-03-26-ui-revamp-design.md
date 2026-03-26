# UI Revamp Design Spec

**Date:** 2026-03-26
**Status:** Draft
**Scope:** Full redesign of the LLM Proxy admin dashboard

## Overview

Full redesign of the React + Tailwind admin dashboard covering layout, navigation, visual identity, and component patterns. The dashboard serves dual purposes: monitoring (quick health checks) and configuration (account/rate-limit management). Target display is 2K screen with responsive support for smaller viewports.

## Design Principles

- **Warm & approachable:** Rounded corners, softer colors, friendly but professional (Notion/Supabase influence)
- **Information-dense without clutter:** Data-forward layouts with clear visual hierarchy
- **Consistent interaction patterns:** Side drawer for detail views across all pages
- **Responsive-first:** Designed for 2K screens, gracefully adapts down to tablet

## 1. Shell & Layout

### Collapsible Sidebar

Two states toggled by a button in the sidebar header. User preference persists via `localStorage`.

| Property | Expanded | Collapsed (Icon Rail) |
|---|---|---|
| Width | 220px | 60px |
| Navigation | Icon + label | Icon only (tooltip on hover) |
| Logo | Icon + "LLM Proxy" text | Icon only |
| Theme toggle | Icon + "Dark mode" + switch | Icon only |
| Transition | 200ms ease | 200ms ease |

**Navigation items** (top to bottom):
1. Dashboard — `LayoutGrid` icon
2. Accounts — `Users` icon
3. Rate Limits — `Activity` icon
4. Usage Logs — `FileText` icon
5. Settings — `Settings` icon

**Active state:** Subtle purple tint background (`rgba(124,91,240,0.12)`) with purple icon/text (`#a78bfa`).

**Inactive state:** Muted gray icon/text (`#7a7a8e`). Hover: slightly lighter background.

**Bottom section:** Theme toggle (moon/sun icon) separated by a border-top divider.

**Icon library:** Lucide React — monochrome, single-stroke, 18px nav / 14px inline.

### Theme System

Dark mode default with light mode toggle. All colors defined as CSS custom properties on `:root` (dark) and `[data-theme="light"]`.

**Dark palette:**

| Token | Value | Usage |
|---|---|---|
| `--surface` | `#1a1a2e` | Main background |
| `--surface-raised` | `#16162a` | Cards, sidebar |
| `--surface-overlay` | `#1e1e36` | Drawers, modals |
| `--border` | `rgba(255,255,255,0.06)` | Card/section borders |
| `--border-muted` | `rgba(255,255,255,0.03)` | Row dividers |
| `--text-primary` | `#e8e8f0` | Headings, values |
| `--text-secondary` | `#7a7a8a` | Labels, captions |
| `--text-muted` | `#7a7a8e` | Inactive nav, disabled |
| `--accent` | `#7c5bf0` | Primary action, charts |
| `--accent-light` | `#a78bfa` | Active nav, badges, links |
| `--accent-muted` | `rgba(124,91,240,0.12)` | Active nav background, hover |
| `--accent-gradient` | `linear-gradient(135deg,#7c5bf0,#5b8cf0)` | Logo, chart fills |
| `--success` | `#52c41a` | Healthy status, success badges |
| `--warning` | `#faad14` | Rate-limited, warning badges |
| `--error` | `#f85149` | Error status, error badges |

**Light palette:** Inverted — white/light gray surfaces, dark text, same accent colors. To be fully defined during implementation.

### Typography (2K-optimized)

| Element | Size | Weight | Font |
|---|---|---|---|
| Page title | 20px | 600 | System |
| Section heading | 14px | 500 | System |
| Nav item | 14px | 500 | System |
| Body / table cell | 14px | 400 | System |
| Card title | 15px | 600 | System |
| Stat value (card) | 16px | 600 | System |
| Stat value (dashboard) | 22px | 600 | System |
| Label / caption | 11-12px | 400 | System |
| Monospace (models, code) | 12-13px | 400 | Monospace stack |
| Badge text | 11px | 500 | System |

### Responsive Breakpoints

| Breakpoint | Sidebar | Grid Columns | Notes |
|---|---|---|---|
| `< 768px` | Icon rail (forced) | 1 column | Grid view only (no list), simplified filters |
| `768-1280px` | Collapsible | 2 columns | Both grid/list views |
| `1280px+` (2K) | Collapsible | 3 columns | Full layout, comfortable font sizes |
| `1440px+` | Collapsible | 3-4 columns | Optional 4-col if many accounts |

### Border Radius

| Element | Radius |
|---|---|
| Cards, drawers, modals | 12px |
| Nav items, buttons, inputs | 8px |
| Badges, chips, tags | 5px |
| Status dots | 50% (circle) |

## 2. Dashboard

Complete redesign as an analytics + status hub. Top-down flow layout.

### Header
- Page title: "Dashboard"
- Subtitle: "Overview of your LLM proxy"
- **Auto-refresh toggle:** Right-aligned. Pill with refresh icon + "Auto-refresh" label + toggle switch. Green when active. When enabled, polls every 5 seconds (same as current). Off by default.

### Summary Stats Row
4-column grid of stat cards:

| Card | Value | Subtext |
|---|---|---|
| Requests | Total today | `+N%` vs yesterday (green/red trend) — **requires backend: yesterday comparison data** |
| Tokens | Total today | Prompt in / completion out breakdown — **requires backend: `prompt_tokens` + `completion_tokens` in overview response** |
| Errors | Count today | Error rate percentage |
| Avg Latency | Milliseconds | `+/-N%` vs yesterday (green/red trend) — **requires backend: yesterday comparison data** |

Each stat card: `--surface` background, `--border` border, 12px radius. Small inline Lucide icon next to label.

### Chart + Account Status (Two-column)
- **Left (3fr):** Request Volume bar chart (24h, hourly buckets). Purple gradient bars. Recharts `BarChart`.
- **Right (2fr):** Account Status list. Each row: status dot (green/yellow/red/gray) + account name + request count or status text ("rate limited", "disabled"). Compact rows with subtle background.

### Tabbed Breakdown Section
Single card with 3 tabs:
- **By Provider:** Horizontal progress bars. Provider name + bar + percentage.
- **By Account:** Same layout, account names.
- **By Model:** Same layout, model names in monospace. Dropdown filter to scope by provider ("All Providers" default).

Active tab: Purple text + background tint. Inactive: muted gray.

### Data Requirements

**Backend changes required:**
- `GET /admin/api/stats/overview` — **extend** to include: yesterday's totals (for trend calculation), `prompt_tokens` + `completion_tokens` split (currently only returns `total_tokens`)
- `GET /admin/api/stats/accounts` — per-account breakdown (exists, no changes needed)
- `GET /admin/api/stats/providers` — **new endpoint**. Returns request count, token count, error count grouped by provider type. Derivable from accounts table joined with request_logs.
- `GET /admin/api/stats/models` — **new endpoint**. Returns request count, token count grouped by model. Accepts optional `?provider=<type>` query parameter for filtering. Derivable from request_logs grouped by model.
- `GET /admin/api/accounts` — account list for status strip (exists, no changes needed)

## 3. Accounts Page

### Page Header
- Title: "Accounts"
- Subtitle: "N accounts · M active"
- **View toggle:** Grid/list icon toggle (LayoutGrid / List icons). Persists via `localStorage`.
- **Add Account button:** Purple accent, "+" icon + "Add Account" label.

### Grid View (default)
3-column responsive grid of compact account cards.

**Card structure:**
1. **Header row:** Status dot (8px, colored) + Account name (15px, bold) + Provider badge (accent-muted background, 11px)
2. **Stats row:** Bordered top/bottom with `--border-muted`. Three inline stats:
   - Requests (count)
   - Tokens (compact: 1.2M)
   - Priority (number)
3. **Model row:** Default model chip (monospace, muted background) + "+N models" badge (accent-muted, clickable → opens drawer to Models tab)

**Card states:**
- **Healthy:** Green dot, full opacity
- **Rate-limited:** Yellow dot, full opacity
- **Error:** Red dot, full opacity
- **Disabled:** Gray dot, 50% opacity on entire card

**Hover:** Border shifts to `rgba(124,91,240,0.3)`. Cursor: pointer.
**Click:** Opens detail drawer.

### List View
Table with columns: Status (dot) | Name | Provider (badge) | Requests | Tokens | Priority | Default Model (monospace) | Models (count, purple).

- Header row with uppercase labels
- Hover highlight on rows
- Disabled rows at 50% opacity
- Click opens same detail drawer

### Detail Drawer
Slides in from right. 420px width. Overlays content area (cards/list dimmed behind).

**Header:** Status dot + Account name (15px bold) + action buttons (Test / Edit / Delete) + close X.

**Tabs:**
1. **Overview:** 2-column grid of key-value pairs (left-right layout — OK because drawer is fixed-width). Fields: Type, Priority, Default Model, Status, Base URL. Usage section: 3-column stat boxes (Requests, Tokens, Errors).
2. **Models:** Full scrollable list of all models. Each model as a row with model name in monospace. Searchable if >10 models.
3. **Rate Limits:** Embedded `RateLimitTable` component (same as Rate Limits page), scoped to this account.

**Edit mode:** Clicking "Edit" in the drawer header switches the Overview tab fields to editable inputs. Save/Cancel buttons appear at the bottom. This replaces the current modal-based edit flow.

**Delete confirmation:** Inline within drawer — "Are you sure?" with confirm/cancel buttons. No separate modal.

### Add Account Wizard
Keep the existing 3-step wizard flow but restyle to match the new design language:
1. **Step 1:** Account info (name, type, base URL, API key)
2. **Step 2:** Discover and select models
3. **Step 3:** Rate limits + priority + enabled toggle

Render as a modal overlay (centered, max-width 600px) with step indicator at top.

## 4. Rate Limits Page

**Scope: Restyle only.** Keep tab-per-provider structure and editable spreadsheet table.

Changes:
- Apply new color palette and border radius
- Tab styling: active tab = purple text + bottom border, inactive = muted gray
- Table cells: match new typography scale
- Editable cell focus: accent ring instead of blue
- "Refresh Models" section: restyle button and dropdown to match new design language

## 5. Usage Logs Page

### Page Header
- Title: "Usage Logs"
- Subtitle: "Request history and details"

### Enhanced Filter Bar
Card containing filters in a horizontal row:

| Filter | Type | Options |
|---|---|---|
| Account | Dropdown | All accounts / specific account |
| Model | Dropdown | All models / specific model |
| Status | Dropdown | All / Success (2xx) / Error (4xx/5xx) |
| Date Range | Date picker | Last 24h / Last 7d / Last 30d / Custom range — **requires backend: handler must parse `from`/`to` query params (struct supports it, handler does not)** |
| Min Latency | Number input | Any / threshold in ms — **requires backend: add `min_latency` query param to handler** |

"Apply" button at the end (accent style).

### Table
Columns: Timestamp (monospace) | Account | Model (monospace, truncated) | Endpoint | Status (colored badge) | Latency (right-aligned) | Tokens (right-aligned).

- Hover highlight on rows
- Click opens detail drawer
- Active row: subtle purple tint background

### Detail Drawer
Slides in from right. 320px width. Same pattern as Accounts drawer.

**Header:** "Request Detail" + close X.

**Content:** Three sections separated by border dividers. Left-right key-value layout (OK because fixed 320px width):

1. **Request:** Account, Model, Endpoint, Status Code
2. **Tokens:** Prompt Tokens, Completion Tokens, Total
3. **Performance:** Latency, Provider Type

**Error rows:** Additional section showing error message (from `error_message` field).

**Note:** Fields are limited to what exists in the `request_logs` schema. Method, Stream, and TTFB are not tracked and are out of scope unless the schema is extended.

**Navigation:** Clicking a different table row switches the drawer content (no close/reopen needed).

### Pagination
Bottom bar: "Showing N-M of T requests" (left) | Page navigation arrows + page indicator (center) | Per-page selector (right).

## 6. Settings Page

**Scope: Restyle only.** Keep 4 section cards.

Changes:
- Apply new card styling (12px radius, `--surface-raised` background, `--border`)
- Input fields: 8px radius, accent focus ring
- Toggle switches: match sidebar theme toggle style
- Buttons: match new button styles (accent for primary, muted for secondary)
- Section headings: match new typography scale

Sections (unchanged):
1. General Settings (timeout, retries, log retention)
2. Security (proxy auth toggle + API key, change admin password)
3. Ollama Fallback (enable toggle, URL, model, timeout)
4. Configuration (export/import YAML)

## 7. Shared Components

### Buttons
| Variant | Background | Text | Hover |
|---|---|---|---|
| Primary | `accent-muted` (15% opacity) | `accent-light` | 20% opacity bg |
| Secondary | `rgba(255,255,255,0.05)` | `text-secondary` | `rgba(255,255,255,0.08)` |
| Danger | transparent | `error` | `rgba(error, 0.1)` bg |

All buttons: 8px radius, 13px font, 500 weight, 6px 14px padding.

### Badges
| Variant | Background | Text |
|---|---|---|
| Accent | `rgba(124,91,240,0.1)` | `#a78bfa` |
| Success | `rgba(82,196,26,0.12)` | `#52c41a` |
| Warning | `rgba(250,173,20,0.12)` | `#faad14` |
| Error | `rgba(248,81,73,0.12)` | `#f85149` |
| Neutral | `rgba(255,255,255,0.05)` | `text-secondary` |

All badges: 5px radius, 11px font, 2px 10px padding.

### Inputs
- Background: `rgba(255,255,255,0.04)`
- Border: `rgba(255,255,255,0.1)`
- Focus: `accent` ring (2px)
- Radius: 8px
- Padding: 8px 12px
- Font size: 14px

### Toggle Switch
- Track: 36px wide, 20px tall, 10px radius
- On: accent color track, white knob (right)
- Off: muted track, gray knob (left)

### Drawer
- Width: 320-420px depending on content needs
- Background: `--surface-overlay`
- Left border: `rgba(255,255,255,0.08)`
- Header: 16px padding, bottom border divider
- Slide animation: 200ms ease from right
- Backdrop: content behind is dimmed (not blocked — still visible)

### Stat Card
- Background: `--surface` with `--border`
- 12px radius, 14-16px padding
- Label: `--text-secondary`, 11px, optional small Lucide icon
- Value: `--text-primary`, 20-24px, 600 weight
- Subtext: colored (success/error) or muted, 11px

## 8. Implementation Approach

**Hybrid — Shell + Pages:**

1. **Phase 1: Shell** — Collapsible sidebar, layout wrapper, theme system (CSS variables + toggle), core primitives (buttons, inputs, badges, toggle, drawer component)
2. **Phase 2: Dashboard** — Biggest change. New layout, tabbed breakdowns, auto-refresh toggle. May require new API endpoints for provider/model breakdowns.
3. **Phase 3: Accounts** — Grid/list toggle, compact cards, detail drawer, edit-in-drawer flow.
4. **Phase 4: Usage Logs** — Enhanced filters, side drawer for details.
5. **Phase 5: Rate Limits** — Restyle existing components.
6. **Phase 6: Settings** — Restyle existing sections.

### Dependencies
- `lucide-react` — icon library (add to package.json)
- `recharts` — already installed, keep for charts
- No new UI framework (keep Tailwind + custom components)

### Migration Strategy
Each phase can be deployed independently. The shell (Phase 1) provides the new layout wrapper; pages inside can be migrated one at a time. During migration, unconverted pages will look slightly inconsistent but remain functional.

## 9. Out of Scope

- Mobile-native app or PWA
- User management / multi-user auth
- Real-time WebSocket updates (keep polling)
- Cost tracking / billing integration
- Light mode full color palette definition (define during implementation)
