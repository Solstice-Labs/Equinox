import { describe, expect, it } from 'vitest'

import {
  clamp,
  compositeImportance,
  drift,
  kurtosis,
  layerImportance,
  mean,
  moment4,
  mulberry32,
  normalizeScores,
  quantTierFor,
  variance,
} from '@solsticeai/core'

describe('mean', () => {
  it('computes the arithmetic mean', () => {
    expect(mean([1, 2, 3, 4])).toBeCloseTo(2.5)
  })
  it('returns NaN for empty input', () => {
    expect(Number.isNaN(mean([]))).toBe(true)
  })
})

describe('variance (σ² = E[(x − μ)²])', () => {
  it('is zero for constant input', () => {
    expect(variance([2, 2, 2])).toBe(0)
  })
  it('computes population variance for 1..5 → 2', () => {
    expect(variance([1, 2, 3, 4, 5])).toBeCloseTo(2)
  })
})

describe('kurtosis (κ = E[(x−μ)⁴] / (σ²)²)', () => {
  it('computes κ for a symmetric set: [-3,-1,1,3] → 1.64', () => {
    expect(kurtosis([-3, -1, 1, 3])).toBeCloseTo(1.64, 5)
  })
  it('detects outlier-activation excess: heavy-tailed set has κ > 3', () => {
    const heavy = Array.from({ length: 100 }, (_, i) => {
      const x = (i % 10 === 0 ? 10 : 1) * ((i % 2 === 0 ? 1 : -1))
      return x
    })
    expect(kurtosis(heavy)).toBeGreaterThan(3)
  })
  it('is ~3 for gaussian-like data (Box-Muller, fixed seed)', () => {
    const rand = mulberry32(2026)
    const g: number[] = []
    for (let i = 0; i < 300; i++) {
      const u1 = Math.max(rand(), 1e-9)
      const u2 = rand()
      g.push(Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2))
    }
    const k = kurtosis(g)
    expect(k).toBeGreaterThan(2.2)
    expect(k).toBeLessThan(4.2)
  })
  it('returns NaN when variance is zero', () => {
    expect(Number.isNaN(kurtosis([5, 5, 5]))).toBe(true)
  })
  it('computes moment4 directly', () => {
    expect(moment4([1, 2, 3])).toBeCloseTo((1 + 0 + 1) / 3, 5)
  })
})

describe('composite importance (σ² · log(1 + κ))', () => {
  it('computes the per-dimension contribution', () => {
    expect(compositeImportance(2, 3)).toBeCloseTo(2 * Math.log(4), 8)
  })
  it('aggregates a full layer: 𝓘ₗ = (1/D) Σ σ²ᵢ log(1+κᵢ)', () => {
    // layer with dominant first dimension
    expect(layerImportance([10, 0.5], [3, 3])).toBeCloseTo((10 * Math.log(4) + 0.5 * Math.log(4)) / 2, 8)
  })
  it('guards empty/mismatched input', () => {
    expect(Number.isNaN(layerImportance([], []))).toBe(true)
    expect(Number.isNaN(layerImportance([1, 2], [3]))).toBe(true)
  })
})

describe('normalizeScores', () => {
  it('maps [1,3,2] → [0,1,0.5]', () => {
    expect(normalizeScores([1, 3, 2])).toEqual([0, 1, 0.5])
  })
  it('maps constant input to 0.5', () => {
    expect(normalizeScores([4, 4, 4])).toEqual([0.5, 0.5, 0.5])
  })
  it('handles empty input', () => {
    expect(normalizeScores([])).toEqual([])
  })
})

describe('quantTierFor', () => {
  it('> 0.85 → q8_0 (reasoning hubs)', () => {
    expect(quantTierFor(0.9)).toBe('q8_0')
  })
  it('> 0.97 → f16', () => {
    expect(quantTierFor(0.99)).toBe('f16')
  })
  it('0.35–0.85 → q4_k_m (intermediate support)', () => {
    expect(quantTierFor(0.5)).toBe('q4_k_m')
    expect(quantTierFor(0.35)).toBe('q4_k_m')
  })
  it('< 0.35 → iq2_xxs (redundant layers)', () => {
    expect(quantTierFor(0.2)).toBe('iq2_xxs')
  })
})

describe('drift', () => {
  it('returns max per-layer importance delta', () => {
    const current = [
      { layer: 0, importance: 0.9 },
      { layer: 1, importance: 0.4 },
    ]
    const baseline = [
      { layer: 0, importance: 0.2 },
      { layer: 1, importance: 0.35 },
    ]
    expect(drift(current, baseline)).toBeCloseTo(0.7)
  })
  it('ignores layers absent from baseline', () => {
    expect(drift([{ layer: 9, importance: 1 }], [{ layer: 0, importance: 0 }])).toBe(0)
  })
})

describe('mulberry32', () => {
  it('is deterministic for a fixed seed', () => {
    const a = mulberry32(42)
    const b = mulberry32(42)
    expect(Array.from({ length: 10 }, () => a())).toEqual(Array.from({ length: 10 }, () => b()))
  })
  it('produces values in [0, 1)', () => {
    const r = mulberry32(7)
    for (let i = 0; i < 100; i++) {
      const v = r()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })
  it('differs across seeds', () => {
    expect(mulberry32(1)()).not.toBe(mulberry32(2)())
  })
})

describe('clamp', () => {
  it('clamps into range', () => {
    expect(clamp(5, 0, 3)).toBe(3)
    expect(clamp(-1, 0, 3)).toBe(0)
    expect(clamp(2, 0, 3)).toBe(2)
  })
})