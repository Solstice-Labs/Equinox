import { describe, expect, it } from 'vitest'

import { reduceApiFingerprint, runApiFingerprint, type Sampler } from '../src/index.ts'
import { PROBE_DOMAINS } from '../src/probes/index.ts'
import type { Probe } from '../src/probes/types.ts'
import type { ApiCapabilityStats, ProbeMessage, ProbeOutcome, SuiteResult } from '../src/types.ts'
import type { ReduceInput, SweepMeasurement, RobustnessMeasurement } from '../src/capture/api-fingerprint.ts'
import type { SampledResponse } from '../src/client/openai-client.ts'

/** Deterministic fake grader: pass iff the output is exactly 'yes'. */
function gradeYes(output: string): { pass: boolean; score: number; detail: string } {
  const pass = output.trim() === 'yes'
  return { pass, score: pass ? 1 : 0, detail: '' }
}

function probe(id: string, domain: Probe['domain'], toolFlow = false): Probe {
  const messages: ProbeMessage[] = toolFlow
    ? [{ role: 'user', content: 'use the tool' }]
    : [{ role: 'user', content: id }]
  if (toolFlow) {
    return {
      id,
      domain,
      title: id,
      messages,
      flow: {
        turns: [{ instruction: 'do it', tools: ['run-command'] }],
        verify: () => gradeYes('yes'),
      },
    }
  }
  return { id, domain, title: id, messages, grader: gradeYes }
}

function outcome(probeId: string, domain: Probe['domain'], pass: boolean): ProbeOutcome {
  return {
    id: probeId,
    domain,
    title: probeId,
    pass,
    score: pass ? 1 : 0,
    detail: '',
    latencyMs: 10,
    promptTokens: 5,
    completionTokens: 3,
  }
}

function baseSuite(probes: Probe[], results: Record<string, boolean>): SuiteResult {
  return {
    model: 'api-model',
    startedAt: 't0',
    finishedAt: 't1',
    outcomes: probes.map(p => outcome(p.id, p.domain, results[p.id] ?? false)),
    domainScores: {},
    composite: 0.5,
  }
}

/**
 * Mock sampler: high temperature + odd seed ⇒ 'yes'; high temperature + even
 * seed ⇒ 'no'; low temperature always answers 'yes'. Logprobs echoed when asked.
 */
function mockSampler(): Sampler {
  return async (_messages: ProbeMessage[], options): Promise<SampledResponse> => {
    const hot = (options.temperature ?? 0) > 0.5
    const text = !hot || (options.seed ?? 0) % 2 === 1 ? 'yes' : 'no'
    return {
      text,
      logprobs: options.logprobs === true
        ? [{ token: text, logprob: -0.5 }, { token: ' ', logprob: -1.0 }]
        : null,
    }
  }
}

function domainById(measurements: ApiCapabilityStats[]): Map<string, ApiCapabilityStats> {
  return new Map(measurements.map(m => [m.domain, m]))
}

describe('runApiFingerprint', () => {
  it('sweeps single-turn probes at high temperature and reduces the fingerprint', async () => {
    const registry = [probe('s1', 'syntax'), probe('s2', 'syntax'), probe('c1', 'coding'), probe('t1', 'tools', true)]
    const suite = baseSuite(registry, { s1: true, s2: false, c1: true })
    let calls = 0
    const sampler: Sampler = async (messages, options) => {
      calls += 1
      return mockSampler()(messages, options)
    }
    const fingerprint = await runApiFingerprint({
      model: 'api-model',
      baseSuite: suite,
      sampler,
      probes: registry,
      consistencyRepeats: 2,
      logprobs: true,
      robustnessProbes: [probe('s1', 'syntax')],
    })
    // s1 + s2 + c1 repeats (6) + s1 robustness (1) — tool-flow probe is not swept.
    expect(calls).toBe(7)
    expect(fingerprint.backend).toBe('api')
    expect(fingerprint.model).toBe('api-model')
    expect(fingerprint.logprobsAvailable).toBe(true)
    expect(fingerprint.capabilities).toHaveLength(PROBE_DOMAINS.length)

    const byDomain = domainById(fingerprint.capabilities)
    const syntax = byDomain.get('syntax')
    expect(syntax?.domain).toBe('syntax')
    // s1 agreement 0.5 (seed 43 yes / 44 no) + s2 agreement 0.5 ⇒ mean 0.5
    expect(syntax?.consistency).toBeCloseTo(0.5)
    // robustness: perturbed s1 run answers 'yes' and s1 base is yes ⇒ invariant
    expect(syntax?.robustness).toBeCloseTo(1)
    // mean entropy of two logprob points = mean(-0.5/ln2, -1.0/ln2) ≈ 1.08 bits
    expect(syntax?.commitment).not.toBeNull()
    if (syntax !== undefined && syntax.commitment !== null) {
      expect(syntax.commitment).toBeCloseTo((0.5 + 1) / Math.LN2 / 2, 4)
    }
    // c1 also wobbles under the uniform mock (seeds alternate) ⇒ 0.5
    expect(byDomain.get('coding')?.consistency).toBeCloseTo(0.5)
    // tool-flow probes are not swept ⇒ base score doubles as consistency
    expect(byDomain.get('tools')?.consistency).toBeCloseTo(0)
    // pooled variance over [true,true,false] and [false,no,yes→no?] → stability < 1
    expect(fingerprint.stability).toBeLessThan(1)
    expect(fingerprint.stability).toBeGreaterThan(0)
    expect(fingerprint.samples).toBe(7)
  })

  it('reports logprobsAvailable=false when the endpoint never returns them', async () => {
    const registry = [probe('s1', 'syntax')]
    const suite = baseSuite(registry, { s1: true })
    const sampler: Sampler = async (messages, options) => {
      const inner = await mockSampler()(messages, options)
      return { ...inner, logprobs: null }
    }
    const fingerprint = await runApiFingerprint({
      model: 'api-model',
      baseSuite: suite,
      sampler,
      probes: registry,
      logprobs: true,
    })
    expect(fingerprint.logprobsAvailable).toBe(false)
    expect(fingerprint.entropy).toBeNull()
  })
})

describe('reduceApiFingerprint', () => {
  function sweeps(entries: { id: string; domain: Probe['domain']; base: boolean; repeats: boolean[] }[]): Map<string, SweepMeasurement> {
    return new Map(entries.map(entry => [entry.id, {
      domain: entry.domain,
      base: entry.base,
      repeats: entry.repeats.map(verdict => ({ verdict, entropy: null })),
    }]))
  }

  function input(partial: Partial<ReduceInput>): ReduceInput {
    return {
      model: 'm',
      domainScores: { syntax: 0.5, coding: 0.8, logic: 0.2, tools: 0.6, instructions: 0.4 },
      composite: 0.5,
      sweeps: sweeps([]),
      robustness: new Map<string, RobustnessMeasurement>(),
      sawLogprobs: false,
      samples: 0,
      ...partial,
    }
  }

  it('derives stability from pooled verdict variance (activation-variance proxy)', () => {
    // [true, true, true] → var 0 ; [true, false] → var 0.25 ⇒ stability 0.875
    const fingerprint = reduceApiFingerprint(input({
      sweeps: sweeps([
        { id: 'a', domain: 'syntax', base: true, repeats: [true, true] },
        { id: 'b', domain: 'syntax', base: true, repeats: [false] },
      ]),
    }))
    expect(fingerprint.stability).toBeCloseTo(0.875)
    // per-probe agreement 1.0 and 0.0 ⇒ mean 0.5
    expect(fingerprint.capabilities[0]?.consistency).toBeCloseTo(0.5)
  })

  it('flags miscalibration when consistency diverges from the base score', () => {
    const fingerprint = reduceApiFingerprint(input({
      domainScores: { syntax: 0.9, coding: 0, logic: 0, tools: 0, instructions: 0 },
      sweeps: sweeps([
        { id: 'a', domain: 'syntax', base: true, repeats: [false, false] },
      ]),
    }))
    const syntax = fingerprint.capabilities.find(c => c.domain === 'syntax')
    expect(syntax?.consistency).toBeCloseTo(0)
    expect(syntax?.calibrationError).toBeCloseTo(0.9)
    expect(fingerprint.calibrationError).toBeCloseTo(0.9)
  })

  it('emits capability vectors in PROBE_DOMAINS order', () => {
    const fingerprint = reduceApiFingerprint(input({
      sweeps: sweeps([
        { id: 'a', domain: 'coding', base: true, repeats: [true] },
      ]),
    }))
    expect(fingerprint.capabilities.map(c => c.domain)).toEqual(PROBE_DOMAINS)
    expect(fingerprint.capabilityVector).toHaveLength(PROBE_DOMAINS.length)
  })

  it('handles domains with no sweepable probes by mirroring base score', () => {
    const fingerprint = reduceApiFingerprint(input({
      domainScores: { syntax: 0.7, coding: 0, logic: 0, tools: 0, instructions: 0 },
      sweeps: sweeps([]),
    }))
    const syntax = fingerprint.capabilities.find(c => c.domain === 'syntax')
    expect(syntax?.consistency).toBeCloseTo(0.7)
    expect(syntax?.calibrationError).toBeNull()
  })
})
