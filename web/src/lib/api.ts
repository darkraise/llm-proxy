// Typed API client for the LLM Proxy admin backend.
// All requests include credentials (session cookie) and auto-redirect on 401.

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

// Providers with hardcoded base URLs — no need to show base URL field
export const FIXED_URL_PROVIDERS = new Set(['openai', 'groq', 'openrouter', 'cerebras', 'mistral', 'github', 'cohere', 'nvidia', 'llm7', 'google'])

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

// ─── Auth ──────────────────────────────────────────────────────────────────

export const api = {
  auth: {
    login: (password: string) =>
      request<void>('POST', '/auth/login', { password }),
    logout: () => request<void>('POST', '/auth/logout'),
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
    test: (id: number) =>
      request<TestResult>('POST', `/accounts/${id}/test`),
    discover: (data: { type: string; base_url: string; api_key: string; free_only: boolean }) =>
      request<DiscoverResult>('POST', '/accounts/discover', data),
    discoverByAccount: (id: number) =>
      request<DiscoverResult>('POST', `/accounts/${id}/discover`),
  },

  // ─── Rate Limit Definitions ──────────────────────────────────────────────

  ratelimits: {
    list: (provider: string) =>
      request<RateLimitDef[]>('GET', `/ratelimits/${provider}`),
    set: (def: Omit<RateLimitDef, 'id'>) =>
      request<{ status: string }>('PUT', '/ratelimits', def),
    delete: (id: number) =>
      request<{ status: string }>('DELETE', `/ratelimits/${id}`),
    defaults: (provider: string, models: string[]) =>
      request<AccountLimit[]>(
        'GET',
        `/ratelimits/${provider}/defaults${models.length > 0 ? '?models=' + models.join(',') : ''}`,
      ),
    metrics: (provider: string) =>
      request<string[]>('GET', `/provider-metrics/${provider}`),
    setMetrics: (provider: string, metrics: string[]) =>
      request<{ status: string }>('PUT', `/provider-metrics/${provider}`, metrics),
  },

  // ─── Stats ───────────────────────────────────────────────────────────────

  stats: {
    overview: (from?: string, to?: string) => {
      const qs = new URLSearchParams()
      if (from) qs.set('from', from)
      if (to) qs.set('to', to)
      const query = qs.toString()
      return request<OverviewStats>('GET', `/stats/overview${query ? '?' + query : ''}`)
    },
    requests: (params?: {
      account?: string
      status?: string
      model?: string
      from?: string
      to?: string
      min_latency?: number
      limit?: number
      offset?: number
    }) => {
      const qs = new URLSearchParams()
      if (params?.account) qs.set('account', params.account)
      if (params?.status) qs.set('status', params.status)
      if (params?.model) qs.set('model', params.model)
      if (params?.from) qs.set('from', params.from)
      if (params?.to) qs.set('to', params.to)
      if (params?.min_latency != null) qs.set('min_latency', String(params.min_latency))
      if (params?.limit != null) qs.set('limit', String(params.limit))
      if (params?.offset != null) qs.set('offset', String(params.offset))
      const query = qs.toString()
      return request<RequestLogsResponse>(
        'GET',
        `/stats/requests${query ? '?' + query : ''}`,
      )
    },
    accounts: (from?: string, to?: string) => {
      const qs = new URLSearchParams()
      if (from) qs.set('from', from)
      if (to) qs.set('to', to)
      const query = qs.toString()
      return request<AccountStats[]>('GET', `/stats/accounts${query ? '?' + query : ''}`)
    },
    providers: (from?: string, to?: string) => {
      const qs = new URLSearchParams()
      if (from) qs.set('from', from)
      if (to) qs.set('to', to)
      const query = qs.toString()
      return request<ProviderStats[]>('GET', `/stats/providers${query ? '?' + query : ''}`)
    },
    models: (provider?: string, from?: string, to?: string) => {
      const qs = new URLSearchParams()
      if (provider) qs.set('provider', provider)
      if (from) qs.set('from', from)
      if (to) qs.set('to', to)
      const query = qs.toString()
      return request<ModelStats[]>('GET', `/stats/models${query ? '?' + query : ''}`)
    },
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

  // ─── Config ──────────────────────────────────────────────────────────────

  config: {
    import: (yaml: string) =>
      request<{ imported: number }>('POST', '/config/import', undefined, yaml, {
        'Content-Type': 'application/x-yaml',
      }),
    exportUrl: () => `${BASE}/config/export`,
  },
}
