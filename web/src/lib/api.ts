import { useAuthStore } from "@/features/auth/store"

const BASE = '/api'

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

function buildQuery(params: Record<string, string | number | boolean | undefined | null>): string {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue
    qs.set(k, String(v))
  }
  const s = qs.toString()
  return s ? '?' + s : ''
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  rawBody?: BodyInit,
  extraHeaders?: Record<string, string>,
): Promise<T> {
  const headers: Record<string, string> = { ...extraHeaders }
  let reqBody: BodyInit | undefined

  if (rawBody !== undefined) {
    reqBody = rawBody
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
    reqBody = JSON.stringify(body)
  }

  const res = await fetch(`${BASE}${path}`, {
    method,
    credentials: 'include',
    headers,
    body: reqBody,
  })

  if (res.status === 401) {
    useAuthStore.getState().clearAuth()
    window.location.href = '/login'
    throw new ApiError(401, 'Unauthorized')
  }

  if (!res.ok) {
    let msg = `HTTP ${res.status}`
    try {
      const err = await res.json()
      msg = err.error ?? msg
    } catch {
      // ignore parse error
    }
    throw new ApiError(res.status, msg)
  }

  const contentType = res.headers.get('Content-Type') ?? ''
  if (contentType.includes('application/json')) {
    return res.json() as Promise<T>
  }

  return res.text() as unknown as T
}

// ─── Model Categories ────────────────────────────────────────────────────────

export const MODEL_CATEGORIES = ['chat', 'embedding'] as const
export type ModelCategory = typeof MODEL_CATEGORIES[number]

export function parseCategorizedModels(raw: string): Record<string, string[]> {
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) return { chat: parsed } // legacy flat array
    return parsed
  } catch {
    return {}
  }
}

export function parseDefaultModels(raw: string): Record<string, string> {
  try {
    const parsed = JSON.parse(raw)
    if (typeof parsed === 'string') return { chat: parsed } // legacy single string
    return parsed
  } catch {
    return {}
  }
}

export interface ProviderLimit {
  metric: string
  max_value: number
  window_secs: number
}

export interface Provider {
  name: string
  display_name: string
  base_url: string
  models_url: string
  api_standard: string
  auth_type: string
  auth_header: string
  capabilities: string
  default_limits: string
  validation_steps: string
  is_builtin: boolean
  enabled: boolean
  created_at: string
  updated_at: string
}

export interface ValidationStep {
  step: string
  params?: Record<string, any>
}

export interface ProviderInput {
  name: string
  display_name: string
  base_url: string
  models_url: string
  api_standard: string
  auth_type: string
  auth_header: string
  capabilities: string[]
  validation_steps?: ValidationStep[]
  enabled: boolean
}

/** Format a number compactly (e.g. 1500 -> "1.5K", 2000000 -> "2M"). */
export function formatCompact(n: number): string {
  if (n >= 1_000_000 && n % 1_000_000 === 0) return `${n / 1_000_000}M`
  if (n >= 1_000_000) return `${parseFloat((n / 1_000_000).toFixed(1))}M`
  if (n >= 1_000 && n % 1_000 === 0) return `${n / 1_000}K`
  if (n >= 1_000) return `${parseFloat((n / 1_000).toFixed(1))}K`
  return String(n)
}

/** Flatten a categorized model map into a single array of model names. */
export function flattenModels(categorized: Record<string, string[]>): string[] {
  return Object.values(categorized).flat()
}

/** Build a reverse lookup: model name -> category. */
export function buildModelCategoryMap(categorized: Record<string, string[]>): Record<string, string> {
  const map: Record<string, string> = {}
  for (const [cat, models] of Object.entries(categorized)) {
    for (const m of models) map[m] = cat
  }
  return map
}

// ─── Types ─────────────────────────────────────────────────────────────────

export interface AccountLimit {
  model: string
  metric: string
  max_value: number
  window_secs: number
}

export interface MetricStatus {
  metric: string
  used: number
  max: number
}

export interface AccountStatus {
  available: boolean
  reason?: string
  metrics?: MetricStatus[]
}

export interface Account {
  id: number
  name: string
  type: string
  base_url: string
  models: string // JSON string: Record<string, string[]> (or legacy string[])
  priority: number
  enabled: boolean
  default_models: string // JSON string: Record<string, string> (or legacy string)
  created_at: string
  updated_at: string
  limits: AccountLimit[]
  status?: AccountStatus
  total_requests: number
  total_tokens: number
}

export interface AccountInput {
  name: string
  type: string
  base_url: string
  api_key: string
  models: Record<string, string[]>
  priority: number
  enabled: boolean
  default_models: Record<string, string>
  limits: AccountLimit[]
}

export interface DiscoverModel {
  id: string
  name: string
}

export interface DiscoverResult {
  models: DiscoverModel[]
}

export interface OllamaModel {
  name: string
  family: string
}

export interface KeyTestResult {
  valid: boolean
  status_code: number
  error?: string
  models?: string[]
  rate_limits?: Record<string, string>
  parsed_limits?: ProviderLimit[]
  info?: Record<string, any>
}

export interface ChatTestResult {
  status_code: number
  response: any
  rate_limits?: Record<string, string>
  error?: string
}

export interface RateLimitDef {
  id: number
  provider: string
  model: string  // '' for provider-level
  metric: string
  max_value: number
  window_secs: number
}

export interface OverviewStats {
  total_requests: number
  success_count: number
  error_count: number
  avg_latency_ms: number
  total_tokens: number
  prompt_tokens: number
  completion_tokens: number
  yesterday_requests: number
  yesterday_avg_latency_ms: number
  active_accounts: number
  total_accounts: number
}

export interface ProviderStats {
  provider: string
  total_requests: number
  total_tokens: number
  error_count: number
  avg_latency_ms: number
}

export interface ModelStats {
  model: string
  total_requests: number
  total_tokens: number
}

export interface RequestLog {
  id: number
  timestamp: string
  account_id?: number
  account_name: string
  provider_type: string
  model: string
  endpoint: string
  status: string
  latency_ms: number
  prompt_tokens: number
  completion_tokens: number
  status_code: number
  error_message?: string
}

export interface RequestLogsResponse {
  data: RequestLog[]
  total: number
}

export interface AccountStats {
  account_name: string
  total_requests: number
  success_count: number
  error_count: number
  avg_latency_ms: number
  prompt_tokens: number
  completion_tokens: number
}

export interface TestResult {
  success: boolean
  status_code?: number
  error?: string
}

export interface BulkEditPayload {
  ids: number[]
  models?: Record<string, string[]>
  default_models?: Record<string, string>
  limits?: AccountLimit[]
}

// ─── Scanner Types ─────────────────────────────────────────────────────────

export interface DiscoveredKey {
  id: number
  key_hash: string
  masked_key: string
  provider: string
  source: string
  source_url: string
  source_repo: string
  source_file: string
  valid: boolean | null
  imported: boolean
  account_id?: number
  discovered_at: string
  tested_at?: string
  imported_at?: string
}

export interface ScannerStatusInner {
  running: boolean
  source: string
  provider: string
  keys_found: number
  keys_new: number
  patterns_total: number
  patterns_done: number
  started_at?: string
  completed_at?: string
  error?: string
}

export interface ScannerConfig {
  delay_seconds: number
  max_pages: number
}

export interface ScannerStatus {
  status: ScannerStatusInner
  total: number
  valid: number
  imported: number
  providers_count: number
  sources: string[]
  config: ScannerConfig
}

export interface ScanHistory {
  id: number
  source: string
  started_at: string
  completed_at?: string
  status: string
  keys_found: number
  keys_new: number
  keys_valid: number
  error_message?: string
}

export interface ScanKeyPattern {
  id: number
  provider: string
  prefix: string
  regex: string
  search_term: string
  enabled: boolean
}

export interface ScannerConfigResponse {
  github_token_configured: boolean
  github_token_masked: string
  delay_seconds: number
  max_pages: number
}

// ─── Auth ──────────────────────────────────────────────────────────────────

export const api = {
  auth: {
    login: (password: string) =>
      request<void>('POST', '/auth/login', { password }),
    logout: () => request<void>('POST', '/auth/logout'),
  },

  // ─── Providers ────────────────────────────────────────────────────────────

  providers: {
    list: () => request<Provider[]>('GET', '/providers'),
    get: (name: string) => request<Provider>('GET', `/providers/${name}`),
    create: (data: ProviderInput) => request<{ status: string }>('POST', '/providers', data),
    update: (name: string, data: Partial<ProviderInput>) =>
      request<{ status: string }>('PUT', `/providers/${name}`, data),
    delete: (name: string) => request<{ status: string }>('DELETE', `/providers/${name}`),
  },

  // ─── Accounts ────────────────────────────────────────────────────────────

  accounts: {
    list: () => request<Account[]>('GET', '/accounts'),
    create: (data: AccountInput) =>
      request<{ id: number; name: string }>('POST', '/accounts', data),
    update: (id: number, data: AccountInput) =>
      request<{ status: string }>('PUT', `/accounts/${id}`, data),
    delete: (id: number) =>
      request<{ status: string }>('DELETE', `/accounts/${id}`),
    bulkUpdate: (ids: number[], enabled: boolean) =>
      request<{ status: string }>('PATCH', '/accounts/bulk', { ids, enabled }),
    bulkDelete: (ids: number[]) =>
      request<{ deleted: number }>('POST', '/accounts/bulk-delete', { ids }),
    bulkEdit: (payload: BulkEditPayload) =>
      request<{ status: string }>('POST', '/accounts/bulk-edit', payload),
    test: (id: number) =>
      request<TestResult>('POST', `/accounts/${id}/test`),
    discover: (data: { type: string; base_url: string; api_key: string; free_only: boolean }) =>
      request<DiscoverResult>('POST', '/accounts/discover', data),
    discoverByAccount: (id: number) =>
      request<DiscoverResult>('POST', `/accounts/${id}/discover`),
    getKey: (id: number) =>
      request<{ key: string }>('GET', `/accounts/${id}/key`),
    chatTest: (id: number, model: string, message: string) =>
      request<ChatTestResult>('POST', `/accounts/${id}/chat-test`, { model, message }),
  },

  // ─── Rate Limit Definitions ──────────────────────────────────────────────

  ratelimits: {
    list: (provider: string) =>
      request<RateLimitDef[]>('GET', `/ratelimits/${provider}`),
    set: (def: Omit<RateLimitDef, 'id'>) =>
      request<{ status: string }>('PUT', '/ratelimits', def),
    delete: (id: number) =>
      request<{ status: string }>('DELETE', `/ratelimits/${id}`),
    defaults: (provider: string) =>
      request<AccountLimit[]>('GET', `/ratelimits/${provider}/defaults`),
    metrics: (provider: string) =>
      request<string[]>('GET', `/provider-metrics/${provider}`),
    setMetrics: (provider: string, metrics: string[]) =>
      request<{ status: string }>('PUT', `/provider-metrics/${provider}`, metrics),
  },

  // ─── Stats ───────────────────────────────────────────────────────────────

  stats: {
    overview: (from?: string, to?: string) =>
      request<OverviewStats>('GET', `/stats/overview${buildQuery({ from, to })}`),
    requests: (params?: {
      account?: string
      status?: string
      model?: string
      from?: string
      to?: string
      min_latency?: number
      limit?: number
      offset?: number
    }) =>
      request<RequestLogsResponse>('GET', `/stats/requests${buildQuery(params ?? {})}`),
    accounts: (from?: string, to?: string) =>
      request<AccountStats[]>('GET', `/stats/accounts${buildQuery({ from, to })}`),
    providers: (from?: string, to?: string) =>
      request<ProviderStats[]>('GET', `/stats/providers${buildQuery({ from, to })}`),
    models: (provider?: string, from?: string, to?: string) =>
      request<ModelStats[]>('GET', `/stats/models${buildQuery({ provider, from, to })}`),
  },

  // ─── Settings ────────────────────────────────────────────────────────────

  settings: {
    get: () => request<Record<string, string>>('GET', '/settings'),
    update: (data: Record<string, string>) =>
      request<{ status: string }>('PUT', '/settings', data),
  },

  // ─── Notifications ───────────────────────────────────────────────────────

  notifications: {
    test: () => request<{ success: boolean; error?: string }>('POST', '/notifications/test'),
  },

  ollama: {
    discover: (url: string) =>
      request<OllamaModel[]>('POST', '/ollama/discover', { url }),
  },

  keys: {
    test: (provider: string, key: string) =>
      request<KeyTestResult>('POST', '/keys/test', { provider, key }),
    chatTest: (provider: string, key: string, model: string, message: string) =>
      request<ChatTestResult>('POST', '/keys/chat-test', { provider, key, model, message }),
  },

  // ─── Config (accounts import/export) ────────────────────────────────────

  config: {
    import: (yaml: string) =>
      request<{ imported: number }>('POST', '/config/import', undefined, yaml, {
        'Content-Type': 'application/x-yaml',
      }),
    exportUrl: () => `${BASE}/config/export`,
  },

  // ─── Settings import/export ────────────────────────────────────────────

  settingsConfig: {
    import: (yaml: string) =>
      request<{ status: string }>('POST', '/settings/import', undefined, yaml, {
        'Content-Type': 'application/x-yaml',
      }),
    exportUrl: () => `${BASE}/settings/export`,
  },

  // ─── Scanner ─────────────────────────────────────────────────────────────

  scanner: {
    status: () => request<ScannerStatus>('GET', '/scanner/status'),
    start: (source?: string) =>
      request<{ status: string }>('POST', '/scanner/start', source ? { source } : {}),
    stop: () => request<{ status: string }>('POST', '/scanner/stop'),
    keys: (params?: { provider?: string; source?: string; valid?: string; imported?: string; limit?: number; offset?: number }) =>
      request<{ data: DiscoveredKey[]; total: number }>('GET', `/scanner/keys${buildQuery(params ?? {})}`),
    validateKey: (id: number) =>
      request<DiscoveredKey>('POST', `/scanner/keys/${id}/validate`),
    discoverModels: (id: number) =>
      request<DiscoverResult>('POST', `/scanner/keys/${id}/discover`),
    chatTest: (id: number, model: string, message: string) =>
      request<ChatTestResult>('POST', `/scanner/keys/${id}/chat-test`, { model, message }),
    importKey: (id: number, models: Record<string, string[]>, name?: string) =>
      request<{ id: number }>('POST', `/scanner/keys/${id}/import`, { models, name }),
    bulkImport: (ids: number[], models: Record<string, string[]>, limits?: AccountLimit[]) =>
      request<{ imported: number }>('POST', '/scanner/keys/import', { ids, models, limits }),
    deleteKey: (id: number) =>
      request<{ status: string }>('DELETE', `/scanner/keys/${id}`),
    bulkDelete: (ids: number[]) =>
      request<{ deleted: number }>('POST', '/scanner/keys/delete', { ids }),
    history: (limit?: number) =>
      request<ScanHistory[]>('GET', `/scanner/history${buildQuery({ limit })}`),
    config: () => request<ScannerConfigResponse>('GET', '/scanner/config'),
    updateConfig: (data: {
      github_token?: string; delay_seconds?: number; max_pages?: number;
    }) => request<{ status: string }>('PUT', '/scanner/config', data),
    patterns: (provider?: string) =>
      request<ScanKeyPattern[]>('GET', `/scanner/patterns${buildQuery({ provider })}`),
    upsertPattern: (p: Omit<ScanKeyPattern, 'id'> & { id?: number }) =>
      request<{ status: string }>('PUT', '/scanner/patterns', p),
    deletePattern: (id: number) =>
      request<{ status: string }>('DELETE', `/scanner/patterns/${id}`),
    exportUrl: (params?: { provider?: string; valid?: string }) =>
      `${BASE}/scanner/export${buildQuery(params ?? {})}`,
  },
}
