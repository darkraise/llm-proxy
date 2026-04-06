import { api, type Provider } from './api'

let cache: Provider[] | null = null
let loading: Promise<Provider[]> | null = null

export async function loadProviders(): Promise<Provider[]> {
  if (cache) return cache
  if (!loading) {
    loading = api.providers.list().then((list) => {
      cache = list
      return list
    }).catch(() => {
      cache = []
      return []
    })
  }
  return loading
}

export function getCachedProviders(): Provider[] {
  return cache ?? []
}

export function getDisplayName(providerName: string): string {
  const p = cache?.find((p) => p.name === providerName)
  return p?.display_name ?? providerName
}

export function invalidateCache() {
  cache = null
  loading = null
}
