import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'

export function useSettings() {
  return useQuery({
    queryKey: ['settings'],
    queryFn: () => api.settings.get(),
  })
}

export function useUpdateSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: Record<string, string>) => api.settings.update(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings'] }),
  })
}

export function useTestNotification() {
  return useMutation({
    mutationFn: () => api.notifications.test(),
  })
}
