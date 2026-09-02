/**
 * Asymmetric re-quant engine.
 *
 * Compiles the profile's 𝓘ₗ-based QuantPlan into real llama.cpp invocations:
 *   1. compute an importance matrix (`llama-imatrix`) when one isn't supplied
 *   2. run `llama-quantize --imatrix ... --tensor-type "blk\.(N)\.attn_.*=q8_0" ...`
 *   3. pull artifacts back (offload) and write a manifest alongside the output
 *
 * IQ2_XXS tiers REQUIRE an imatrix, so the engine always ensures one exists.
 */

import { mkdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import type { ModelProfile, QuantPlan } from '@solsticeai/equinox-profiler'
import {
  buildImatrixArgs,
  buildQuantizeArgs,
  EquinoxBridge,
  loadConfig,
  LocalExecutor,
  type EquinoxConfig,
  type Executor,
  type ExecResult,
} from '@solsticeai/equinox-lightning'

export interface RequantOptions {
  profile: ModelProfile
  modelIn: string
  modelOut: string
  /**
   * Permit re-quantizing from a profile whose quant plan is an *estimate*
   * (`tensorGrounded: false` — e.g. an API-hosted model with no local twin
   * grounding its tensor forecast). Defaults to false: estimated tier maps
   * are refused because they are not derived from this checkpoint's weights.
   */
  allowEstimated?: boolean
  /** Pre-computed imatrix .dat; when omitted and `corpus` is given, compute it. */
  imatrixDat?: string
  corpus?: string
  imatrixOut?: string
  /** Directory containing `modelIn` etc., uploaded when offloading. */
  bundleDir?: string
  config?: EquinoxConfig
  bridge?: EquinoxBridge
  executor?: Executor
}

export interface RequantManifest {
  model: string
  backend: ModelProfile['backend']
  plan: QuantPlan
  imatrix: string | null
  inSizeBytes: number
  outSizeBytes: number
  quantizeCmd: string[]
  imatrixCmd: string[] | null
  executed: boolean
  note?: string
}

export function quantTierSummary(plan: QuantPlan): string {
  return plan.rules.map(r => `${r.tier}(${r.layers.length} layers)`).join(', ') || 'uniform base quant'
}

export function findQuantizeBin(config: EquinoxConfig): string {
  return config.quantizeBin ?? 'llama-quantize'
}

export function findImatrixBin(config: EquinoxConfig): string {
  return config.imatrixBin ?? 'llama-imatrix'
}

export async function runRequant(options: RequantOptions): Promise<RequantManifest> {
  const config = options.config ?? loadConfig()
  const inSizeBytes = fileSizeOrZero(options.modelIn)
  if (!options.profile.tensorGrounded && options.allowEstimated !== true) {
    const manifest: RequantManifest = {
      model: options.profile.model,
      backend: options.profile.backend,
      plan: options.profile.quantPlan,
      imatrix: null,
      inSizeBytes,
      outSizeBytes: 0,
      quantizeCmd: [],
      imatrixCmd: null,
      executed: false,
      note: 'refusing estimated tensor plan (tensorGrounded: false — profile came from an API model without a local twin); pass allowEstimated to force',
    }
    return manifest
  }
  const plan = options.profile.quantPlan
  const base: Omit<RequantManifest, 'imatrix' | 'quantizeCmd' | 'imatrixCmd' | 'executed' | 'note'> = {
    model: options.profile.model,
    backend: options.profile.backend,
    plan,
    inSizeBytes,
    outSizeBytes: 0,
  }
  const bridge = options.bridge ?? new EquinoxBridge(config)
  const executor = options.executor ?? new LocalExecutor()
  const needsImatrix = plan.rules.some(r => r.tier === 'iq2_xxs')

  let imatrix: string | null = options.imatrixDat ?? null
  let imatrixCmd: string[] | null = null

  if (!imatrix && options.corpus && needsImatrix) {
    imatrix = options.imatrixOut ?? join(dirname(options.modelOut), `${basenameNoExt(options.modelIn)}.imatrix.dat`)
    imatrixCmd = buildImatrixArgs({ bin: findImatrixBin(config), model: options.modelIn, corpus: options.corpus, out: imatrix })
    const res = await runCmd(bridge, executor, imatrixCmd, 'imatrix', options)
    if (!imatrixExists(imatrix)) {
      return {
        ...base,
        imatrix: null,
        outSizeBytes: 0,
        quantizeCmd: [],
        imatrixCmd,
        executed: false,
        note: `imatrix generation failed: ${res.stderr.slice(0, 300)}`,
      }
    }
  } else if (!imatrix && needsImatrix) {
    return {
      ...base,
      imatrix: null,
      outSizeBytes: 0,
      quantizeCmd: [],
      imatrixCmd: null,
      executed: false,
      note: 'imatrix required for iq2_xxs tiers but no imatrixDat/corpus provided',
    }
  }

  const quantizeCmd = buildQuantizeArgs({
    bin: findQuantizeBin(config),
    modelIn: options.modelIn,
    modelOut: options.modelOut,
    plan,
    ...(imatrix !== null ? { imatrix } : {}),
  })
  const res = await runCmd(bridge, executor, quantizeCmd, 'quantize', options)

  mkdirSync(dirname(options.modelOut), { recursive: true })
  const outSizeBytes = fileSizeOrZero(options.modelOut)
  const manifest: RequantManifest = {
    ...base,
    imatrix,
    outSizeBytes,
    quantizeCmd,
    imatrixCmd,
    executed: res.ok,
    ...(res.ok ? {} : { note: res.stderr.slice(0, 300) }),
  }
  writeFileSync(`${options.modelOut}.manifest.json`, JSON.stringify(manifest, null, 2), 'utf8')
  return manifest
}

/** Run argv locally, or dispatch the same argv to the Lightning studio. */
async function runCmd(
  bridge: EquinoxBridge,
  executor: Executor,
  argv: string[],
  label: string,
  options: RequantOptions,
): Promise<ExecResult> {
  const offload = options.config?.cloud === true || bridge.mode.mode !== 'local'
  if (!offload) {
    return executor.run(argv, { timeoutMs: 1_800_000 })
  }
  const outBase = options.modelOut.split(/[\\/]/).pop() as string
  const imatrixBase = options.imatrixOut ? options.imatrixOut.split(/[\\/]/).pop() as string : null
  const outputs = label === 'quantize'
    ? [outBase, `${outBase}.manifest.json`]
    : imatrixBase
      ? [imatrixBase]
      : []
  return bridge.dispatch({
    name: `${label}-${Date.now()}`,
    command: argv.map(quoteArg).join(' '),
    outputs,
    ...(options.bundleDir !== undefined ? { bundleDir: options.bundleDir } : {}),
    localDir: dirname(options.modelOut),
  })
}

function quoteArg(arg: string): string {
  return /[^\w./-]/.test(arg) ? JSON.stringify(arg) : arg
}

function fileSizeOrZero(path: string): number {
  try {
    return statSync(path).size
  } catch {
    return 0
  }
}

function imatrixExists(path: string): boolean {
  return fileSizeOrZero(path) > 0
}

function basenameNoExt(path: string): string {
  const base = path.split(/[\\/]/).pop() ?? 'model'
  return base.replace(/\.gguf$/, '')
}
