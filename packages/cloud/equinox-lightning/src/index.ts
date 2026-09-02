/**
 * @module @solsticeai/equinox-lightning
 *
 * Cordis service exposing the Lightning AI cloud compute bridge: offload
 * detection, llama-imatrix / llama-quantize argv builders, `lightning job
 * run --studio` + `lightning cp` orchestration, and dry-run previews.
 * Config comes from `EQUINOX_*` (falling back to `DSH_*`) at construction.
 */

import { Context, Service } from '@solsticeai/cordis'
import z from '@solsticeai/schemastery'

import { loadConfig, type EquinoxConfig } from './config.ts'

declare module '@solsticeai/cordis' {
  interface Context {
    lightning: Lightning
  }
}

/** The bridge owns no static configuration; env (or per-call config) drives it. */
export type LightningConfig = Readonly<Record<string, never>>

/** Runtime schema for {@link LightningConfig}. */
export const Config = z.object({}) as unknown as z<LightningConfig>

function validateConfigKeys(config: LightningConfig): void {
  const [key] = Object.keys(config)
  if (key !== undefined) throw new Error(`equinox-lightning: unknown key "${key}"`)
}

/** Plugin entry: registers the lightning bridge service on every context. */
export class Lightning extends Service {
  static Config = Config

  config: EquinoxConfig

  constructor(ctx: Context, config: LightningConfig = {}) {
    super(ctx, 'lightning')
    validateConfigKeys(config)
    this.config = loadConfig()
  }

  /** Re-read configuration from the current environment. */
  reload(): EquinoxConfig {
    this.config = loadConfig()
    return this.config
  }
}

export default Lightning

// ——— public re-exports ———
export { loadConfig } from './config.ts'
export type { EquinoxConfig, QuantPlan, QuantRule, QuantTier } from './config.ts'
export type { ExecMode, ExecResult, Executor, ImatrixArgsOptions, OffloadCheck, QuantizeArgsOptions, RemoteJobArgsOptions, Resources } from './bridge.ts'
export {
  EquinoxBridge,
  LocalExecutor,
  buildImatrixArgs,
  buildQuantizeArgs,
  buildRemoteJobArgs,
  detectResources,
  execProcess,
  findLlamaBinary,
  jobState,
  printDryRun,
  quantPlanToTensorTypeArgs,
  remoteStudioUrl,
  shouldOffload,
} from './bridge.ts'
export type { DispatchOptions } from './bridge.ts'
