import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ProviderInput } from '@/lib/api'

export function useProviders() {
  return useQuery({
    queryKey: ['providers'],
    queryFn: () => api.providers.list(),
  })
}

export function useProvider(name: string | undefined) {
  return useQuery({
    queryKey: ['providers', name],
    queryFn: () => api.providers.get(name!),
    enabled: !!name,
  })
}

export function useCreateProvider() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: ProviderInput) => api.providers.create(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['providers'] }),
  })
}

export function useUpdateProvider() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ name, data }: { name: string; data: Partial<ProviderInput> }) =>
      api.providers.update(name, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['providers'] }),
  })
}

export function useDeleteProvider() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (name: string) => api.providers.delete(name),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['providers'] }),
  })
}
