import { describe, expect, it } from 'vitest'

import { findTwin, forecastQuantPlan, normalizeFamily } from '../src/index.ts'
import type { ApiFingerprint, ReferenceTwin } from '../src/types.ts'

function twin(model: string, family: string, params: number): ReferenceTwin {
  return {
    model,
    family,
    params,
    backend: 'hidden-states',
    quantPlan: {
      baseType: 'Q4_K_M',
      tokenEmbeddingType: 'q4_k',
      outputTensorType: 'q8_0',
      rules: [
        { tier: 'f16', layers: [0, 1] },
        { tier: 'iq2_xxs', layers: [40, 41] },
      ],
    },
  }
}

function apiFingerprint(partial: Partial<ApiFingerprint>): ApiFingerprint {
  return {
    backend: 'api',
    model: 'api-llama',
    family: 'Llama-3',
    params: 8,
    capabilities: [],
    capabilityVector: [0.5],
    composite: 0.7,
    stability: 1,
    calibrationError: 0,
    entropy: null,
    samples: 10,
    logprobsAvailable: false,
    ...partial,
  }
}

describe('normalizeFamily', () => {
  it('lowercases and strips punctuation/spaces', () => {
    expect(normalizeFamily('Llama-3')).toBe('llama3')
    expect(normalizeFamily('Qwen 2.5')).toBe('qwen25')
    expect(normalizeFamily('qwen2.5')).toBe('qwen25')
  })
})

describe('findTwin', () => {
  const twins = [twin('llama3-8b-gguf', 'Llama-3', 8), twin('llama3-70b-gguf', 'Llama-3', 70), twin('qwen25-7b', 'Qwen 2.5', 7)]

  it('returns null when the API family is unknown (cannot ground a transfer)', () => {
    expect(findTwin(twins, undefined, 8)).toBeNull()
  })

  it('matches on normalized family and ±10% params', () => {
    expect(findTwin(twins, 'Llama-3', 8.4)?.model).toBe('llama3-8b-gguf')
    // 8.9 vs 8 ⇒ 11.25% delta — outside tolerance
    expect(findTwin(twins, 'Llama-3', 8.9)).toBeNull()
  })

  it('prefers the closest param match', () => {
    const close = [twin('a', 'qwen', 7), twin('b', 'qwen', 7.5)]
    expect(findTwin(close, 'Qwen', 7.45)?.model).toBe('b')
  })

  it('falls back to family-only match when params are unknown', () => {
    expect(findTwin(twins, 'Qwen 2.5', undefined)?.model).toBe('qwen25-7b')
  })
})

describe('forecastQuantPlan', () => {
  it('grounds a transfer on a healthy same-family twin and clones its plan', () => {
    const api = apiFingerprint({ stability: 0.9, calibrationError: 0.05 })
    const forecast = forecastQuantPlan(api, [twin('llama3-8b-gguf', 'Llama-3', 8)])
    expect(forecast.grounded).toBe(true)
    expect(forecast.twin).toBe('llama3-8b-gguf')
    expect(forecast.plan.rules).toEqual([
      { tier: 'f16', layers: [0, 1] },
      { tier: 'iq2_xxs', layers: [40, 41] },
    ])
    // paramDelta 0 ⇒ base 0.9; health: min(0.9, 1-0.05) = 0.9 ⇒ multiplier 0.96
    expect(forecast.confidence).toBeCloseTo(0.9 * (0.6 + 0.4 * 0.9), 4)
    // returned plan must not alias the twin's arrays
    forecast.plan.rules[0]?.layers.push(99)
    expect(twin('llama3-8b-gguf', 'Llama-3', 8).quantPlan.rules[0]?.layers).toEqual([0, 1])
  })

  it('degrades confidence when the API model looks unstable', () => {
    const api = apiFingerprint({ stability: 0.5, calibrationError: 0.3 })
    const forecast = forecastQuantPlan(api, [twin('llama3-8b-gguf', 'Llama-3', 8)])
    expect(forecast.grounded).toBe(true)
    // multiplier = 0.6 + 0.4 * min(0.5, 0.7) = 0.8
    expect(forecast.confidence).toBeCloseTo(0.9 * 0.8, 4)
  })

  it('returns an explicitly ungrounded uniform plan without a twin', () => {
    const forecast = forecastQuantPlan(apiFingerprint({}), [])
    expect(forecast.grounded).toBe(false)
    expect(forecast.plan.rules).toEqual([])
    expect(forecast.plan.baseType).toBe('Q4_K_M')
    expect(forecast.confidence).toBe(0.35)
    expect(forecast.rationale).toMatch(/no local twin/)
  })

  it('never aliases the shared uniform plan between forecasts', () => {
    const first = forecastQuantPlan(apiFingerprint({}), [])
    first.plan.rules.push({ tier: 'f16', layers: [0] })
    const second = forecastQuantPlan(apiFingerprint({}), [])
    expect(second.plan.rules).toEqual([])
  })
})
