import { describe, expect, it } from 'vitest'

import { buildSystemPrompt, classifyTask, selectTemperature, syntaxAnchors } from '@solsticeai/adapter'
import { viewFileTool, editFileTool, runCommandTool } from '@solsticeai/tools'
import type { ModelProfile } from '@solsticeai/core'

const TOOLS = [viewFileTool, editFileTool, runCommandTool]

function profile(overrides: Partial<ModelProfile> = {}): ModelProfile {
  return {
    schemaVersion: 1,
    model: 'm',
    backend: 'hidden-states',
    generatedAt: new Date().toISOString(),
    probeComposite: 0.5,
    domainScores: { syntax: 0.9, coding: 0.8, logic: 0.4, tools: 0.7, instructions: 0.3 },
    layerStats: [],
    quantPlan: { baseType: 'Q4_K_M', tokenEmbeddingType: 'q4_k', outputTensorType: 'q8_0', rules: [] },
    policy: { scratchpad: 'off', drift: 0, temperature: { code: 0.1, reasoning: 0.6, default: 0.4 } },
    ...overrides,
  }
}

describe('classifyTask', () => {
  it('detects coding tasks', () => {
    expect(classifyTask('Fix the bug in server.ts and write a unit test')).toBe('code')
    expect(classifyTask('refactor this function').length).toBeGreaterThan(0)
  })
  it('detects reasoning tasks', () => {
    expect(classifyTask('Solve this scheduling constraint puzzle')).toBe('reasoning')
    expect(classifyTask('Prove the derived inequality with a plan')).toBe('reasoning')
  })
  it('falls back to general', () => {
    expect(classifyTask('Tell me about the weather')).toBe('general')
  })
})

describe('selectTemperature', () => {
  it('applies the dual-plane policy: 0.1 code / 0.6 reasoning', () => {
    const p = profile()
    expect(selectTemperature(p, 'write a function', 'code')).toBe(0.1)
    expect(selectTemperature(p, 'schedule these tasks', 'reasoning')).toBe(0.6)
    expect(selectTemperature(p, 'anything', 'general')).toBe(0.4)
  })
})

describe('buildSystemPrompt', () => {
  it('injects a scratchpad when the policy requires it', () => {
    const p = profile({ policy: { scratchpad: 'always', drift: 0.8, temperature: { code: 0.1, reasoning: 0.6, default: 0.4 } } })
    const built = buildSystemPrompt({ profile: p, task: 'fix it', tools: TOOLS })
    expect(built.system).toContain('THINKING SCRATCHPAD (required)')
    expect(built.system).toContain('TASK:\nfix it')
    expect(built.system).toContain('view_file')
  })

  it('anchors syntax toward weak domains', () => {
    const p = profile()
    const anchors = syntaxAnchors(p)
    expect(anchors).toContain('[weak: logic]')
    expect(anchors).toContain('[weak: instructions]')
    expect(anchors).not.toContain('[weak: syntax]')
  })

  it('omits anchors/scratchpad for strong profiles', () => {
    const p = profile({ domainScores: { syntax: 1, coding: 1, logic: 0.9, tools: 0.9, instructions: 0.9 } })
    expect(syntaxAnchors(p)).toBe('')
    const built = buildSystemPrompt({ profile: p })
    expect(built.system).not.toContain('THINKING')
  })
})