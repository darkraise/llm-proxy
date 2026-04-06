import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'

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
    queryKey: ['logs', filters],
    queryFn: () => api.stats.requests(filters),
  })
}
