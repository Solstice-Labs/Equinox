/** Shared domain types for the Equinox tensor-plane profiler package. */

export type ProbeDomain = 'syntax' | 'coding' | 'logic' | 'tools' | 'instructions'

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool'

export interface ToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
}

export interface ChatMessage {
  role: ChatRole
  content: string
  tool_call_id?: string
  name?: string
  tool_calls?: ToolCall[]
}

export interface ChatOptions {
  temperature?: number
  maxTokens?: number
  stop?: string[]
  stream?: boolean
  signal?: AbortSignal
}

export interface ChatResult {
  id: string
  model: string
  message: ChatMessage
  finishReason: string
}

/**
 * Minimal box-agnostic model surface the probe runner talks to. Anything that
 * can answer chat-style requests satisfies it — Ollama, llama-server, vLLM,
 * MLX-LM, SGLang, or a cloud API via an OpenAI-compatible adapter. Deep
 * harness wiring to `@solsticeai/equinox-llm` lands with the adapter wave.
 */
export interface ModelClient {
  model: string
  chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResult>
}

export interface ProbeMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  tool_call_id?: string
  name?: string
}

export interface ProbeResult {
  pass: boolean
  score: number
  detail: string
}

export interface ProbeOutcome extends ProbeResult {
  id: string
  domain: ProbeDomain
  title: string
  latencyMs: number
  promptTokens: number
  completionTokens: number
}

export interface SuiteResult {
  model: string
  startedAt: string
  finishedAt: string
  outcomes: ProbeOutcome[]
  domainScores: Record<string, number>
  composite: number
}

/** Per-layer aggregated activation statistics (exact, from hidden states). */
export interface LayerMoments {
  layer: number
  variance: number
  kurtosis: number
  importance: number
  samples: number
}

/** Per-tensor proxy statistics (from llama-imatrix second moments). */
export interface TensorProxy {
  tensor: string
  layer: number
  meanSq: number
  columns: number
}

export type CaptureBackend = 'hidden-states' | 'imatrix-proxy' | 'none'

export type QuantTier = 'f16' | 'q8_0' | 'q4_k_m' | 'iq2_xxs'

export interface QuantRule {
  tier: QuantTier
  layers: number[]
}

export interface QuantPlan {
  baseType: string
  tokenEmbeddingType: string
  outputTensorType: string
  rules: QuantRule[]
}

export interface ModelProfile {
  schemaVersion: 1
  model: string
  backend: CaptureBackend
  generatedAt: string
  probeComposite: number
  domainScores: Record<string, number>
  layerStats: LayerMoments[]
  quantPlan: QuantPlan
  policy: {
    scratchpad: 'always' | 'on-error' | 'off'
    drift: number
    temperature: { code: number; reasoning: number; default: number }
  }
}

/** Shape accepted by {@link @solsticeai/equinox-lightning} quant planners. */
export interface QuantPlanLike extends QuantPlan {}
