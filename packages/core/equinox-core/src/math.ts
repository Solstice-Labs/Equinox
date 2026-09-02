/**
 * The dual-plane mathematical core of Project Equinox.
 *
 * 1. Activation variance per layer:   σ² = E[(a − μ)²]
 * 2. Kurtosis per layer:              κ  = E[(a − μ)⁴] / (σ²)²        (κ > 3 ⇒ outlier activations / hallucination precursors)
 * 3. Composite layer importance:      𝓘ₗ = (1/D) Σᵢ σ²ᵢ · log(1 + κᵢ)
 *
 * Thresholds (applied to scores normalized to [0, 1]):
 *   𝓘ₗ >  0.85  →  FP16 / Q8_0       (reasoning hubs)
 *   0.35 ≤ 𝓘ₗ ≤ 0.85 → Q4_K_M        (intermediate support)
 *   𝓘ₗ <  0.35  →  IQ2_XXS / 2-bit   (redundant layers)
 */

import { createHash } from 'node:crypto'

export type QuantTier = 'f16' | 'q8_0' | 'q4_k_m' | 'iq2_xxs'

export const OUTLIER_KURTOSIS = 3.0
export const STEERING_KURTOSIS = 3.5
export const TIER_HIGH = 0.85
export const TIER_MID_HIGH = 0.35

export function mean(xs: number[]): number {
  if (xs.length === 0) return Number.NaN
  let sum = 0
  for (const x of xs) sum += x
  return sum / xs.length
}

/** Population variance σ² = E[(x − μ)²]. */
export function variance(xs: number[]): number {
  if (xs.length === 0) return Number.NaN
  const m = mean(xs)
  let acc = 0
  for (const x of xs) {
    const d = x - m
    acc += d * d
  }
  return acc / xs.length
}

/** Population fourth central moment E[(x − μ)⁴]. */
export function moment4(xs: number[]): number {
  if (xs.length === 0) return Number.NaN
  const m = mean(xs)
  let acc = 0
  for (const x of xs) {
    const d = x - m
    acc += d * d * d * d
  }
  return acc / xs.length
}

/**
 * Non-excess kurtosis κ = E[(x − μ)⁴] / (σ²)².
 * Gaussian data ⇒ κ = 3. Values > 3 flag outlier activations.
 */
export function kurtosis(xs: number[]): number {
  const v = variance(xs)
  if (v === 0) return Number.NaN
  return moment4(xs) / (v * v)
}

/** Composite layer importance for a single dimension contribution: σ² · log(1 + κ). */
export function compositeImportance(v: number, k: number): number {
  return v * Math.log(1 + k)
}

/** Layer aggregate: 𝓘ₗ = (1/D) Σᵢ σ²ᵢ · log(1 + κᵢ). */
export function layerImportance(variances: number[], kurtoses: number[]): number {
  if (variances.length === 0 || variances.length !== kurtoses.length) return Number.NaN
  let acc = 0
  for (let i = 0; i < variances.length; i++) {
    const v = variances[i]
    const k = Number.isFinite(kurtoses[i]) && (kurtoses[i] as number) > 0 ? (kurtoses[i] as number) : 1
    acc += compositeImportance(v, k)
  }
  return acc / variances.length
}

/** Min-max normalize a score vector into [0, 1]; all-equal input maps to [0.5]. */
export function normalizeScores(scores: number[]): number[] {
  if (scores.length === 0) return []
  let lo = Number.POSITIVE_INFINITY
  let hi = Number.NEGATIVE_INFINITY
  for (const s of scores) {
    if (s < lo) lo = s
    if (s > hi) hi = s
  }
  if (hi === lo) return scores.map(() => 0.5)
  return scores.map((s) => (s - lo) / (hi - lo))
}

/** Map a normalized composite score to an asymmetric precision tier. */
export function quantTierFor(score: number): QuantTier {
  if (score > 0.97) return 'f16'
  if (score > TIER_HIGH) return 'q8_0'
  if (score >= TIER_MID_HIGH) return 'q4_k_m'
  return 'iq2_xxs'
}

export interface LayerStatLike {
  layer: number
  importance: number
}

/** Max per-layer composite drift between current and baseline profiles. */
export function drift(current: LayerStatLike[], baseline: LayerStatLike[]): number {
  const base = new Map(baseline.map((b) => [b.layer, b.importance]))
  let max = 0
  for (const c of current) {
    const b = base.get(c.layer)
    if (b === undefined) continue
    const d = Math.abs(c.importance - b)
    if (d > max) max = d
  }
  return max
}

/** Deterministic seeded PRNG (mulberry32) — used so calibration pools rebuild identically. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex')
}

export function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n))
}