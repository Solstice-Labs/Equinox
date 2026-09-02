/**
 * Dynamic adapter: wraps prompts with harness instructions, injects `<thinking>`
 * scratchpads when composite drift exceeds the policy threshold, anchors syntax
 * guidance toward weak domains, and selects per-task temperatures.
 */

import type { ModelProfile, ProbeDomain } from '@solsticeai/core'
import type { Tool } from '@solsticeai/tools'

export type TaskKind = 'code' | 'reasoning' | 'general'

export interface AdapterOptions {
  profile?: ModelProfile
  task?: string
  tools?: Tool[]
}

export interface SystemPromptResult {
  system: string
  temperature: number
  taskKind: TaskKind
}

const TOOL_GRAMMAR = `TOOL GRAMMAR (always follow):
- When you need to interact with the environment, respond with EXACTLY ONE JSON object per turn: {"tool": "<name>", "args": {...}} — no markdown, no prose around it.
- After a tool result, either call another tool or give your final answer beginning with exactly "FINAL: ".
- Never invent file contents. Read first, edit second, verify third.
- Keep tool arguments minimal and exact (use view_file windows; do not dump whole files).`

export function toolGrammar(): string {
  return TOOL_GRAMMAR
}

export function buildToolDescriptions(tools: Tool[]): string {
  if (tools.length === 0) return '(no tools attached)'
  return tools
    .map((t) => `- ${t.name}: ${t.description} (args: ${JSON.stringify(t.parameters.properties ?? {})})`)
    .join('\n')
}

/** `<thinking>` scratchpad injection driven by the profile policy. */
export function scratchpadSection(profile: ModelProfile | undefined): string {
  if (!profile) return ''
  const mode = profile.policy.scratchpad
  if (mode === 'off') return ''
  if (mode === 'always') {
    return `THINKING SCRATCHPAD (required): Before EVERY tool call, emit a short <thinking> block on its own line containing: (1) the goal of this step, (2) the expected tool result, (3) a fallback if it fails. Then emit the tool call JSON.`
  }
  return `THINKING SCRATCHPAD (on error): if a tool fails, emit a short <thinking> block explaining what went wrong and the revised plan before retrying.`
}

/** Syntax anchoring: name weak domains so the model compensates explicitly. */
export function syntaxAnchors(profile: ModelProfile | undefined): string {
  if (!profile) return ''
  const weak = (Object.entries(profile.domainScores) as [ProbeDomain, number][])
    .filter(([, score]) => score < 0.5)
    .map(([domain]) => domain)
  if (weak.length === 0) return ''
  const advice: Record<ProbeDomain, string> = {
    syntax: 'prefer explicit JSON with strict escaping; always use fenced code blocks.',
    coding: 'write short, parseable code; prefer arrow functions and explicit types.',
    logic: 'break the problem into steps; enumerate constraints before solving; verify answers against every constraint.',
    tools: 'make small, verifiable tool calls; read results before acting on them.',
    instructions: 're-read constraints before answering; keep to the exact requested format.',
  }
  const bullets = weak.map((d) => `- [weak: ${d}] ${advice[d]}`).join('\n')
  return `FORMAT ANCHORS (profile shows weak areas):\n${bullets}`
}

/** Temperature policy: T=0.1 for code, T=0.6 for reasoning (profile-aware). */
export function selectTemperature(profile: ModelProfile | undefined, task: string, kind?: TaskKind): number {
  const kindResolved = kind ?? classifyTask(task)
  const temps = profile?.policy.temperature
  if (!temps) return kindResolved === 'code' ? 0.1 : kindResolved === 'reasoning' ? 0.6 : 0.4
  if (kindResolved === 'code') return temps.code
  if (kindResolved === 'reasoning') return temps.reasoning
  return temps.default
}

const CODE_RE = /\b(fix|build|implement|refactor|debug|compile|function|class|interface|\.ts\b|\.js\b|bug|test|unit|api|endpoint|regex|async|await)\b/i
const REASON_RE = /\b(logic|prove|derive|schedule|constraint|optimiz|plan|reason|deduc|puzzle|solve|satisf|proof|sort|search|graph)\b/i

export function classifyTask(task: string): TaskKind {
  const codeHits = (task.match(CODE_RE) ?? []).length
  const reasonHits = (task.match(REASON_RE) ?? []).length
  if (codeHits > reasonHits && codeHits > 0) return 'code'
  if (reasonHits > 0) return 'reasoning'
  return 'general'
}

/** Build the full harness system prompt for a run. */
export function buildSystemPrompt(options: AdapterOptions): SystemPromptResult {
  const { profile, task, tools } = options
  const parts: string[] = [
    'You are an autonomous software engineering agent (Project Equinox). You operate inside a sandbox and accomplish the task below.',
    toolGrammar(),
    `AVAILABLE TOOLS:\n${buildToolDescriptions(tools ?? [])}`,
  ]
  const scratch = scratchpadSection(profile)
  if (scratch) parts.push(scratch)
  const anchors = syntaxAnchors(profile)
  if (anchors) parts.push(anchors)
  const taskLine = task ? `TASK:\n${task}` : ''
  return {
    system: parts.join('\n\n') + (taskLine ? `\n\n${taskLine}` : ''),
    temperature: selectTemperature(profile, task ?? ''),
    taskKind: classifyTask(task ?? ''),
  }
}