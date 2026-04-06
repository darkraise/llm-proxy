import { useMutation } from '@tanstack/react-query'
import { api } from '@/lib/api'

export function useOllamaDiscover() {
  return useMutation({
    mutationFn: (url: string) => api.ollama.discover(url),
  })
}
