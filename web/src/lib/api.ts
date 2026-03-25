// Typed API client for the LLM Proxy admin backend.
// All requests include credentials (session cookie) and auto-redirect on 401.

const BASE = '/admin/api'

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
    window.location.href = '/admin/login'
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

// ─── Types ─────────────────────────────────────────────────────────────────

export interface ProviderLimit {
  metric: string
  max_value: number
  window_secs: number
}

export interface ProviderStatus {
  available: boolean
  requests_today: number
  tokens_today: number
  last_error?: string
  rate_limited: boolean
}

export interface Provider {
  id: number
  name: string
  type: string
  base_url: string
  models: string // JSON array string
  priority: number
  enabled: boolean
  created_at: string
  updated_at: string
  limits: ProviderLimit[]
  status?: ProviderStatus
}

export interface ProviderInput {
  name: string
  type: string
  base_url: string
  api_key: string
  models: string[]
  priority: number
  enabled: boolean
  limits: ProviderLimit[]
}

export interface OverviewStats {
  total_requests: number
  success_count: number
  error_count: number
  avg_latency_ms: number
  total_tokens: number
  active_providers: number
  total_providers: number
}

export interface RequestLog {
  id: number
  timestamp: string
  provider_id?: number
  provider_name: string
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

export interface ProviderStats {
  provider_name: string
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

  // ─── Providers ───────────────────────────────────────────────────────────

  providers: {
    list: () => request<Provider[]>('GET', '/providers'),
    create: (data: ProviderInput) =>
      request<{ id: number; name: string }>('POST', '/providers', data),
    update: (id: number, data: ProviderInput) =>
      request<{ status: string }>('PUT', `/providers/${id}`, data),
    delete: (id: number) =>
      request<{ status: string }>('DELETE', `/providers/${id}`),
    test: (id: number) =>
      request<TestResult>('POST', `/providers/${id}/test`),
  },

  // ─── Stats ───────────────────────────────────────────────────────────────

  stats: {
    overview: () => request<OverviewStats>('GET', '/stats/overview'),
    requests: (params?: {
      provider?: string
      status?: string
      limit?: number
      offset?: number
    }) => {
      const qs = new URLSearchParams()
      if (params?.provider) qs.set('provider', params.provider)
      if (params?.status) qs.set('status', params.status)
      if (params?.limit != null) qs.set('limit', String(params.limit))
      if (params?.offset != null) qs.set('offset', String(params.offset))
      const query = qs.toString()
      return request<RequestLogsResponse>(
        'GET',
        `/stats/requests${query ? '?' + query : ''}`,
      )
    },
    providers: () => request<ProviderStats[]>('GET', '/stats/providers'),
  },

  // ─── Settings ────────────────────────────────────────────────────────────

  settings: {
    get: () => request<Record<string, string>>('GET', '/settings'),
    update: (data: Record<string, string>) =>
      request<{ status: string }>('PUT', '/settings', data),
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
