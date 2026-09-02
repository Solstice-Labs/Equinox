import { describe, expect, it } from 'vitest'

import { buildFingerprint } from '../src/index.ts'
import type { ApiFingerprint, ReferenceTwin } from '../src/types.ts'

function apiFingerprint(partial: Partial<ApiFingerprint>): ApiFingerprint {
  return {
    backend: 'api',
    model: 'api-model',
    family: 'qwen',
    params: 32,
    capabilities: [],
    capabilityVector: [0.6, 0.5, 0.4, 0.3, 0.2],
    composite: 0.72,
    stability: 0.9,
    calibrationError: 0.05,
    entropy: null,
    samples: 40,
    logprobsAvailable: false,
    ...partial,
  }
}

function twin(): ReferenceTwin {
  return {
    model: 'qwen32b-gguf',
    family: 'Qwen',
    params: 32,
    backend: 'imatrix-proxy',
    quantPlan: {
      baseType: 'Q4_K_M',
      tokenEmbeddingType: 'q4_k',
      outputTensorType: 'q8_0',
      rules: [{ tier: 'f16', layers: [0] }, { tier: 'iq2_xxs', layers: [60] }],
    },
  }
}

const baseInput = {
  model: 'api-model',
  backend: 'api' as const,
  domainScores: { syntax: 0.9, coding: 0.8, logic: 0.6, tools: 0.7, instructions: 0.5 },
  probeComposite: 0.72,
  layerStats: [],
}

describe('buildFingerprint (backend api)', () => {
  it('produces a behavioral profile with uniform, ungrounded quant plan', () => {
    const profile = buildFingerprint({ ...baseInput, api: apiFingerprint({}) })
    expect(profile.backend).toBe('api')
    expect(profile.tensorGrounded).toBe(false)
    expect(profile.quantPlan.rules).toEqual([])
    expect(profile.layerStats).toEqual([])
    expect(profile.apiFingerprint?.model).toBe('api-model')
    expect(profile.tensorForecast?.grounded).toBe(false)
    expect(profile.tensorForecast?.confidence).toBe(0.35)
  })

  it('grounds the plan when a matching local twin exists', () => {
    const profile = buildFingerprint({
      ...baseInput,
      api: apiFingerprint({}),
      twins: [twin()],
    })
    expect(profile.tensorGrounded).toBe(true)
    expect(profile.tensorForecast?.twin).toBe('qwen32b-gguf')
    expect(profile.quantPlan.rules[0]?.tier).toBe('f16')
    expect(profile.tensorForecast?.grounded).toBe(true)
  })

  it('keeps scratchpad on-error for mildly unstable models', () => {
    const profile = buildFingerprint({ ...baseInput, api: apiFingerprint({ stability: 0.7 }) })
    expect(profile.policy.scratchpad).toBe('on-error')
    expect(profile.policy.drift).toBeCloseTo(0.3)
  })

  it('escalates scratchpad to always for unstable models', () => {
    const profile = buildFingerprint({ ...baseInput, api: apiFingerprint({ stability: 0.4 }) })
    expect(profile.policy.scratchpad).toBe('always')
  })

  it('relaxes reasoning temperature when calibration is strong', () => {
    const wellCalibrated = buildFingerprint({ ...baseInput, api: apiFingerprint({ calibrationError: 0.05 }) })
    expect(wellCalibrated.policy.temperature.reasoning).toBe(0.6)
    const miscalibrated = buildFingerprint({ ...baseInput, api: apiFingerprint({ calibrationError: 0.3 }) })
    expect(miscalibrated.policy.temperature.reasoning).toBe(0.35)
  })

  it('keeps code temperature at the probe default', () => {
    const profile = buildFingerprint({ ...baseInput, api: apiFingerprint({}), tempCode: 0.2 })
    expect(profile.policy.temperature.code).toBe(0.2)
  })
})
