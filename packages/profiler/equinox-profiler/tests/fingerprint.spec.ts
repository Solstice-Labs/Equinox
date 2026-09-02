import { describe, expect, it } from 'vitest'

import { buildFingerprint, normalizeLayerImportance, quantPlanFromTiers } from '../src/index.ts'
import type { LayerMoments } from '../src/index.ts'

function layers(importances: number[]): LayerMoments[] {
  return importances.map((importance, layer) => ({ layer, importance, variance: importance, kurtosis: 3, samples: 100 }))
}

describe('normalizeLayerImportance', () => {
  it('min-max normalizes to [0,1]', () => {
    const result = normalizeLayerImportance(layers([0, 5, 10]))
    expect(result.map(s => s.importance)).toEqual([0, 0.5, 1])
  })
  it('constant input maps to 0.5', () => {
    const result = normalizeLayerImportance(layers([3, 3]))
    expect(result.map(s => s.importance)).toEqual([0.5, 0.5])
  })
})

describe('quantPlanFromTiers', () => {
  it('groups consecutive rule entries per tier', () => {
    const plan = quantPlanFromTiers(
      [
        { layer: 0, tier: 'f16' },
        { layer: 1, tier: 'iq2_xxs' },
        { layer: 2, tier: 'q4_k_m' },
      ],
      { baseType: 'Q4_K_M', tokenEmbeddingType: 'q4_k', outputTensorType: 'q8_0' },
    )
    const byTier = new Map(plan.rules.map(r => [r.tier, r.layers]))
    expect(byTier.get('f16')).toEqual([0])
    expect(byTier.get('iq2_xxs')).toEqual([1])
    expect(byTier.get('q4_k_m')).toEqual([2])
    expect(plan.baseType).toBe('Q4_K_M')
  })
})

describe('buildFingerprint', () => {
  it('produces a full profile with asymmetric quant plan', () => {
    const profile = buildFingerprint({
      model: 'qwen3-4b',
      backend: 'hidden-states',
      domainScores: { syntax: 0.9, coding: 0.8, logic: 0.4, tools: 0.7, instructions: 0.3 },
      probeComposite: 0.62,
      layerStats: layers([10, 5, 0.1]),
    })
    expect(profile.schemaVersion).toBe(1)
    expect(profile.backend).toBe('hidden-states')
    // normalized [1, ~0.495, 0] → f16, q4_k_m, iq2_xxs
    const byLayer = new Map(profile.layerStats.map(s => [s.layer, s.importance]))
    expect(byLayer.get(0)).toBe(1)
    const rules = new Map(profile.quantPlan.rules.map(r => [r.tier, r.layers]))
    expect(rules.get('f16')).toEqual([0])
    expect(rules.get('q4_k_m') ?? []).toContain(1)
    expect(rules.get('iq2_xxs')).toEqual([2])
  })

  it('no-capture profiles have empty rules and scratchpad off', () => {
    const profile = buildFingerprint({
      model: 'm',
      backend: 'none',
      domainScores: {},
      probeComposite: 0.5,
      layerStats: [],
    })
    expect(profile.quantPlan.rules).toEqual([])
    expect(profile.policy.scratchpad).toBe('off')
    expect(profile.policy.drift).toBe(0)
  })

  it('scratchpad policy escalates with drift vs baseline', () => {
    const capture = layers([10, 5, 0.1])
    const noDrift = buildFingerprint({
      model: 'm',
      backend: 'imatrix-proxy',
      domainScores: {},
      probeComposite: 0.5,
      layerStats: capture,
      baseline: [{ layer: 0, importance: 1 }, { layer: 1, importance: 0.5 }, { layer: 2, importance: 0 }],
      scratchpadDrift: 0.65,
    })
    expect(noDrift.policy.scratchpad).toBe('off')
    const drifted = buildFingerprint({
      model: 'm',
      backend: 'imatrix-proxy',
      domainScores: {},
      probeComposite: 0.5,
      layerStats: capture,
      baseline: [{ layer: 0, importance: 0.1 }, { layer: 1, importance: 0.1 }, { layer: 2, importance: 0.1 }],
      scratchpadDrift: 0.65,
    })
    expect(drifted.policy.scratchpad).toBe('always')
    expect(drifted.policy.drift).toBeGreaterThan(0.65)
  })

  it('weak reasoning domains raise reasoning temperature', () => {
    const weak = buildFingerprint({
      model: 'm',
      backend: 'none',
      domainScores: { logic: 0.2, instructions: 0.9 },
      probeComposite: 0.4,
      layerStats: [],
      tempReasoning: 0.6,
    })
    expect(weak.policy.temperature.reasoning).toBe(0.6)
    expect(weak.policy.temperature.code).toBe(0.1)
  })
})
