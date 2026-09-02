import { describe, expect, it } from 'vitest'

import { buildTeacherArgv, extractSteps, normalizeTeacherText, parseTeacherOutput, TeacherCoordinator } from '@solsticeai/distiller'
import { loadConfig } from '@solsticeai/core'

describe('normalizeTeacherText', () => {
  it('strips pleasantries, headings and emoji', () => {
    const cleaned = normalizeTeacherText(
      "🧠 I'd love to help! Let me start by looking at the file.\n---\n**Plan**\n1. read the file\n2. edit the file\n\n\nDone! ✅",
    )
    expect(cleaned).not.toMatch(/I'd love/)
    expect(cleaned).not.toMatch(/Let me start/)
    expect(cleaned).not.toContain('---')
    expect(cleaned).not.toMatch(/\n{3,}/)
    expect(cleaned).toContain('1. read the file')
  })

  it('strips "Sure!" openers', () => {
    expect(normalizeTeacherText('Sure! Here is the answer.')).toBe('Here is the answer.')
  })
})

describe('extractSteps', () => {
  it('extracts numbered and bulleted steps', () => {
    const steps = extractSteps('1. read a.txt\n2) edit a.txt\n- verify output')
    expect(steps).toEqual(['read a.txt', 'edit a.txt', 'verify output'])
  })
  it('returns [] when there are no steps', () => {
    expect(extractSteps('plain prose')).toEqual([])
  })
})

describe('buildTeacherArgv', () => {
  it('builds per-kind invocations', () => {
    expect(buildTeacherArgv('claude', 'P')).toEqual(['claude', '-p', 'P', '--output-format', 'json'])
    expect(buildTeacherArgv('codex', 'P')).toEqual(['codex', 'exec', '--json', '--skip-git-repo-check', 'P'])
    expect(buildTeacherArgv('gemini', 'P')).toEqual(['gemini', '-p', 'P'])
  })
  it('uses the override verbatim', () => {
    expect(buildTeacherArgv('claude', 'P', ['my-teacher', '--flag'])).toEqual(['my-teacher', '--flag', 'P'])
  })
})

describe('parseTeacherOutput', () => {
  it('parses claude --output-format json', () => {
    const out = parseTeacherOutput('claude', '{"result":"1. read\\n2. edit\\nanswer"}')
    expect(out.text).toBe('1. read\n2. edit\nanswer')
    expect(out.steps).toEqual(['read', 'edit'])
  })

  it('parses codex JSONL events', () => {
    const lines = [
      '{"type":"exec","tool_name":"view_file","args":{"path":"a.ts"}}',
      '{"type":"agent_message","content":"Step 1: read the file"}',
      '{"type":"agent_message","content":"1. read the file\\n2. fix the bug"}',
    ]
    const out = parseTeacherOutput('codex', lines.join('\n'))
    expect(out.toolCalls).toHaveLength(1)
    expect(out.toolCalls[0]).toMatchObject({ name: 'view_file', arguments: { path: 'a.ts' } })
    expect(out.text).toContain('Step 1')
  })

  it('falls back to raw text', () => {
    const out = parseTeacherOutput('gemini', 'just some answer')
    expect(out.text).toBe('just some answer')
    expect(out.toolCalls).toEqual([])
  })
})

describe('TeacherCoordinator', () => {
  it('spawns a teacher CLI and parses its output (claude)', async () => {
    const config = loadConfig({ EQUINOX_TEACHER: 'claude' })
    const coordinator = new TeacherCoordinator(config, {
      spawnImpl: async () => ({ stdout: '{"result":"1. read file\\n2. fix bug"}', stderr: '', code: 0 }),
    })
    const res = await coordinator.teach('fix the bug', { timeoutMs: 1000 })
    expect(res.ok).toBe(true)
    expect(res.cmd[0]).toBe('claude')
    expect(res.output.steps).toEqual(['read file', 'fix bug'])
  })

  it('reports teacher failures', async () => {
    const config = loadConfig({ EQUINOX_TEACHER: 'gemini' })
    const coordinator = new TeacherCoordinator(config, {
      spawnImpl: async () => ({ stdout: '', stderr: 'command not found', code: 127 }),
    })
    const res = await coordinator.teach('x')
    expect(res.ok).toBe(false)
    expect(res.error).toContain('127')
  })

  it('teaches via the API teacher', async () => {
    const config = loadConfig({ EQUINOX_TEACHER: 'api' })
    const coordinator = new TeacherCoordinator(config, {
      client: {
        model: 'teacher',
        chat: async () => ({
          id: 't1',
          model: 'teacher',
          message: { role: 'assistant', content: 'Sure! 1. inspect\n2. fix\nanswer' },
          finishReason: 'stop',
          usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        }),
      },
    })
    const res = await coordinator.teach('fix it')
    expect(res.ok).toBe(true)
    expect(res.output.text).not.toMatch(/Sure!/)
    expect(res.output.steps).toHaveLength(2)
  })
})