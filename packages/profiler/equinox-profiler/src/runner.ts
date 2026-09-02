import type { EquinoxClient } from '@solsticeai/client'
import type { ProbeOutcome, SuiteResult, ToolCall } from '@solsticeai/core'
import { SandboxFS } from '@solsticeai/tools'

import type { Probe } from './probes/index.js'
import { ALL_PROBES } from './probes/index.js'

export interface RunnerOptions {
  probes?: Probe[]
  concurrency?: number
  /** Replies used instead of a live endpoint (tests / dry runs). */
  mockReply?: (probe: Probe, turn: number) => string
  client?: EquinoxClient
}

const TOOL_FLOW_SYSTEM =
  'You control a sandbox with JSON tool calls. Respond with ONLY a single JSON object of the form {"tool":"<name>","args":{...}} per turn. Available tools: write_file, read_file, append_file, mkdir, ls, rm. Never wrap in markdown.'

const SANDBOX_TOOLS = ['write_file', 'read_file', 'append_file', 'mkdir', 'ls', 'rm'] as const
type SandboxToolName = (typeof SANDBOX_TOOLS)[number]

export class ToolFlowRunner {
  readonly transcript: ToolCall[]

  constructor(
    private readonly fs: SandboxFS,
    transcript?: ToolCall[],
  ) {
    this.transcript = transcript ?? []
  }

  runTool(tool: SandboxToolName, args: Record<string, unknown>): string {
    const result = executeSandboxTool(this.fs, tool, args)
    this.transcript.push({ id: `tf-${this.transcript.length + 1}`, name: tool, arguments: args })
    return result
  }
}

function executeSandboxTool(fs: SandboxFS, tool: SandboxToolName, args: Record<string, unknown>): string {
  try {
    switch (tool) {
      case 'write_file': {
        fs.write(String(args.path ?? ''), String(args.content ?? ''))
        return `ok: wrote ${args.path}`
      }
      case 'read_file': {
        const content = fs.read(String(args.path ?? ''))
        return content === '' ? '<empty file>' : content
      }
      case 'append_file': {
        const path = String(args.path ?? '')
        if (!fs.exists(path)) fs.write(path, '')
        fs.write(path, fs.read(path) + String(args.content ?? ''))
        return `ok: appended to ${path}`
      }
      case 'mkdir': {
        fs.mkdir(String(args.path ?? ''))
        return `ok: created ${args.path}`
      }
      case 'ls': {
        return fs.ls(String(args.path ?? '/')).join('\n')
      }
      case 'rm': {
        fs.rm(String(args.path ?? ''))
        return `ok: removed ${args.path}`
      }
      default:
        return 'unknown tool'
    }
  } catch (e) {
    return `error: ${(e as Error).message}`
  }
}

export async function runProbeSuite(options: RunnerOptions = {}): Promise<SuiteResult> {
  const probes = options.probes ?? ALL_PROBES
  const concurrency = options.concurrency ?? 4
  const startedAt = new Date().toISOString()
  const outcomes: ProbeOutcome[] = []
  const queue = [...probes]

  const worker = async () => {
    while (queue.length > 0) {
      const probe = queue.shift()
      if (!probe) return
      outcomes.push(await runProbe(probe, options))
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, Math.max(1, probes.length)) }, () => worker())
  await Promise.all(workers)

  const domainScores: Record<string, number> = {}
  for (const domain of ['syntax', 'coding', 'logic', 'tools', 'instructions'] as const) {
    const group = outcomes.filter((o) => o.domain === domain)
    domainScores[domain] = group.length === 0 ? 0 : group.reduce((s, o) => s + o.score, 0) / group.length
  }
  const composite = outcomes.length === 0 ? 0 : outcomes.reduce((s, o) => s + o.score, 0) / outcomes.length

  return {
    model: options.client?.model ?? 'mock',
    startedAt,
    finishedAt: new Date().toISOString(),
    outcomes,
    domainScores,
    composite,
  }
}

async function runProbe(probe: Probe, options: RunnerOptions): Promise<ProbeOutcome> {
  const started = Date.now()
  let pass = false
  let score = 0
  let detail = 'not run'
  let promptTokens = 0
  let completionTokens = 0

  if (probe.kind === 'tool-flow' && probe.flow) {
    const fs = new SandboxFS()
    const transcript: ToolCall[] = []
    const flowRunner = new ToolFlowRunner(fs, transcript)
    const results: string[] = []
    for (const [turnIndex, turn] of probe.flow.turns.entries()) {
      const reply = options.mockReply
        ? options.mockReply(probe, turnIndex)
        : await askForToolCall(options.client!, probe, turn.instruction)
      promptTokens += estimate(turn.instruction)
      completionTokens += estimate(reply)
      const calls = parseToolCalls(reply)
      if (calls.length === 0) {
        results.push(`malformed call: ${reply.slice(0, 120)}`)
        continue
      }
      for (const parsed of calls) {
        if (!turn.tools.includes(parsed.name)) {
          results.push(`${parsed.name}: unexpected tool`)
          continue
        }
        results.push(flowRunner.runTool(parsed.name as SandboxToolName, parsed.arguments))
      }
    }
    const result = probe.flow.verify(fs, flowRunner.transcript, results)
    pass = result.pass
    score = result.score
    detail = result.detail
  } else {
    const reply = options.mockReply
      ? options.mockReply(probe, 0)
      : await askForReply(options.client!, probe)
    promptTokens += estimate(probe.messages.map((m) => m.content).join(' '))
    completionTokens += estimate(reply)
    const result = probe.grader!(reply)
    pass = result.pass
    score = result.score
    detail = result.detail
  }

  return {
    id: probe.id,
    domain: probe.domain,
    title: probe.title,
    pass,
    score,
    detail,
    latencyMs: Date.now() - started,
    promptTokens,
    completionTokens,
  }
}

async function askForReply(client: EquinoxClient, probe: Probe): Promise<string> {
  const result = await client.chat(
    probe.messages.map((m) => ({ role: m.role, content: m.content })),
    { temperature: probe.temperature ?? 0.1, maxTokens: probe.maxTokens },
  )
  return result.message.content
}

async function askForToolCall(client: EquinoxClient, probe: Probe, instruction: string): Promise<string> {
  const result = await client.chat(
    [
      { role: 'system', content: TOOL_FLOW_SYSTEM },
      ...probe.messages.map((m) => ({ role: m.role, content: m.content })),
      { role: 'user', content: instruction },
    ],
    { temperature: 0.0, maxTokens: 300 },
  )
  return result.message.content
}

function parseToolCall(reply: string): ToolCall | null {
  const stripped = stripFences(reply)
  try {
    const parsed: unknown = JSON.parse(stripped)
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      typeof (parsed as { tool?: unknown }).tool === 'string' &&
      (parsed as { args?: unknown }).args !== null &&
      typeof (parsed as { args?: unknown }).args === 'object'
    ) {
      const p = parsed as { tool: string; args: Record<string, unknown> }
      return { id: 'call', name: p.tool, arguments: p.args }
    }
    return null
  } catch {
    return null
  }
}

/** Support one tool call or a JSON array of calls per turn. */
function parseToolCalls(reply: string): ToolCall[] {
  const single = parseToolCall(reply)
  if (single) return [single]
  try {
    const parsed: unknown = JSON.parse(stripFences(reply))
    if (Array.isArray(parsed)) {
      const calls: ToolCall[] = []
      for (const item of parsed) {
        if (
          item !== null &&
          typeof item === 'object' &&
          typeof (item as { tool?: unknown }).tool === 'string' &&
          (item as { args?: unknown }).args !== null &&
          typeof (item as { args?: unknown }).args === 'object'
        ) {
          calls.push({ id: 'call', name: (item as { tool: string }).tool, arguments: (item as { args: Record<string, unknown> }).args })
        }
      }
      return calls
    }
  } catch {
    return []
  }
  return []
}

function stripFences(reply: string): string {
  return reply
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '')
    .trim()
}

function estimate(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4))
}