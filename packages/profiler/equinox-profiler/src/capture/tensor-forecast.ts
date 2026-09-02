/**
 * Behavioral → tensor transfer for API-hosted models.
 *
 * A black-box API never exposes per-layer activations, so an exact σ²/κ/𝓘ₗ
 * fingerprint is impossible for it. But layer ROLE is a property of the
 * architecture, not the deployment: when a local twin (same family, close
 * parameter count) has been profiled with real weights, that twin's quant
 * plan transfers — the API fingerprint only decides *whether* the deployment
 * looks like a healthy instance of that architecture (high stability /
 * consistency ⇒ transfer with confidence).
 *
 * Without a twin the forecast is explicitly NOT grounded: asymmetric tiers
 * require weights, and {@link @solsticeai/equinox-requant} refuses estimated
 * plans unless the caller opts in.
 */

import type { ApiFingerprint, QuantPlan, ReferenceTwin, TensorForecast } from '../types.ts'

const PARAMS_TOLERANCE = 0.1 // ±10% parameter match
const UNIFORM_PLAN: QuantPlan = {
  baseType: 'Q4_K_M',
  tokenEmbeddingType: 'q4_k',
  outputTensorType: 'q8_0',
  rules: [],
}

export function normalizeFamily(family: string): string {
  return family.trim().toLowerCase().replace(/[^a-z0-9]/g, '')
}

/**
 * Best twin: same normalized family and params within ±10% when known.
 * A grounded transfer REQUIRES a declared family — layer role is an
 * architecture property, so an unknown family can never ground a plan.
 */
export function findTwin(twins: ReferenceTwin[], family: string | undefined, params: number | undefined): ReferenceTwin | null {
  if (family === undefined) return null
  const normalizedFamily = normalizeFamily(family)
  let best: ReferenceTwin | null = null
  let bestScore = Number.POSITIVE_INFINITY
  for (const twin of twins) {
    if (normalizeFamily(twin.family) !== normalizedFamily) continue
    // Known params must sit within ±10%; unknown params fall back to a
    // family-only match (ranked below any param-verified candidate).
    const delta = params !== undefined ? Math.abs(twin.params - params) / params : 0.25
    if (params !== undefined && delta > PARAMS_TOLERANCE) continue
    if (delta < bestScore) {
      bestScore = delta
      best = twin
    }
  }
  return best
}

/** Confidence boost from the API model behaving like a healthy local instance. */
function healthMultiplier(api: ApiFingerprint): number {
  const stability = clamp01(api.stability)
  const consistencyFloor = clamp01(1 - (api.calibrationError ?? 0.5))
  return 0.6 + 0.4 * Math.min(stability, consistencyFloor)
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

/**
 * Produce a tensor forecast for an API fingerprint.
 * Grounded (twin present) plans carry the twin's real per-layer tiers;
 * otherwise the plan is uniform and marked estimated.
 */
export function forecastQuantPlan(api: ApiFingerprint, twins: ReferenceTwin[]): TensorForecast {
  const twin = findTwin(twins, api.family, api.params)
  if (twin === null) {
    return {
      grounded: false,
      confidence: 0.35,
      plan: { ...UNIFORM_PLAN, rules: [] },
      rationale: 'no local twin with matching family/params — asymmetric per-layer tiers require local weights; profile a GGUF of the same architecture to ground this forecast',
    }
  }
  const paramDelta = api.params !== undefined ? Math.abs(twin.params - api.params) / api.params : 0
  // Verified param proximity ⇒ high confidence; family-only match ⇒ 0.75.
  const baseConfidence = api.params === undefined ? 0.75 : paramDelta <= 0.05 ? 0.9 : 0.8
  const confidence = Math.min(0.97, baseConfidence * healthMultiplier(api))
  const paramNote = api.params !== undefined
    ? `, param delta ${Math.round(paramDelta * 100)}%`
    : ' (family-only match — params unknown)'
  const rationale = `transferred from locally profiled twin "${twin.model}" (family ${twin.family}, ${twin.params}B${paramNote}) with ${Math.round(confidence * 100)}% confidence from behavioral health`
  return {
    grounded: true,
    confidence,
    twin: twin.model,
    plan: clonePlan(twin.quantPlan),
    rationale,
  }
}

function clonePlan(plan: QuantPlan): QuantPlan {
  return {
    baseType: plan.baseType,
    tokenEmbeddingType: plan.tokenEmbeddingType,
    outputTensorType: plan.outputTensorType,
    rules: plan.rules.map(rule => ({ tier: rule.tier, layers: [...rule.layers] })),
  }
}
