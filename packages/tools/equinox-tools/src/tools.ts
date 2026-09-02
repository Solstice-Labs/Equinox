import type { JsonSchema } from '@solsticeai/core'

import type { SandboxFS } from './sandbox.js'

export interface ToolContext {
  fs: SandboxFS
  cwd: string
  /** Optional jail root on the real filesystem for run_command confinement. */
  root?: string
  env?: Record<string, string>
}

export interface ToolResult {
  ok: boolean
  output: string
  error?: string
}

export interface Tool {
  name: string
  description: string
  parameters: JsonSchema
  run(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> | ToolResult
}

export function result(output: string): ToolResult {
  return { ok: true, output }
}

export function fail(message: string): ToolResult {
  return { ok: false, output: '', error: message }
}