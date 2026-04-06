export const KNOWN_MODELS: Record<string, string[]> = {
  openai: [
    'gpt-4.1', 'gpt-4.1-mini', 'gpt-4.1-nano',
    'gpt-4o', 'gpt-4o-mini',
    'o3', 'o3-mini', 'o4-mini',
    'gpt-4-turbo', 'gpt-4',
  ],
  openai_legacy: [
    'gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-4', 'gpt-3.5-turbo',
  ],
  anthropic: [
    'claude-sonnet-4-20250514',
    'claude-haiku-4-20250414',
    'claude-3-7-sonnet-20250219',
    'claude-3-5-sonnet-20241022',
    'claude-3-5-haiku-20241022',
    'claude-3-opus-20240229',
  ],
  google: [
    'models/gemini-2.5-pro', 'models/gemini-2.5-flash',
    'models/gemini-2.0-flash', 'models/gemini-2.0-flash-lite',
    'models/gemini-1.5-pro', 'models/gemini-1.5-flash',
  ],
  groq: [
    'llama-3.3-70b-versatile', 'llama-3.1-8b-instant',
    'llama-3.1-70b-versatile', 'gemma2-9b-it',
    'mixtral-8x7b-32768', 'deepseek-r1-distill-llama-70b',
  ],
  mistral: [
    'mistral-large-latest', 'mistral-medium-latest', 'mistral-small-latest',
    'codestral-latest', 'open-mistral-nemo',
  ],
  cohere: [
    'command-a-03-2025', 'command-r-plus-08-2024', 'command-r-08-2024',
    'embed-v4.0', 'embed-multilingual-v3.0', 'embed-english-v3.0',
  ],
  deepseek: [
    'deepseek-chat', 'deepseek-reasoner',
  ],
  xai: [
    'grok-3', 'grok-3-mini', 'grok-2',
  ],
  openrouter: [
    'openai/gpt-4o', 'openai/gpt-4o-mini',
    'anthropic/claude-sonnet-4', 'anthropic/claude-haiku-4',
    'google/gemini-2.5-flash', 'google/gemini-2.0-flash-001',
    'meta-llama/llama-3.3-70b-instruct',
    'deepseek/deepseek-r1',
  ],
  together: [
    'meta-llama/Llama-3.3-70B-Instruct-Turbo',
    'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo',
    'Qwen/Qwen2.5-72B-Instruct-Turbo',
    'deepseek-ai/DeepSeek-R1',
  ],
  fireworks: [
    'accounts/fireworks/models/llama-v3p3-70b-instruct',
    'accounts/fireworks/models/llama-v3p1-8b-instruct',
    'accounts/fireworks/models/deepseek-r1',
  ],
  cerebras: [
    'llama-3.3-70b', 'llama-3.1-8b',
  ],
  perplexity: [
    'sonar-pro', 'sonar', 'sonar-reasoning-pro', 'sonar-reasoning',
  ],
  nvidia: [
    'meta/llama-3.3-70b-instruct', 'meta/llama-3.1-8b-instruct',
    'nvidia/llama-3.1-nemotron-70b-instruct',
  ],
  sambanova: [
    'Meta-Llama-3.3-70B-Instruct', 'Meta-Llama-3.1-8B-Instruct',
    'DeepSeek-R1',
  ],
  ai21: [
    'jamba-1.5-large', 'jamba-1.5-mini',
  ],
  zhipu: [
    'glm-4-plus', 'glm-4-flash', 'glm-4',
  ],
  moonshot: [
    'moonshot-v1-auto', 'moonshot-v1-8k', 'moonshot-v1-32k',
  ],
  minimax: [
    'MiniMax-Text-01',
  ],
  yi: [
    'yi-lightning', 'yi-large',
  ],
  stepfun: [
    'step-2-16k', 'step-1-8k',
  ],
}

const EMBEDDING_PATTERNS = ['embed', 'bge', 'gte', 'e5', 'nomic', 'voyage', 'text-embedding']

export function filterModels(provider: string, discovered: string[]): string[] {
  const known = KNOWN_MODELS[provider]
  if (!known || known.length === 0) return discovered
  const knownSet = new Set(known)
  const filtered = discovered.filter((m) => knownSet.has(m))
  return filtered.length > 0 ? filtered : discovered
}

export function categorizeModels(models: string[]): { chat: string[]; embedding: string[] } {
  const chat: string[] = []
  const embedding: string[] = []
  for (const m of models) {
    const lower = m.toLowerCase()
    if (EMBEDDING_PATTERNS.some((p) => lower.includes(p))) {
      embedding.push(m)
    } else {
      chat.push(m)
    }
  }
  return { chat, embedding }
}

export function getDefaultSelection(provider: string, discovered: string[]): string[] {
  const known = KNOWN_MODELS[provider]
  if (!known || known.length === 0) {
    return discovered.length <= 20 ? [...discovered] : []
  }
  const knownSet = new Set(known)
  const filtered = discovered.filter((m) => knownSet.has(m))
  if (filtered.length > 0) return filtered
  return discovered.length <= 20 ? [...discovered] : []
}
