/**
 * @module @solsticeai/equinox-profiler
 *
 * Cordis service owning the 50-probe deterministic diagnostic engine, the
 * offline graders, and the activation fingerprint builder (σ² / κ / 𝓘ₗ).
 * Pure-logic modules (probes, grader, math, fingerprint, capture) carry no
 * harness dependency so they stay runnable inside unit tests and headless
 * dispatch; the plugin class only registers them on `ctx.profiler`.
 */

import { Context, Service } from '@solsticeai/cordis'
import z from '@solsticeai/schemastery'

import { buildFingerprint } from './fingerprint.ts'
import { profileId as fingerprintProfileId } from './fingerprint.ts'
import { ALL_PROBES, validateProbeSet } from './probes/index.ts'
import { runProbeSuite } from './runner.ts'
import type { ModelProfile } from './types.ts'

declare module '@solsticeai/cordis' {
  interface Context {
    profiler: Profiler
  }
}

/** The profiler owns no static configuration; call sites pass options per run. */
export type ProfilerConfig = Readonly<Record<string, never>>

/** Runtime schema for {@link ProfilerConfig}. */
export const Config = z.object({}) as unknown as z<ProfilerConfig>

function validateConfigKeys(config: ProfilerConfig): void {
  const [key] = Object.keys(config)
  if (key !== undefined) throw new Error(`equinox-profiler: unknown key "${key}"`)
}

/** Plugin entry: registers the profiler service on every context. */
export class Profiler extends Service {
  static Config = Config

  constructor(ctx: Context, config: ProfilerConfig = {}) {
    super(ctx, 'profiler')
    validateConfigKeys(config)
  }

  /** The full 50-probe registry (10 per domain). */
  probes(): typeof ALL_PROBES {
    return ALL_PROBES
  }

  /** Structural sanity check over the probe set. */
  validate(): { ok: boolean; errors: string[] } {
    return validateProbeSet()
  }

  /** Run the suite against a model client (or a mock for dry runs). */
  runSuite(options: Parameters<typeof runProbeSuite>[0]): ReturnType<typeof runProbeSuite> {
    return runProbeSuite(options)
  }

  /** Build a model profile from probe scores + layer stats. */
  fingerprint(input: Parameters<typeof buildFingerprint>[0]): ReturnType<typeof buildFingerprint> {
    return buildFingerprint(input)
  }

  /** Stable profile id used for artifact naming and drift baselines. */
  profileId(profile: ModelProfile): string {
    return fingerprintProfileId(profile)
  }
}

export default Profiler

// ——— public re-exports ———
export type {
  CaptureBackend,
  ChatMessage,
  ChatOptions,
  ChatResult,
  ChatRole,
  LayerMoments,
  ModelClient,
  ModelProfile,
  ProbeDomain,
  ProbeMessage,
  ProbeOutcome,
  ProbeResult,
  QuantPlan,
  QuantRule,
  QuantTier,
  SuiteResult,
  TensorProxy,
  ToolCall,
} from './types.ts'
export {
  OUTLIER_KURTOSIS,
  STEERING_KURTOSIS,
  TIER_HIGH,
  TIER_MID_HIGH,
  clamp,
  compositeImportance,
  drift,
  kurtosis,
  layerImportance,
  mean,
  moment4,
  normalizeScores,
  quantTierFor,
  sha256Hex,
  variance,
} from './math.ts'
export type { Check } from './grader.ts'
export {
  all,
  checksToResult,
  countMatches,
  extractFencedBlock,
  extractJSON,
  hasBalancedBrackets,
  isArray,
  isBoolean,
  isInteger,
  isNumber,
  isPlainObject,
  isString,
  lines,
  parseJSONStrict,
  validateSchema,
} from './grader.ts'
export type { Probe, ProbeFlow, ProbeFlowTurn } from './probes/types.ts'
export { ALL_PROBES, CODING_PROBES, INSTRUCTIONS_PROBES, LOGIC_PROBES, PROBE_DOMAINS, SYNTAX_PROBES, TOOLS_PROBES, validateProbeSet } from './probes/index.ts'
export { buildFingerprint, normalizeLayerImportance, profileId, quantPlanFromTiers } from './fingerprint.ts'
export { runProbeSuite, ToolFlowRunner } from './runner.ts'
export { SandboxFS } from './sandbox.ts'
export {
  buildImatrixCorpus,
  imatrixToLayerStats,
  loadImatrixCapture,
  parseImatrixDat,
  tensorLayer,
} from './capture/imatrix.ts'
export type { ImatrixCaptureResult, ImatrixOptions, ImatrixRecord } from './capture/imatrix.ts'
export {
  parseHiddenStatesResult,
  renderHiddenStatesScript,
  writeCaptureScript,
  writeCorpus,
} from './capture/hidden-states.ts'
export type { HiddenStatesOptions, HiddenStatesResult } from './capture/hidden-states.ts'
export type { RunnerOptions } from './runner.ts'
export type { FingerprintInput, LayerStatLikeImportance } from './fingerprint.ts'
