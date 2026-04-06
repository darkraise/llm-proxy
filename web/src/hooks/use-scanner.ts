import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, AccountLimit, ScanKeyPattern, ScannerStatus } from '@/lib/api'

export function useScannerStatus() {
  return useQuery({
    queryKey: ['scanner', 'status'],
    queryFn: () => api.scanner.status(),
    refetchInterval: (query) =>
      (query.state.data as ScannerStatus | undefined)?.status.running ? 2000 : false,
  })
}

export function useScannerKeys(params?: {
  provider?: string
  source?: string
  valid?: string
  imported?: string
  limit?: number
  offset?: number
}) {
  return useQuery({
    queryKey: ['scanner', 'keys', params],
    queryFn: () => api.scanner.keys(params),
  })
}

export function useScannerHistory(limit?: number) {
  return useQuery({
    queryKey: ['scanner', 'history', limit],
    queryFn: () => api.scanner.history(limit),
  })
}

export function useScannerConfig() {
  return useQuery({
    queryKey: ['scanner', 'config'],
    queryFn: () => api.scanner.config(),
  })
}

export function useScannerPatterns(provider?: string) {
  return useQuery({
    queryKey: ['scanner', 'patterns', provider],
    queryFn: () => api.scanner.patterns(provider),
  })
}

export function useScannerStart() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (source?: string) => api.scanner.start(source),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['scanner'] }),
  })
}

export function useScannerStop() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.scanner.stop(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['scanner'] }),
  })
}

export function useValidateScannerKey() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.scanner.validateKey(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['scanner', 'keys'] }),
  })
}

export function useDiscoverScannerModels() {
  return useMutation({
    mutationFn: (id: number) => api.scanner.discoverModels(id),
  })
}

export function useImportScannerKey() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      models,
      name,
    }: {
      id: number
      models: Record<string, string[]>
      name?: string
    }) => api.scanner.importKey(id, models, name),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['scanner', 'keys'] })
      qc.invalidateQueries({ queryKey: ['accounts'] })
    },
  })
}

export function useBulkImportScannerKeys() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      ids,
      models,
      limits,
    }: {
      ids: number[]
      models: Record<string, string[]>
      limits?: AccountLimit[]
    }) => api.scanner.bulkImport(ids, models, limits),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['scanner', 'keys'] })
      qc.invalidateQueries({ queryKey: ['accounts'] })
    },
  })
}

export function useDeleteScannerKey() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.scanner.deleteKey(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['scanner', 'keys'] }),
  })
}

export function useBulkDeleteScannerKeys() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (ids: number[]) => api.scanner.bulkDelete(ids),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['scanner', 'keys'] }),
  })
}

export function useUpdateScannerConfig() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: { github_token?: string; delay_seconds?: number; max_pages?: number }) =>
      api.scanner.updateConfig(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['scanner', 'config'] }),
  })
}

export function useUpsertScannerPattern() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (p: Omit<ScanKeyPattern, 'id'> & { id?: number }) =>
      api.scanner.upsertPattern(p),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['scanner', 'patterns'] }),
  })
}

export function useDeleteScannerPattern() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.scanner.deletePattern(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['scanner', 'patterns'] }),
  })
}
