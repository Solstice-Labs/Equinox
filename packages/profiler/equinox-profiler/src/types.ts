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

export type CaptureBackend = 'hidden-states' | 'imatrix-proxy' | 'api' | 'none'

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
  /** False when the quant plan is an estimate, not derived from local weights. */
  tensorGrounded: boolean
  /** Behavioral fingerprint for API-hosted models (backend 'api'). */
  apiFingerprint?: ApiFingerprint
  /** Behavioral → tensor transfer when a locally profiled twin exists. */
  tensorForecast?: TensorForecast
}

/** Online (API-hosted) model fingerprint — behavioral, layer-free. */
export interface ApiCapabilityStats {
  domain: ProbeDomain
  /** Low-temperature correctness over the domain's probes. */
  baseScore: number
  /** Agreement of high-temperature repeats with the base verdict (0..1). */
  consistency: number
  /** Verdict invariance under prompt perturbation (null when unmeasured). */
  robustness: number | null
  /** Mean response-token entropy in bits (null when logprobs unavailable). */
  commitment: number | null
  /** |consistency − baseScore| — self-confidence miscalibration proxy. */
  calibrationError: number | null
  /** Number of API calls contributing to this domain's stats. */
  samples: number
}

export interface ApiFingerprint {
  backend: 'api'
  model: string
  /** Architecture family for twin matching (e.g. 'llama3', 'qwen2.5'). */
  family?: string
  /** Parameter count in billions for twin matching. */
  params?: number
  /** One entry per domain, in PROBE_DOMAINS order. */
  capabilities: ApiCapabilityStats[]
  /** Normalized blended capability vector in PROBE_DOMAINS order. */
  capabilityVector: number[]
  composite: number
  /** 1 − pooled pass/fail variance across repeated runs (activation-variance proxy). */
  stability: number
  /** Overall miscalibration (mean per-domain |consistency − baseScore|). */
  calibrationError: number | null
  /** Mean response-token entropy in bits over measured runs. */
  entropy: number | null
  /** Total API calls made for this fingerprint. */
  samples: number
  /** Whether the endpoint surfaced per-token logprobs. */
  logprobsAvailable: boolean
}

/** Locally profiled twin used to transfer tensor behavior to an API model. */
export interface ReferenceTwin {
  model: string
  family: string
  params: number
  backend: CaptureBackend
  quantPlan: QuantPlan
  layerCount?: number
}

export interface TensorForecast {
  /** True when a same-family + close-params twin grounded the plan. */
  grounded: boolean
  confidence: number
  /** Source twin model name when grounded. */
  twin?: string
  plan: QuantPlan
  rationale: string
}

/** Shape accepted by {@link @solsticeai/equinox-lightning} quant planners. */
export interface QuantPlanLike extends QuantPlan {}
