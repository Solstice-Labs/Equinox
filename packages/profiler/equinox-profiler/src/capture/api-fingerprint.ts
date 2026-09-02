/**
 * Behavioral fingerprinting for API-hosted models (no weights available).
 *
 * Local profiling reads per-layer activations; a black-box API exposes none,
 * so this backend measures the behavioral counterparts instead:
 *
 *   1. base correctness   — the 50-probe suite at low temperature (T≈0.1)
 *   2. consistency        — repeat runs at high temperature (T=0.9); agreement
 *                           with the base verdict is an activation-variance
 *                           proxy: a model whose internals wobble produces
 *                           verdicts that flip between runs
 *   3. commitment/entropy — when the endpoint exposes per-token logprobs,
 *                           mean response-token entropy in bits (information
 *                           dynamic-range proxy)
 *   4. calibration        — per-domain |consistency − baseScore|: does the
 *                           model's own stability track its correctness
 *   5. robustness         — verdict invariance under deterministic prompt
 *                           perturbation (input-invariance proxy)
 *
 * Single-turn probes are sweepable; tool-flow probes score once through the
 * base suite only (no repeat sandbox sessions).
 */

import { clamp, mean, normalizeScores } from '../math.ts'
import type { Probe } from '../probes/types.ts'
import { ALL_PROBES, PROBE_DOMAINS } from '../probes/index.ts'
import type {
  ApiCapabilityStats,
  ApiFingerprint,
  ProbeMessage,
  ProbeOutcome,
  SuiteResult,
} from '../types.ts'
import type { SampledResponse, TokenLogprob } from '../client/openai-client.ts'

export interface SamplerOptions {
  temperature: number
  seed?: number
  maxTokens?: number
  logprobs?: boolean
  signal?: AbortSignal
}

/** Low-level sampling seam: probe messages in, sampled text (and logprobs) out. */
export type Sampler = (messages: ProbeMessage[], options: SamplerOptions) => Promise<SampledResponse>

export interface ApiFingerprintOptions {
  model: string
  family?: string
  params?: number
  /** The probe suite already run at low temperature (its outcomes are the base pass). */
  baseSuite: SuiteResult
  /** Sampling backend for the sweeps (OpenAI-compatible client, mock, …). */
  sampler: Sampler
  /** Probe registry providing graders + messages (defaults to the full 50). */
  probes?: Probe[]
  /** High-temperature repeats per probe (default 2). */
  consistencyRepeats?: number
  /** Deterministic robustness probes to perturb — one per domain by default. */
  robustnessProbes?: Probe[]
  /** Ask the sampler for logprobs during the sweeps. */
  logprobs?: boolean
  /** Seed anchor for repeat/perturbed runs (default 42). */
  seedBase?: number
}

interface RepeatMeasurement {
  verdict: boolean
  entropy: number | null
}

export interface SweepMeasurement {
  domain: Probe['domain']
  /** Suite verdict at low temperature. */
  base: boolean
  /** High-temperature repeat verdicts. */
  repeats: RepeatMeasurement[]
}

export interface RobustnessMeasurement {
  invariant: boolean
  entropy: number | null
}

/** Mean −log₂(p) over response tokens, in bits. */
function entropyBits(logprobs: TokenLogprob[] | null | undefined): number | null {
  if (logprobs === null || logprobs === undefined || logprobs.length === 0) return null
  let acc = 0
  for (const point of logprobs) acc += (-point.logprob) / Math.LN2
  return acc / logprobs.length
}

function entropyMean(values: (number | null)[]): number | null {
  const finite: number[] = []
  for (const value of values) {
    if (value !== null) finite.push(value)
  }
  return finite.length > 0 ? mean(finite) : null
}

function varianceOfBooleans(values: boolean[]): number {
  const n = values.length
  if (n === 0) return 0
  const share = values.filter(v => v).length / n
  return share * (1 - share)
}

/** Deterministic synonym perturbations that preserve meaning. */
const PERTURBATIONS: [RegExp, string][] = [
  [/\bReturn\b/g, 'Output'],
  [/\bProduce\b/g, 'Create'],
  [/\bEncode\b/g, 'Serialize'],
  [/\bChoose\b/g, 'Select'],
  [/\bDescribe\b/g, 'Explain'],
]

export function perturbText(text: string): string {
  let out = text
  for (const [pattern, replacement] of PERTURBATIONS) out = out.replace(pattern, replacement)
  return out === text ? `Carefully double-check your answer. ${text}` : out
}

/** Perturb the last user turn of a probe in place (returns a new probe). */
export function perturbProbe(probe: Probe): Probe {
  const messages = probe.messages.map(m => ({ ...m }))
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (message !== undefined && message.role === 'user') {
      message.content = perturbText(message.content)
      break
    }
  }
  return { ...probe, messages }
}

/** Default robustness set: the first single-turn probe of each domain. */
export function pickRobustnessProbes(probes: Probe[]): Probe[] {
  const chosen: Probe[] = []
  for (const domain of PROBE_DOMAINS) {
    const single = probes.find(p => p.domain === domain && p.grader !== undefined)
    if (single !== undefined) chosen.push(single)
  }
  return chosen
}

async function sampleOnce(
  probe: Probe,
  sampler: Sampler,
  temperature: number,
  seed: number,
  logprobs: boolean,
): Promise<RepeatMeasurement & { text: string }> {
  const response = await sampler(probe.messages, {
    temperature,
    ...(logprobs ? { logprobs: true } : {}),
    ...{ seed },
    ...(probe.maxTokens !== undefined ? { maxTokens: probe.maxTokens } : {}),
  })
  const grader = probe.grader
  const verdict = grader !== undefined && grader(response.text).pass
  return { verdict, entropy: entropyBits(response.logprobs), text: response.text }
}

/**
 * Run the sweep passes and reduce everything into an {@link ApiFingerprint}.
 * Tool-flow probes are skipped by the sweeps (their base score comes from the
 * suite); every call the sampler receives is counted in `samples`.
 */
export async function runApiFingerprint(options: ApiFingerprintOptions): Promise<ApiFingerprint> {
  const probes = options.probes ?? ALL_PROBES
  const repeats = Math.max(0, options.consistencyRepeats ?? 2)
  const logprobs = options.logprobs ?? false
  const seedBase = options.seedBase ?? 42
  const sampler = options.sampler

  const outcomeById = new Map<string, ProbeOutcome>()
  for (const outcome of options.baseSuite.outcomes) outcomeById.set(outcome.id, outcome)

  const sweepable = probes.filter(p => p.grader !== undefined && outcomeById.has(p.id))
  const robustnessProbes = options.robustnessProbes ?? pickRobustnessProbes(probes)

  const sweeps = new Map<string, SweepMeasurement>()
  const robustness = new Map<string, RobustnessMeasurement>()
  let samples = 0
  let sawLogprobs = false

  for (const probe of sweepable) {
    const outcome = outcomeById.get(probe.id)
    if (outcome === undefined) continue
    const repeatMeasurements: RepeatMeasurement[] = []
    for (let i = 0; i < repeats; i++) {
      const run = await sampleOnce(probe, sampler, 0.9, seedBase + i + 1, logprobs)
      if (run.entropy !== null) sawLogprobs = true
      repeatMeasurements.push({ verdict: run.verdict, entropy: run.entropy })
      samples += 1
    }
    sweeps.set(probe.id, { domain: probe.domain, base: outcome.pass, repeats: repeatMeasurements })
  }

  for (const probe of robustnessProbes) {
    const outcome = outcomeById.get(probe.id)
    if (outcome === undefined) continue
    const run = await sampleOnce(perturbProbe(probe), sampler, 0.1, seedBase + 1000, logprobs)
    if (run.entropy !== null) sawLogprobs = true
    robustness.set(probe.id, { invariant: run.verdict === outcome.pass, entropy: run.entropy })
    samples += 1
  }

  return reduceApiFingerprint({
    model: options.baseSuite.model,
    ...(options.family !== undefined ? { family: options.family } : {}),
    ...(options.params !== undefined ? { params: options.params } : {}),
    domainScores: options.baseSuite.domainScores,
    composite: options.baseSuite.composite,
    sweeps,
    robustness,
    sawLogprobs,
    samples,
  })
}

export interface ReduceInput {
  model: string
  family?: string
  params?: number
  domainScores: Record<string, number>
  composite: number
  sweeps: Map<string, SweepMeasurement>
  robustness: Map<string, RobustnessMeasurement>
  sawLogprobs: boolean
  samples: number
}

/**
 * Pure reduction of sweep measurements into a fingerprint (unit-testable).
 * Domain consistency = mean per-probe agreement between high-T repeats and
 * the base verdict; domains with no sweepable probes (e.g. tools) report
 * their base score as consistency and null calibration.
 */
export function reduceApiFingerprint(input: ReduceInput): ApiFingerprint {
  const capabilities: ApiCapabilityStats[] = []
  const pooledVariances: number[] = []
  const globalEntropies: number[] = []
  let measuredDomains = 0
  let calibrationAcc = 0

  for (const domain of PROBE_DOMAINS) {
    const baseScore = clamp(input.domainScores[domain] ?? 0, 0, 1)
    const domainSweepIds: string[] = []
    const domainAgreements: number[] = []
    const domainEntropies: number[] = []
    for (const [probeId, sweep] of input.sweeps) {
      if (sweep.domain !== domain) continue
      domainSweepIds.push(probeId)
      pooledVariances.push(varianceOfBooleans([sweep.base, ...sweep.repeats.map(r => r.verdict)]))
      if (sweep.repeats.length > 0) {
        const agreement = sweep.repeats.filter(r => r.verdict === sweep.base).length / sweep.repeats.length
        domainAgreements.push(agreement)
      }
      for (const repeat of sweep.repeats) {
        if (repeat.entropy !== null) domainEntropies.push(repeat.entropy)
      }
    }
    const robustnessValues: number[] = []
    for (const probeId of domainSweepIds) {
      const measurement = input.robustness.get(probeId)
      if (measurement !== undefined) {
        robustnessValues.push(measurement.invariant ? 1 : 0)
        if (measurement.entropy !== null) domainEntropies.push(measurement.entropy)
      }
    }

    const hasSweeps = domainSweepIds.length > 0
    const consistency = hasSweeps
      ? (domainAgreements.length > 0 ? mean(domainAgreements) : baseScore)
      : baseScore
    if (domainAgreements.length > 0) measuredDomains += 1

    for (const entropy of domainEntropies) globalEntropies.push(entropy)

    const calibrationError = domainAgreements.length > 0
      ? Math.abs(consistency - baseScore)
      : null
    if (calibrationError !== null) calibrationAcc += calibrationError

    capabilities.push({
      domain,
      baseScore,
      consistency,
      robustness: robustnessValues.length > 0 ? mean(robustnessValues) : null,
      commitment: entropyMean(domainEntropies.length > 0 ? domainEntropies : []),
      calibrationError,
      samples: domainSweepIds.length,
    })
  }

  const stability = pooledVariances.length > 0 ? 1 - mean(pooledVariances) : 1
  const overallCalibration = measuredDomains > 0 ? calibrationAcc / measuredDomains : null
  const blends: number[] = []
  for (const capability of capabilities) {
    blends.push(clamp(0.6 * capability.baseScore + 0.4 * capability.consistency, 0, 1))
  }
  const normalized = normalizeScores(blends)
  const capabilityVector = normalized.length === capabilities.length ? normalized : capabilities.map(() => 0.5)

  return {
    backend: 'api',
    model: input.model,
    ...(input.family !== undefined ? { family: input.family } : {}),
    ...(input.params !== undefined ? { params: input.params } : {}),
    capabilities,
    capabilityVector,
    composite: input.composite,
    stability,
    calibrationError: overallCalibration,
    entropy: globalEntropies.length > 0 ? mean(globalEntropies) : null,
    samples: input.samples,
    logprobsAvailable: input.sawLogprobs,
  }
}
