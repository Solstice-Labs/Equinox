/** Shared domain types for the Equinox monorepo. */

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

/** JSON Schema subset used to describe agent tools. */
export interface JsonSchema {
  type?: 'object'
  properties?: Record<string, unknown>
  required?: string[]
  additionalProperties?: boolean
}

export interface ToolSpec {
  name: string
  description: string
  parameters: JsonSchema
}

export interface ChatOptions {
  temperature?: number
  maxTokens?: number
  stop?: string[]
  tools?: ToolSpec[]
  stream?: boolean
  signal?: AbortSignal
}

export interface Usage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

export interface ChatResult {
  id: string
  model: string
  message: ChatMessage
  finishReason: string
  usage: Usage
}

export type ProbeDomain = 'syntax' | 'coding' | 'logic' | 'tools' | 'instructions'

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

/**
 * A deterministic probe. `grader` must be a pure, offline, heuristic validator
 * (no judge-model calls) — regex/AST/constraint-checking only.
 */
export interface Probe<T = unknown> {
  id: string
  domain: ProbeDomain
  title: string
  /** Prompt line(s) to send; `$ctx` placeholders can be filled by the runner. */
  messages: ProbeMessage[]
  maxTokens?: number
  temperature?: number
  /** 'tool-flow' probes run a 3-turn stateful tool session against a sandbox. */
  kind?: 'single' | 'tool-flow'
  grader: (output: string, ctx: T) => ProbeResult
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

export interface QuantRule {
  tier: 'f16' | 'q8_0' | 'q4_k_m' | 'iq2_xxs'
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

export interface LogEvent {
  seq: number
  ts: string
  type: string
  payload: unknown
  prevHash: string
  hash: string
}

export interface DpoTriple {
  prompt: string
  failedTrace: unknown[]
  verifiedTrace: unknown[]
  meta: Record<string, unknown>
}

export interface TeacherOutput {
  text: string
  steps: string[]
  toolCalls: ToolCall[]
}

export interface Runner {
  /** Spawn a teacher CLI/API and return its normalized output. */
  run(prompt: string, opts?: { timeoutMs?: number; model?: string }): Promise<TeacherOutput>
  name: string
}