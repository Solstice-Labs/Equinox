/**
 * @module @solsticeai/equinox-requant
 *
 * Cordis service owning the asymmetric re-quant engine: compiles a profile's
 * 𝓘ₗ-based QuantPlan into real llama.cpp invocations
 * (`--imatrix ... --tensor-type "blk\\.(N)\\.attn_.*=q8_0"`), ensuring an
 * importance matrix exists whenever IQ2_XXS tiers are selected, and writing
 * a manifest beside the output model. Wave-one surface of the distillation
 * pipeline; the teacher/interceptor/calibration planes land in a later wave.
 */

import { Context, Service } from '@solsticeai/cordis'
import z from '@solsticeai/schemastery'

import { runRequant } from './quantize.ts'

declare module '@solsticeai/cordis' {
  interface Context {
    requant: Requantizer
  }
}

/** The re-quant engine owns no static configuration; call sites pass options. */
export type RequantizerConfig = Readonly<Record<string, never>>

/** Runtime schema for {@link RequantizerConfig}. */
export const Config = z.object({}) as unknown as z<RequantizerConfig>

function validateConfigKeys(config: RequantizerConfig): void {
  const [key] = Object.keys(config)
  if (key !== undefined) throw new Error(`equinox-requant: unknown key "${key}"`)
}

/** Plugin entry: registers the requantizer service on every context. */
export class Requantizer extends Service {
  static Config = Config

  constructor(ctx: Context, config: RequantizerConfig = {}) {
    super(ctx, 'requant')
    validateConfigKeys(config)
  }

  /** Run an asymmetric re-quantization pass for a profile. */
  run(options: Parameters<typeof runRequant>[0]): ReturnType<typeof runRequant> {
    return runRequant(options)
  }
}

export default Requantizer

// ——— public re-exports ———
export { findImatrixBin, findQuantizeBin, quantTierSummary, runRequant } from './quantize.ts'
export type { RequantManifest, RequantOptions } from './quantize.ts'
