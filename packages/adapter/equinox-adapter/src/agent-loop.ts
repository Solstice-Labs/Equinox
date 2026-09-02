/**
 * Agent execution loop.
 *
 * Iterative tool-calling loop that records every event (model message, tool
 * call, tool result, error, final) into an append-only, hash-chained JSONL
 * trajectory log. Consecutive errors are surfaced to an optional hook so the
 * distiller can intercept the 2-failure threshold.
 */

import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ChatMessage, ChatOptions, ChatResult, LogEvent, ModelProfile, ToolSpec } from '@solsticeai/core'
import { AppendLog } from '@solsticeai/core'
import { SandboxFS, type Tool, type ToolContext } from '@solsticeai/tools'

export interface ChatLike {
  model: string
  chat(messages: ChatMessage[], opts?: ChatOptions): Promise<ChatResult>
}

export interface AgentLoopOptions {
  client: ChatLike
  task: string
  system?: string
  tools?: Tool[]
  profile?: ModelProfile
  temperature?: number
  logFile?: string
  sandboxRoot?: string
  maxSteps?: number
  onError?: (step: number, error: Error, consecutive: number) => void
}

export interface AgentRunResult {
  finalAnswer: string
  steps: number
  interrupted: boolean
  logFile: string
  events: LogEvent[]
}

export const FINAL_PREFIX = 'FINAL:'

export async function runAgentLoop(options: AgentLoopOptions): Promise<AgentRunResult> {
  const maxSteps = options.maxSteps ?? 24
  const logFile = options.logFile ?? join(tmpdir(), `equinox-session-${Date.now()}.jsonl`)
  const log = new AppendLog(logFile)
  const sandboxRoot = options.sandboxRoot ?? mkdtempSync(join(tmpdir(), 'equinox-agent-'))
  const ctx: ToolContext = { fs: new SandboxFS(), cwd: '/workspace', root: sandboxRoot }

  const system = options.system ?? [
    'You are an autonomous software engineering agent operating in a sandbox.',
    'Respond to tool calls with EXACTLY one JSON object {"tool":"<name>","args":{...}}. Finish with "FINAL: <answer>".',
  ].join('\n\n')

  const messages: ChatMessage[] = [
    { role: 'system', content: system },
    { role: 'user', content: options.task },
  ]
  const toolSpecs: ToolSpec[] = (options.tools ?? []).map((t) => ({
    name: t.name,
    description: t.description,
    parameters: { type: 'object', properties: t.parameters.properties, required: t.parameters.required },
  }))

  log.append('session_start', { model: options.client.model, task: options.task, maxSteps })

  let finalAnswer = ''
  let interrupted = true
  let consecutiveErrors = 0

  for (let step = 1; step <= maxSteps; step++) {
    let result: ChatResult
    try {
      result = await options.client.chat(messages, {
        tools: toolSpecs.length > 0 ? toolSpecs : undefined,
        temperature: options.temperature,
      })
    } catch (e) {
      const error = asError(e)
      consecutiveErrors++
      log.append('error', { step, message: error.message })
      options.onError?.(step, error, consecutiveErrors)
      continue
    }
    consecutiveErrors = 0
    log.append('model_message', { step, role: result.message.role, content: result.message.content, finishReason: result.finishReason })
    messages.push(result.message)

    const toolCalls = result.message.tool_calls ?? []
    if (toolCalls.length === 0) {
      // No tools: normal completion (or explicit FINAL marker).
      finalAnswer = result.message.content
      interrupted = false
      log.append('final', { step, answer: finalAnswer })
      return { finalAnswer, steps: step, interrupted, logFile, events: log.readAll() }
    }

    for (const call of toolCalls) {
      log.append('tool_call', { step, id: call.id, name: call.name, args: call.arguments })
      const tool = (options.tools ?? []).find((t) => t.name === call.name)
      let output: string
      let errored = false
      try {
        if (!tool) throw new Error(`unknown tool: ${call.name}`)
        const res = await tool.run(call.arguments, ctx)
        output = res.ok ? res.output : `ERROR: ${res.error ?? 'tool failed'}${res.output ? `\n${res.output}` : ''}`
        if (!res.ok) errored = true
      } catch (e) {
        output = `EXCEPTION: ${(e as Error).message}`
        errored = true
      }
      if (errored) {
        consecutiveErrors++
        log.append('error', { step, tool: call.name, message: output.slice(0, 300) })
        options.onError?.(step, new Error(output.slice(0, 300)), consecutiveErrors)
      } else {
        consecutiveErrors = 0
      }
      log.append('tool_result', { step, id: call.id, name: call.name, output: output.slice(0, 2048) })
      messages.push({ role: 'tool', tool_call_id: call.id, name: call.name, content: output })
    }
  }

  log.append('interrupted', { step: maxSteps, reason: 'max_steps_exceeded' })
  return { finalAnswer, steps: maxSteps, interrupted, logFile, events: log.readAll() }
}

function asError(e: unknown): Error {
  return e instanceof Error ? e : new Error(String(e))
}