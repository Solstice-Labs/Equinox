/**
 * Sub-agent teacher coordinator.
 *
 * Spawns frontier child CLI processes (claude / codex / gemini) or an
 * OpenAI-compatible API teacher, normalizes away idiosyncratic teacher styling,
 * and extracts the verified resolution trajectory (steps + tool calls).
 */

import { spawn } from 'node:child_process'

import type { EquinoxConfig, TeacherOutput, ToolCall } from '@solsticeai/core'
import { EquinoxClient } from '@solsticeai/client'

export type TeacherKind = 'api' | 'claude' | 'codex' | 'gemini'

export interface TeacherOptions {
  prompt: string
  timeoutMs?: number
  model?: string
}

export interface TeacherRunResult {
  ok: boolean
  output: TeacherOutput
  raw: string
  cmd: string[]
  error?: string
}

export interface SpawnResult {
  stdout: string
  stderr: string
  code: number | null
}

export type SpawnImpl = (cmd: string, args: string[], timeoutMs: number) => Promise<SpawnResult>

export function defaultSpawn(): SpawnImpl {
  return (cmd, args, timeoutMs) =>
    new Promise<SpawnResult>((resolve) => {
      const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] })
      let stdout = ''
      let stderr = ''
      const timer = setTimeout(() => {
        child.kill('SIGKILL')
        resolve({ stdout, stderr: `${stderr}\n[timed out after ${timeoutMs}ms]`, code: -1 })
      }, timeoutMs)
      child.stdout.on('data', (d) => (stdout += d.toString()))
      child.stderr.on('data', (d) => (stderr += d.toString()))
      child.on('error', (e) => {
        clearTimeout(timer)
        resolve({ stdout, stderr: stderr + e.message, code: -1 })
      })
      child.on('close', (code) => {
        clearTimeout(timer)
        resolve({ stdout, stderr, code })
      })
    })
}

/** argv for each teacher kind (override = EQUINOX_TEACHER_CMD). */
export function buildTeacherArgv(kind: TeacherKind, prompt: string, cmdOverride: string[] = []): string[] {
  if (cmdOverride.length > 0) return [...cmdOverride, prompt]
  switch (kind) {
    case 'claude':
      return ['claude', '-p', prompt, '--output-format', 'json']
    case 'codex':
      return ['codex', 'exec', '--json', '--skip-git-repo-check', prompt]
    case 'gemini':
      return ['gemini', '-p', prompt]
    case 'api':
      return []
  }
}

/** Parse teacher stdout into rough TeacherOutput; strict parsing happens per-kind. */
export function parseTeacherOutput(kind: TeacherKind, stdout: string): TeacherOutput {
  const text = normalizeTeacherText(stdout)
  if (kind === 'claude') {
    const claude = parseClaudeJson(stdout, text)
    if (claude) return claude
  }
  if (kind === 'codex') {
    const codex = parseCodexJsonl(stdout)
    if (codex) return codex
  }
  return { text, steps: extractSteps(text), toolCalls: [] }
}

function parseClaudeJson(stdout: string, fallbackText: string): TeacherOutput | null {
  // Claude Code print mode with --output-format json returns {"result": "..."}
  try {
    const parsed: unknown = JSON.parse(stdout)
    if (parsed !== null && typeof parsed === 'object') {
      const result = (parsed as { result?: unknown }).result
      if (typeof result === 'string') {
        const normalized = normalizeTeacherText(result)
        return { text: normalized, steps: extractSteps(normalized), toolCalls: [] }
      }
    }
    return null
  } catch {
    // stream-json mode: lines like {"type":"assistant","message":{"content":[...]}}
    const contents: string[] = []
    for (const line of stdout.split('\n')) {
      if (line.trim() === '') continue
      try {
        const ev = JSON.parse(line) as { type?: string; message?: { content?: unknown } }
        if (ev.type === 'assistant' || ev.type === 'stream_event') {
          const content = extractClaudeContent(ev.message?.content)
          if (content) contents.push(content)
        }
      } catch {
        // not a json line — ignore
      }
    }
    if (contents.length === 0) return null
    const text = normalizeTeacherText(contents.join('\n'))
    return { text, steps: extractSteps(text), toolCalls: [] }
  }
}

function extractClaudeContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((b) => (b && typeof b === 'object' && typeof (b as { text?: unknown }).text === 'string' ? (b as { text: string }).text : ''))
      .filter(Boolean)
      .join('\n')
  }
  return ''
}

function parseCodexJsonl(stdout: string): TeacherOutput | null {
  const toolCalls: ToolCall[] = []
  const texts: string[] = []
  for (const line of stdout.split('\n')) {
    if (line.trim() === '') continue
    try {
      const ev = JSON.parse(line) as { type?: string; content?: unknown; tool_name?: string; args?: unknown }
      if (ev.type === 'agent_message' && typeof ev.content === 'string') texts.push(ev.content)
      if (ev.type === 'exec' && ev.tool_name && ev.args && typeof ev.args === 'object') {
        toolCalls.push({ id: `codex-${toolCalls.length + 1}`, name: ev.tool_name, arguments: ev.args as Record<string, unknown> })
      }
    } catch {
      // ignore non-JSON lines
    }
  }
  if (texts.length === 0 && toolCalls.length === 0) return null
  const text = normalizeTeacherText(texts.join('\n'))
  return { text, steps: extractSteps(text), toolCalls }
}

/**
 * Normalize away idiosyncratic teacher styling: helper phrases, emoji, hr
 * lines, trailing artifacts; collapse whitespace while keeping line breaks.
 */
export function normalizeTeacherText(raw: string): string {
  let out = raw
    .replace(/\r/g, '')
    .replace(/^[\s\S]*?\u2714\s*/m, '') // checkbox glyph prefixes
    .replace(/^[^\S\n]*[🧠⚡🚀✨✅❌📝💡→]{1,3}[^\S\n]*/gm, '')
    .replace(/^I'?d?\s+(?:would\s+)?love\s+to\s+help[!.]?\s*/gi, '')
    .replace(/^I('| a)?m?\s+(happy to|glad to|here to)\s+help[.!]?\s*/gi, '')
    .replace(/^(Let me|I will|I'll|I would)\s+(help|start|begin|take a look)[^.]*\.\s*/gi, '')
    .replace(/^[-_]{3,}\s*$/gm, '')
    .replace(/^>\s*/gm, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  // Strip "Sure! / Certainly!" openers.
  out = out.replace(/^(Sure|Certainly|Absolutely|Of course)[,.!]?\s*/i, '')
  return out
}

/** Extract numbered / bulleted steps from normalized text. */
export function extractSteps(text: string): string[] {
  const steps: string[] = []
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*(?:\d+[.)]\s+|\*\s+|\-\s+)\s*(.+)$/)
    if (m && (m[1] as string).length > 2) steps.push((m[1] as string).trim())
  }
  return steps
}

export class TeacherCoordinator {
  constructor(
    private readonly config: EquinoxConfig,
    private readonly deps: { spawnImpl?: SpawnImpl; client?: Pick<EquinoxClient, 'chat' | 'model'> } = {},
  ) {}

  async teach(prompt: string, opts: Omit<TeacherOptions, 'prompt'> = {}): Promise<TeacherRunResult> {
    if (this.config.teacher === 'api') {
      return this.teachViaApi(prompt)
    }
    const timeoutMs = opts.timeoutMs ?? 300_000
    const cmd = buildTeacherArgv(this.config.teacher, prompt, this.config.teacherCmd)
    if (cmd.length === 0) return { ok: false, output: { text: '', steps: [], toolCalls: [] }, raw: '', cmd, error: 'no teacher command' }
    const spawnImpl = this.deps.spawnImpl ?? defaultSpawn()
    const spawned = await spawnImpl(cmd[0]!, cmd.slice(1), timeoutMs)
    if (spawned.code !== 0) {
      return {
        ok: false,
        output: { text: '', steps: [], toolCalls: [] },
        raw: spawned.stdout,
        cmd,
        error: `teacher exited ${spawned.code}: ${spawned.stderr.slice(0, 300)}`,
      }
    }
    return { ok: true, output: parseTeacherOutput(this.config.teacher, spawned.stdout), raw: spawned.stdout, cmd }
  }

  private async teachViaApi(prompt: string): Promise<TeacherRunResult> {
    const client = this.deps.client ?? EquinoxClient.fromConfig(this.config)
    try {
      const result = await client.chat(
        [
          {
            role: 'system',
            content:
              'You are a calibration teacher. Solve the task and respond with the final answer, then list every step you took as a numbered list. Be precise and minimal; no pleasantries.',
          },
          { role: 'user', content: prompt },
        ],
        { temperature: 0, maxTokens: 4096 },
      )
      const text = normalizeTeacherText(result.message.content)
      return { ok: true, output: { text, steps: extractSteps(text), toolCalls: [] }, raw: result.message.content, cmd: [] }
    } catch (e) {
      return { ok: false, output: { text: '', steps: [], toolCalls: [] }, raw: '', cmd: [], error: (e as Error).message }
    }
  }
}