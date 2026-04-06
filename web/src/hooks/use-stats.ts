import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'

export function useStatsOverview(from?: string, to?: string) {
  return useQuery({
    queryKey: ['stats', 'overview', from, to],
    queryFn: () => api.stats.overview(from, to),
  })
}

export function useStatsRequests(params?: {
  account?: string
  status?: string
  model?: string
  from?: string
  to?: string
  min_latency?: number
  limit?: number
  offset?: number
}) {
  return useQuery({
    queryKey: ['stats', 'requests', params],
    queryFn: () => api.stats.requests(params),
  })
}

export function useStatsAccounts(from?: string, to?: string) {
  return useQuery({
    queryKey: ['stats', 'accounts', from, to],
    queryFn: () => api.stats.accounts(from, to),
  })
}

export function useStatsProviders(from?: string, to?: string) {
  return useQuery({
    queryKey: ['stats', 'providers', from, to],
    queryFn: () => api.stats.providers(from, to),
  })
}

export function useStatsModels(provider?: string, from?: string, to?: string) {
  return useQuery({
    queryKey: ['stats', 'models', provider, from, to],
    queryFn: () => api.stats.models(provider, from, to),
  })
}
