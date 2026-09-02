import { rmSync } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { runAgentLoop } from '@solsticeai/adapter'
import { viewFileTool } from '@solsticeai/tools'
import type { ChatMessage, ChatOptions, ChatResult } from '@solsticeai/core'

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

function scriptedClient(script: (step: number, messages: ChatMessage[]) => ChatResult): {
  model: string
  chat: (messages: ChatMessage[], opts?: ChatOptions) => Promise<ChatResult>
} {
  let step = 0
  return {
    model: 'mock-model',
    chat: async (messages) => {
      step++
      return script(step, messages)
    },
  }
}

describe('runAgentLoop', () => {
  it('completes immediately without tools', async () => {
    const client = scriptedClient(() => ({
      id: 'c1',
      model: 'mock-model',
      message: { role: 'assistant', content: 'FINAL: done' },
      finishReason: 'stop',
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    }))
    const dir = mkdtempSync(join(tmpdir(), 'equinox-loop-'))
    dirs.push(dir)
    const res = await runAgentLoop({ client, task: 'say hi', logFile: join(dir, 's.jsonl') })
    expect(res.finalAnswer).toBe('FINAL: done')
    expect(res.interrupted).toBe(false)
    expect(res.steps).toBe(1)
    expect(res.events[0]!.type).toBe('session_start')
    expect(res.events.some((e) => e.type === 'final')).toBe(true)
  })

  it('runs a tool loop: view → final, logging every event', async () => {
    const client = scriptedClient((step) => {
      if (step === 1) {
        return {
          id: 'c1',
          model: 'mock-model',
          message: {
            role: 'assistant',
            content: '',
            tool_calls: [{ id: 'tc1', name: 'view_file', arguments: { path: 'a.txt' } }],
          },
          finishReason: 'tool_calls',
          usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        }
      }
      return {
        id: 'c2',
        model: 'mock-model',
        message: { role: 'assistant', content: 'FINAL: saw the file' },
        finishReason: 'stop',
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      }
    })
    const ctxTool = { ...viewFileTool }
    const dir = mkdtempSync(join(tmpdir(), 'equinox-loop-'))
    dirs.push(dir)
    const sandbox = mkdtempSync(join(tmpdir(), 'equinox-sandbox-'))
    dirs.push(sandbox)
    const res = await runAgentLoop({ client, task: 'view a.txt', tools: [ctxTool], logFile: join(dir, 's.jsonl'), sandboxRoot: sandbox })
    expect(res.steps).toBe(2)
    expect(res.interrupted).toBe(false)
    const types = res.events.map((e) => e.type)
    expect(types).toContain('tool_call')
    expect(types).toContain('tool_result')
    expect(types).toContain('final')
    // the view_file call on a missing file produced a tool failure surfaced to onError
    const toolResult = res.events.find((e) => e.type === 'tool_result')
    expect(toolResult!.payload).toMatchObject({ id: 'tc1', name: 'view_file' })
  })

  it('intercepts consecutive client errors and raises onError', async () => {
    const events: number[] = []
    let attempts = 0
    const client = {
      model: 'm',
      chat: async (): Promise<ChatResult> => {
        attempts++
        if (attempts <= 2) throw new Error('server down')
        return {
          id: 'c',
          model: 'm',
          message: { role: 'assistant', content: 'FINAL: recovered' },
          finishReason: 'stop',
          usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        }
      },
    }
    const dir = mkdtempSync(join(tmpdir(), 'equinox-loop-'))
    dirs.push(dir)
    const res = await runAgentLoop({
      client,
      task: 'x',
      logFile: join(dir, 's.jsonl'),
      onError: (_step, _e, consecutive) => events.push(consecutive),
    })
    expect(events).toEqual([1, 2]) // two consecutive errors observed
    expect(res.finalAnswer).toBe('FINAL: recovered')
    expect(res.events.filter((e) => e.type === 'error')).toHaveLength(2)
  })

  it('interrupts when maxSteps is exhausted', async () => {
    // Client that never stops requesting tools (unknown tool ⇒ keeps looping).
    const client = scriptedClient(() => ({
      id: 'c',
      model: 'm',
      message: {
        role: 'assistant',
        content: '',
        tool_calls: [{ id: 'tc-loop', name: 'loop_forever', arguments: {} }],
      },
      finishReason: 'tool_calls',
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    }))
    const dir = mkdtempSync(join(tmpdir(), 'equinox-loop-'))
    dirs.push(dir)
    const res = await runAgentLoop({ client, task: 'loop forever', maxSteps: 3, logFile: join(dir, 's.jsonl') })
    expect(res.interrupted).toBe(true)
    expect(res.steps).toBe(3)
    expect(res.events.some((e) => e.type === 'interrupted')).toBe(true)
    expect(res.events.some((e) => e.type === 'error' && JSON.stringify(e.payload).includes('unknown tool: loop_forever'))).toBe(true)
  })
})