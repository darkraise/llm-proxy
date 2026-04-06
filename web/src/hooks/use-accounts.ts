import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, AccountInput, BulkEditPayload } from '@/lib/api'

export function useAccounts() {
  return useQuery({
    queryKey: ['accounts'],
    queryFn: () => api.accounts.list(),
  })
}

export function useCreateAccount() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: AccountInput) => api.accounts.create(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['accounts'] }),
  })
}

export function useUpdateAccount() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: AccountInput }) =>
      api.accounts.update(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['accounts'] }),
  })
}

export function useDeleteAccount() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.accounts.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['accounts'] }),
  })
}

export function useBulkUpdateAccounts() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ ids, enabled }: { ids: number[]; enabled: boolean }) =>
      api.accounts.bulkUpdate(ids, enabled),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['accounts'] }),
  })
}

export function useBulkDeleteAccounts() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (ids: number[]) => api.accounts.bulkDelete(ids),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['accounts'] }),
  })
}

export function useBulkEditAccounts() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: BulkEditPayload) => api.accounts.bulkEdit(payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['accounts'] }),
  })
}

export function useTestAccount() {
  return useMutation({
    mutationFn: (id: number) => api.accounts.test(id),
  })
}

export function useDiscoverAccountModels() {
  return useMutation({
    mutationFn: (data: { type: string; base_url: string; api_key: string; free_only: boolean }) =>
      api.accounts.discover(data),
  })
}

export function useDiscoverAccountModelsById() {
  return useMutation({
    mutationFn: (id: number) => api.accounts.discoverByAccount(id),
  })
}

export function useGetAccountKey() {
  return useMutation({
    mutationFn: (id: number) => api.accounts.getKey(id),
  })
}

export function useChatTestAccount() {
  return useMutation({
    mutationFn: ({ id, model, message }: { id: number; model: string; message: string }) =>
      api.accounts.chatTest(id, model, message),
  })
}
