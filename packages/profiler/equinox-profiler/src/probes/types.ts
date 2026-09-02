import type { ProbeDomain, ProbeMessage, ProbeResult, ToolCall } from '@solsticeai/core'
import type { SandboxFS } from '@solsticeai/tools'

export interface ProbeFlowTurn {
  instruction: string
  /** Allowed tool names the model may use this turn. */
  tools: string[]
}

export interface ProbeFlow {
  turns: ProbeFlowTurn[]
  /** Deterministic state + transcript verification. */
  verify: (fs: SandboxFS, transcript: ToolCall[], results: string[]) => ProbeResult
}

export interface Probe {
  id: string
  domain: ProbeDomain
  title: string
  messages: ProbeMessage[]
  maxTokens?: number
  temperature?: number
  kind?: 'single' | 'tool-flow'
  flow?: ProbeFlow
  /** Required for kind === 'single'. */
  grader?: (output: string) => ProbeResult
}