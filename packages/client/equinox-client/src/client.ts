/**
 * Box-agnostic OpenAI-compatible HTTP client.
 *
 * Talks to any of: llama.cpp llama-server, Ollama, vLLM, SGLang, MLX-LM,
 * or any cloud API exposing `/chat/completions`. Retries 429/5xx with
 * exponential backoff + jitter, preferring the server's Retry-After.
 */

import type { ChatMessage, ChatOptions, ChatResult, ToolCall, Usage } from '@solsticeai/core'
import { loadConfig, type EquinoxConfig } from '@solsticeai/core'

import { SSEParser } from './stream.js'

export const PROVIDER_PRESETS: Record<string, { baseUrl: string }> = {
  ollama: { baseUrl: 'http://localhost:11434/v1' },
  'llama-server': { baseUrl: 'http://localhost:8080/v1' },
  vllm: { baseUrl: 'http://localhost:8000/v1' },
  sglang: { baseUrl: 'http://localhost:30000/v1' },
  'mlx-lm': { baseUrl: 'http://localhost:8080/v1' },
  openai: { baseUrl: 'https://api.openai.com/v1' },
}

export interface ClientOptions {
  baseUrl?: string
  apiKey?: string
  model?: string
  provider?: string
  timeoutMs?: number
  maxRetries?: number
  backoffBaseMs?: number
  fetchImpl?: typeof fetch
  config?: EquinoxConfig
}

export interface StreamChunk {
  content: string
  toolCalls?: ToolCall[]
  finishReason?: string
  usage?: Usage
}

const HIGH_WATER = 64

export class HttpError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message)
    this.name = 'HttpError'
  }
}

export class EquinoxClient {
  readonly baseUrl: string
  readonly model: string
  private readonly apiKey?: string
  private readonly timeoutMs: number
  private readonly maxRetries: number
  private readonly backoffBaseMs: number
  private readonly fetchImpl: typeof fetch

  constructor(options: ClientOptions = {}) {
    const cfg = options.config ?? loadConfig()
    const preset = options.provider ?? cfg.provider
    this.baseUrl = normalizeBase(options.baseUrl ?? cfg.baseUrl ?? (preset ? (PROVIDER_PRESETS[preset]?.baseUrl ?? cfg.baseUrl) : cfg.baseUrl))
    this.model = options.model ?? cfg.model
    this.apiKey = options.apiKey ?? cfg.apiKey
    this.timeoutMs = options.timeoutMs ?? cfg.timeoutMs ?? 60_000
    this.maxRetries = options.maxRetries ?? cfg.maxRetries ?? 3
    this.backoffBaseMs = options.backoffBaseMs ?? 500
    this.fetchImpl = options.fetchImpl ?? fetch
  }

  /** Not implemented in the base client; subclassed per benchmark harness. */
  static fromConfig(cfg: EquinoxConfig): EquinoxClient {
    return new EquinoxClient({ config: cfg })
  }

  async chat(messages: ChatMessage[], options: ChatOptions = {}): Promise<ChatResult> {
    if (options.stream === true) {
      return this.collectStream(messages, options)
    }
    const body: Record<string, unknown> = {
      model: this.model,
      messages,
      temperature: options.temperature,
      max_tokens: options.maxTokens,
      stop: options.stop,
      tools: options.tools,
    }
    const res = await this.request('/chat/completions', body, options)
    await ensureOk(res)
    const json = (await res.json()) as Record<string, any>
    const choice = json.choices?.[0]
    const rawMessage = choice?.message ?? {}
    const message: ChatMessage = {
      role: rawMessage.role ?? 'assistant',
      content: rawMessage.content ?? '',
    }
    if (Array.isArray(rawMessage.tool_calls)) {
      message.tool_calls = rawMessage.tool_calls.map((tc: any) => ({
        id: tc.id ?? '',
        name: tc.function?.name ?? '',
        arguments: parseToolArgs(tc.function?.arguments),
      }))
    }
    const usage = json.usage
    return {
      id: json.id ?? `chat-${Date.now()}`,
      model: json.model ?? this.model,
      message,
      finishReason: choice?.finish_reason ?? (message.tool_calls?.length ? 'tool_calls' : 'stop'),
      usage: {
        promptTokens: usage?.prompt_tokens ?? 0,
        completionTokens: usage?.completion_tokens ?? 0,
        totalTokens: usage?.total_tokens ?? 0,
      },
    }
  }

  /** Streaming chat with consumer-side backpressure (high-water queue). */
  async *chatStream(messages: ChatMessage[], options: ChatOptions = {}): AsyncGenerator<StreamChunk> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages,
      temperature: options.temperature,
      max_tokens: options.maxTokens,
      stop: options.stop,
      tools: options.tools,
      stream: true,
    }
    const res = await this.request('/chat/completions', body, options)
    await ensureOk(res)
    if (!res.body) throw new Error('streaming response has no body')
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    const sse = new SSEParser()
    const queue: StreamChunk[] = []
    let producerDone = false
    let producerError: unknown
    let wakeConsumer: (() => void) | null = null
    let wakeProducer: (() => void) | null = null

    const toolState = new Map<number, { id: string; name: string; args: string }>()

    sse.onEvent = (ev) => {
      const data = ev.data.trim()
      if (data === '' || data === '[DONE]') return
      const chunk = translateEvent(data, toolState)
      if (chunk) queue.push(chunk)
    }

    const produce = (async () => {
      try {
        while (true) {
          if (queue.length >= HIGH_WATER) {
            await new Promise<void>((resolve) => {
              wakeProducer = resolve
            })
          }
          const { value, done } = await reader.read()
          if (done) break
          sse.feed(decoder.decode(value, { stream: true }))
          if (sse.malformed > 0) {
            // tolerate and continue; malformed count is observable via client
          }
        }
        sse.finish()
      } catch (e) {
        producerError = e
      } finally {
        producerDone = true
        if (wakeConsumer) {
          const w: () => void = wakeConsumer
          wakeConsumer = null
          w()
        }
      }
    })()

    try {
      while (true) {
        while (queue.length === 0 && !producerDone && !producerError) {
          await new Promise<void>((resolve) => {
            wakeConsumer = resolve
          })
        }
        if (queue.length > 0) {
          yield queue.shift() as StreamChunk
          if (queue.length < HIGH_WATER && wakeProducer) {
            const w: () => void = wakeProducer
            wakeProducer = null
            w()
          }
          continue
        }
        if (producerError) throw producerError
        break
      }
    } finally {
      producerDone = true
      if (wakeProducer) (wakeProducer as () => void)()
      reader.cancel().catch(() => {})
    }
  }

  async models(): Promise<string[]> {
    const res = await this.request('/models', {}, {})
    await ensureOk(res)
    const json = (await res.json()) as { data?: { id: string }[] }
    return (json.data ?? []).map((m) => m.id)
  }

  async health(): Promise<boolean> {
    try {
      await this.models()
      return true
    } catch {
      return false
    }
  }

  private async request(path: string, body: Record<string, unknown>, options: ChatOptions): Promise<Response> {
    const url = this.baseUrl.replace(/\/+$/, '') + path
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    if (this.apiKey) headers['Authorization'] = `Bearer ${this.apiKey}`

    let attempt = 0
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs)
      const onAbort = () => controller.abort(options.signal?.reason)
      options.signal?.addEventListener('abort', onAbort)
      try {
        const res = await this.fetchImpl(url, {
          method: 'POST' as const,
          headers,
          body: JSON.stringify(body),
          signal: controller.signal,
        })
        if (!isRetryable(res.status)) return res
        if (attempt >= this.maxRetries) return res
        const delay = retryDelayMs(res, attempt, this.backoffBaseMs)
        await sleep(delay)
      } catch (e) {
        if (options.signal?.aborted) throw e
        if (attempt >= this.maxRetries) throw e
        await sleep(retryDelayMs(undefined, attempt, this.backoffBaseMs))
      } finally {
        clearTimeout(timeout)
        options.signal?.removeEventListener('abort', onAbort)
      }
      attempt++
    }
  }

  private async collectStream(messages: ChatMessage[], options: ChatOptions): Promise<ChatResult> {
    let content = ''
    const toolCalls: ToolCall[] = []
    let finishReason = 'stop'
    const usage: Usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
    for await (const chunk of this.chatStream(messages, options)) {
      content += chunk.content
      if (chunk.toolCalls) toolCalls.push(...chunk.toolCalls)
      if (chunk.finishReason) finishReason = chunk.finishReason
      if (chunk.usage) {
        usage.promptTokens = chunk.usage.promptTokens
        usage.completionTokens = chunk.usage.completionTokens
        usage.totalTokens = chunk.usage.totalTokens
      }
    }
    if (usage.completionTokens === 0) usage.completionTokens = estimateTokens(content)
    const message: ChatMessage = { role: 'assistant', content }
    if (toolCalls.length > 0) {
      message.tool_calls = toolCalls
      finishReason = finishReason === 'stop' ? 'tool_calls' : finishReason
    }
    return {
      id: `chat-${Date.now()}`,
      model: this.model,
      message,
      finishReason,
      usage: { ...usage, totalTokens: usage.promptTokens + usage.completionTokens },
    }
  }
}

async function ensureOk(res: Response): Promise<void> {
  if (res.ok) return
  const text = await res.text().catch(() => '')
  throw new HttpError(`request failed with status ${res.status}: ${text.slice(0, 300)}`, res.status)
}

function normalizeBase(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '')
  if (trimmed.endsWith('/chat/completions')) return trimmed.slice(0, -'/chat/completions'.length)
  return trimmed
}

function parseToolArgs(raw?: string): Record<string, unknown> {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    return typeof parsed === 'object' && parsed !== null ? parsed : {}
  } catch {
    return {}
  }
}

function isRetryable(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599)
}

function retryDelayMs(res: Response | undefined, attempt: number, baseMs: number): number {
  const retryAfter = parseRetryAfter(res?.headers.get('retry-after') ?? null)
  if (retryAfter !== undefined) return Math.min(30_000, retryAfter * 1000)
  const jitter = 0.5 + Math.random() * 0.5
  return Math.min(30_000, baseMs * 2 ** attempt * jitter)
}

function parseRetryAfter(value: string | null): number | undefined {
  if (value === null) return undefined
  const seconds = Number.parseInt(value, 10)
  if (Number.isNaN(seconds)) return undefined
  return Math.max(0, seconds)
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4))
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Translate a raw SSE `data:` payload from /chat/completions into a StreamChunk.
 * Malformed payloads are tolerated: returns null and leaves counting to the caller.
 */
export function translateEvent(data: string, toolState: Map<number, { id: string; name: string; args: string }>): StreamChunk | null {
  let json: any
  try {
    json = JSON.parse(data)
  } catch {
    return null
  }
  const choice = json.choices?.[0]
  const delta = choice?.delta ?? {}
  const toolCalls: ToolCall[] = []
  if (Array.isArray(delta.tool_calls)) {
    for (const tc of delta.tool_calls as any[]) {
      const idx = tc.index ?? 0
      const frag = toolState.get(idx) ?? { id: '', name: '', args: '' }
      if (tc.id) frag.id = tc.id
      if (tc.function?.name) frag.name = tc.function.name
      if (tc.function?.arguments) frag.args += tc.function.arguments
      const parsed = tryParseArgs(frag.args)
      toolState.set(idx, frag)
      if (frag.id && frag.name && parsed) {
        toolCalls.push({ id: frag.id, name: frag.name, arguments: parsed })
      }
    }
  }
  const usage = json.usage
  const chunk: StreamChunk = {
    content: typeof delta.content === 'string' ? delta.content : '',
    finishReason: choice?.finish_reason ?? undefined,
  }
  if (toolCalls.length > 0) chunk.toolCalls = toolCalls
  if (usage) {
    chunk.usage = {
      promptTokens: usage.prompt_tokens ?? 0,
      completionTokens: usage.completion_tokens ?? 0,
      totalTokens: usage.total_tokens ?? 0,
    }
  }
  if (chunk.content === '' && !chunk.toolCalls && !chunk.finishReason && !chunk.usage) return null
  return chunk
}

function tryParseArgs(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw)
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}