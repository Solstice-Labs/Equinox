/**
 * OpenAI-compatible chat client for profiling API-hosted models.
 *
 * Works against any endpoint speaking the chat-completions dialect — OpenAI,
 * DeepSeek, OpenRouter, vLLM, SGLang, MLX-LM, llama.cpp server, Ollama, … —
 * with exponential backoff on 429/5xx (honoring `Retry-After`) and optional
 * per-token logprobs (used by the api fingerprint backend for entropy /
 * commitment measurement; many hosted servers expose these, per the
 * chat-completions `logprobs` parameter).
 *
 * Config reads `EQUINOX_*` first, falling back to `DSH_*`:
 *   EQUINOX_API_BASE_URL / DSH_API_BASE_URL
 *   EQUINOX_API_KEY      / DSH_API_KEY
 *   EQUINOX_API_MODEL    / DSH_API_MODEL
 */

import type { ChatMessage, ChatOptions, ChatResult, ModelClient } from '../types.ts'

export interface OpenAIClientOptions {
  baseUrl?: string
  apiKey?: string
  model?: string
  /** Extra headers merged over defaults (e.g. provider-specific auth). */
  headers?: Record<string, string>
  /** Injectable fetch for tests. */
  fetchImpl?: typeof fetch
  maxRetries?: number
  /** Request timeout in ms (AbortSignal-backed). */
  timeoutMs?: number
  /** Env source for EQUINOX_* and DSH_* config (defaults to process.env). */
  env?: Readonly<Record<string, string | undefined>>
}

export interface TokenLogprob {
  token: string
  logprob: number
}

export interface SampleOptions {
  temperature?: number
  maxTokens?: number
  seed?: number
  /** Request `logprobs` and surface per-token values when the endpoint supports it. */
  logprobs?: boolean
  signal?: AbortSignal
}

export interface SampledResponse {
  text: string
  logprobs: TokenLogprob[] | null
}

interface ChatCompletionChoice {
  message?: { content?: string | null; role?: string }
  finish_reason?: string | null
}

interface ChatCompletionResponse {
  id?: string
  model?: string
  choices?: ChatCompletionChoice[]
  logprobs?: { content?: { token?: string; logprob?: number }[] } | null
}

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504])

function envValue(name: string, env: Readonly<Record<string, string | undefined>>): string | undefined {
  const equinox = env[`EQUINOX_${name}`]
  if (equinox !== undefined) return equinox
  return env[`DSH_${name}`]
}

function buildAuthHeaders(apiKey: string | undefined, extra: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...extra,
  }
  if (apiKey !== undefined) headers['Authorization'] = `Bearer ${apiKey}`
  return headers
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function parseRetryAfter(raw: string | null): number | null {
  if (raw === null) return null
  const seconds = Number.parseInt(raw.trim(), 10)
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null
}

/** OpenAI-compatible client: satisfies {@link ModelClient} and adds sampling. */
export class OpenAIClient implements ModelClient {
  readonly model: string
  readonly baseUrl: string
  private readonly apiKey: string | undefined
  private readonly headers: Record<string, string>
  private readonly fetchImpl: typeof fetch
  private readonly maxRetries: number
  private readonly timeoutMs: number

  constructor(options: OpenAIClientOptions = {}) {
    const env = options.env ?? process.env
    this.baseUrl = stripTrailingSlash(options.baseUrl ?? envValue('API_BASE_URL', env) ?? 'https://api.openai.com/v1')
    this.apiKey = options.apiKey ?? envValue('API_KEY', env)
    this.model = options.model ?? envValue('API_MODEL', env) ?? ''
    this.headers = buildAuthHeaders(this.apiKey, options.headers ?? {})
    this.fetchImpl = options.fetchImpl ?? fetch
    this.maxRetries = options.maxRetries ?? 3
    this.timeoutMs = options.timeoutMs ?? 120_000
  }

  /** Plain chat completion — the {@link ModelClient} contract. */
  async chat(messages: ChatMessage[], options: ChatOptions = {}): Promise<ChatResult> {
    const sampled = await this.sample(messages, {
      ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
      ...(options.maxTokens !== undefined ? { maxTokens: options.maxTokens } : {}),
      ...(options.signal !== undefined ? { signal: options.signal } : {}),
    })
    return {
      id: '',
      model: this.model,
      message: { role: 'assistant', content: sampled.text },
      finishReason: 'stop',
    }
  }

  /**
   * Sample a completion, optionally with per-token logprobs. Retries with
   * exponential backoff + jitter on retryable statuses, honoring Retry-After.
   */
  async sample(messages: ChatMessage[], options: SampleOptions = {}): Promise<SampledResponse> {
    const url = `${this.baseUrl}/chat/completions`
    const body = this.buildBody(messages, options)
    const signal = options.signal
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const controller = signal === undefined ? new AbortController() : undefined
      const timer = controller === undefined ? undefined : setTimeout(() => { controller.abort() }, this.timeoutMs)
      const fetchSignal = signal ?? (controller === undefined ? undefined : controller.signal)
      try {
        const response = await this.fetchImpl(url, {
          method: 'POST',
          headers: this.headers,
          body: JSON.stringify(body),
          ...(fetchSignal !== undefined ? { signal: fetchSignal } : {}),
        })
        if (response.status === 200) {
          const data = await response.json() as ChatCompletionResponse
          return this.parseSample(data)
        }
        if (RETRYABLE_STATUS.has(response.status)) {
          if (attempt < this.maxRetries) {
            const retryAfter = parseRetryAfter(response.headers.get('retry-after'))
            const baseDelay = retryAfter !== null ? retryAfter * 1000 : 500 * 2 ** attempt
            await sleep(baseDelay + Math.floor(Math.random() * 250))
            continue
          }
          throw new Error(`openai client: retries exhausted after ${attempt + 1} attempts (last HTTP ${response.status})`)
        }
        const detail = (await safeErrorText(response)) ?? ''
        throw new Error(`openai client: HTTP ${response.status}${detail === '' ? '' : ` — ${detail}`}`)
      } finally {
        if (timer !== undefined) clearTimeout(timer)
      }
    }
    // Unreachable: every iteration returns or throws; satisfies control-flow typing.
    throw new Error('openai client: retries exhausted')
  }

  private buildBody(messages: ChatMessage[], options: SampleOptions): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages: messages.map(m => ({
        role: m.role,
        content: m.content,
        ...(m.tool_call_id !== undefined ? { tool_call_id: m.tool_call_id } : {}),
        ...(m.name !== undefined ? { name: m.name } : {}),
      })),
    }
    if (options.temperature !== undefined) body['temperature'] = options.temperature
    if (options.maxTokens !== undefined) body['max_tokens'] = options.maxTokens
    if (options.seed !== undefined) body['seed'] = options.seed
    if (options.logprobs === true) {
      body['logprobs'] = true
      body['top_logprobs'] = 1
    }
    return body
  }

  private parseSample(data: ChatCompletionResponse): SampledResponse {
    const choice = data.choices?.[0]
    const text = choice?.message?.content ?? ''
    const logprobs: TokenLogprob[] = []
    for (const point of data.logprobs?.content ?? []) {
      const token = point.token
      const logprob = point.logprob
      if (token !== undefined && logprob !== undefined && Number.isFinite(logprob)) {
        logprobs.push({ token, logprob })
      }
    }
    return { text, logprobs: logprobs.length > 0 ? logprobs : null }
  }
}

/** Build a client from explicit options merged over the environment. */
export function apiClientFromEnv(options: OpenAIClientOptions = {}): OpenAIClient {
  return new OpenAIClient(options)
}

function stripTrailingSlash(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url
}

async function safeErrorText(response: Response): Promise<string | null> {
  try {
    const raw = await response.text()
    return raw.slice(0, 300)
  } catch {
    return null
  }
}
