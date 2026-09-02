/**
 * Fingerprint builder: fuses probe scores + activation statistics into a
 * ModelProfile with a normalized asymmetric precision plan and runtime policy.
 */

import { forecastQuantPlan } from './capture/tensor-forecast.ts'
import type { ApiFingerprint, CaptureBackend, LayerMoments, ModelProfile, QuantPlan, QuantRule, ReferenceTwin } from './types.ts'
import { clamp, drift as driftFn, normalizeScores, quantTierFor, sha256Hex } from './math.ts'

export interface FingerprintInput {
  model: string
  backend: CaptureBackend
  domainScores: Record<string, number>
  probeComposite: number
  layerStats: LayerMoments[]
  baseline?: LayerStatLikeImportance[]
  scratchpadDrift?: number
  tempCode?: number
  tempReasoning?: number
  /** API-hosted model fingerprint (backend 'api'). */
  api?: ApiFingerprint
  /** Locally profiled twins used to ground the tensor forecast for API models. */
  twins?: ReferenceTwin[]
}

export interface LayerStatLikeImportance {
  layer: number
  importance: number
}

export interface BuildOptions {
  baseType?: string
  tokenEmbeddingType?: string
  outputTensorType?: string
}

/**
 * Normalize raw composite importances to [0, 1] before thresholding so the
 * tier rules (0.85 / 0.35) are model-agnostic.
 */
export function normalizeLayerImportance(stats: LayerMoments[]): LayerMoments[] {
  const raw = stats.map(s => s.importance)
  const normalized = normalizeScores(raw)
  return stats.map((s, i) => ({ ...s, importance: normalized[i] ?? 0 }))
}

/** Group a tier mapping into consecutive-layer rules. */
export function quantPlanFromTiers(layers: { layer: number; tier: 'f16' | 'q8_0' | 'q4_k_m' | 'iq2_xxs' }[], base: {
  baseType: string
  tokenEmbeddingType: string
  outputTensorType: string
}): QuantPlan {
  const byTier = new Map<'f16' | 'q8_0' | 'q4_k_m' | 'iq2_xxs', number[]>()
  for (const l of layers) {
    const list = byTier.get(l.tier) ?? []
    list.push(l.layer)
    byTier.set(l.tier, list)
  }
  const rules: QuantRule[] = []
  const ordered: ('iq2_xxs' | 'q4_k_m' | 'q8_0' | 'f16')[] = ['iq2_xxs', 'q4_k_m', 'q8_0', 'f16']
  for (const tier of ordered) {
    const list = byTier.get(tier)
    if (list && list.length > 0) rules.push({ tier, layers: list })
  }
  return {
    baseType: base.baseType,
    tokenEmbeddingType: base.tokenEmbeddingType,
    outputTensorType: base.outputTensorType,
    rules,
  }
}

const DEFAULT_BUILD = {
  baseType: 'Q4_K_M',
  tokenEmbeddingType: 'q4_k',
  outputTensorType: 'q8_0',
} as const

/** Concrete build options with defaults already resolved. */
type ResolvedBuild = { baseType: string; tokenEmbeddingType: string; outputTensorType: string }

export function buildFingerprint(input: FingerprintInput, options: BuildOptions = {}): ModelProfile {
  const base: ResolvedBuild = {
    baseType: options.baseType ?? DEFAULT_BUILD.baseType,
    tokenEmbeddingType: options.tokenEmbeddingType ?? DEFAULT_BUILD.tokenEmbeddingType,
    outputTensorType: options.outputTensorType ?? DEFAULT_BUILD.outputTensorType,
  }
  const nonzero = input.layerStats.filter(s => Number.isFinite(s.importance) && s.importance > 0)
  const hasCapture = nonzero.length > 0
  const stats = normalizeLayerImportance(nonzero.length > 0 ? nonzero : input.layerStats)

  let quantPlan: QuantPlan = {
    ...base,
    rules: [],
  }
  let drift = 0
  if (hasCapture && input.baseline) {
    drift = driftFn(
      stats.map(s => ({ layer: s.layer, importance: s.importance })),
      input.baseline.map(b => ({ layer: b.layer, importance: b.importance })),
    )
  }
  const api = input.api
  if (api !== undefined) {
    return buildApiProfile(input, api)
  }

  if (hasCapture) {
    const tiers = stats.map(s => ({ layer: s.layer, tier: quantTierFor(s.importance) }))
    quantPlan = quantPlanFromTiers(tiers, base)
  }

  const threshold = input.scratchpadDrift ?? 0.65
  const scratchpad = !hasCapture ? 'off' : drift > threshold ? 'always' : drift > 0.35 ? 'on-error' : 'off'
  const reasoning = input.tempReasoning ?? 0.6
  const codeTemp = input.tempCode ?? 0.1
  const weakReasoning = (input.domainScores['logic'] ?? 0.5) < 0.5 || (input.domainScores['instructions'] ?? 0.5) < 0.5

  return {
    schemaVersion: 1,
    model: input.model,
    backend: input.backend,
    generatedAt: new Date().toISOString(),
    probeComposite: clamp(input.probeComposite, 0, 1),
    domainScores: input.domainScores,
    layerStats: stats,
    quantPlan,
    policy: {
      scratchpad,
      drift,
      temperature: {
        code: codeTemp,
        reasoning: weakReasoning ? reasoning : clamp(0.3 + input.probeComposite * 0.3, 0.3, 0.6),
        default: 0.4,
      },
    },
    tensorGrounded: hasCapture,
  }
}

/**
 * API-hosted profile: policy derives from behavioral stability/calibration,
 * and the quant plan comes from the tensor forecast (uniform + estimated when
 * no local twin grounds it; twin plans carry their own base/token/output
 * tensor types).
 */
function buildApiProfile(input: FingerprintInput, api: ApiFingerprint): ModelProfile {
  const forecast = forecastQuantPlan(api, input.twins ?? [])
  const stability = api.stability
  const calibration = api.calibrationError
  const scratchpad = stability < 0.55 ? 'always' : stability < 0.8 ? 'on-error' : 'off'
  const reasoning = calibration !== null && calibration < 0.12 ? 0.6 : 0.35
  const codeTemp = input.tempCode ?? 0.1
  return {
    schemaVersion: 1,
    model: input.model,
    backend: 'api',
    generatedAt: new Date().toISOString(),
    probeComposite: clamp(input.probeComposite, 0, 1),
    domainScores: input.domainScores,
    layerStats: [],
    quantPlan: forecast.plan,
    policy: {
      scratchpad,
      // Behavioral drift proxy: unstable answers behave like a drifting net.
      drift: 1 - stability,
      temperature: {
        code: codeTemp,
        reasoning,
        default: 0.4,
      },
    },
    tensorGrounded: forecast.grounded,
    apiFingerprint: api,
    tensorForecast: forecast,
  }
}

/** Stable profile id used for artifact naming and drift baselines. */
export function profileId(profile: ModelProfile): string {
  const sig = `${profile.model}|${profile.backend}|${sha256Hex(JSON.stringify(profile.layerStats.map(s => [s.layer, s.importance] as const))).slice(0, 12)}`
  return sig
}
