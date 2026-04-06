import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, RateLimitDef } from '@/lib/api'

export function useRateLimits(provider: string | undefined) {
  return useQuery({
    queryKey: ['ratelimits', provider],
    queryFn: () => api.ratelimits.list(provider!),
    enabled: !!provider,
  })
}

export function useRateLimitDefaults(provider: string | undefined) {
  return useQuery({
    queryKey: ['ratelimits', provider, 'defaults'],
    queryFn: () => api.ratelimits.defaults(provider!),
    enabled: !!provider,
  })
}

export function useProviderMetrics(provider: string | undefined) {
  return useQuery({
    queryKey: ['provider-metrics', provider],
    queryFn: () => api.ratelimits.metrics(provider!),
    enabled: !!provider,
  })
}

export function useSetRateLimit() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (def: Omit<RateLimitDef, 'id'>) => api.ratelimits.set(def),
    onSuccess: (_data, variables) =>
      qc.invalidateQueries({ queryKey: ['ratelimits', variables.provider] }),
  })
}

export function useDeleteRateLimit() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.ratelimits.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ratelimits'] }),
  })
}

export function useSetProviderMetrics() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ provider, metrics }: { provider: string; metrics: string[] }) =>
      api.ratelimits.setMetrics(provider, metrics),
    onSuccess: (_data, variables) =>
      qc.invalidateQueries({ queryKey: ['provider-metrics', variables.provider] }),
  })
}
