/** Configuration + shared quant types for the lighting bridge package. */

export interface EquinoxConfig {
  /** Force cloud execution (`EQUINOX_CLOUD=1`). */
  cloud?: boolean
  /** Print commands instead of executing (`EQUINOX_DRY_RUN=1`). */
  dryRun?: boolean
  /** Lightning Studio name to dispatch jobs to. */
  lightningStudio?: string
  /** Lightning account owner for `lit://` artifact URLs. */
  lightningOwner?: string
  /** Lightning teamspace for `lit://` artifact URLs. */
  lightningTeamspace?: string
  /** Default Lightning machine type (e.g. `T4`). */
  machine?: string
  /** llama-quantize binary path. */
  quantizeBin?: string
  /** llama-imatrix binary path. */
  imatrixBin?: string
}

export type QuantTier = 'f16' | 'q8_0' | 'q4_k_m' | 'iq2_xxs'

export interface QuantRule {
  tier: QuantTier
  layers: number[]
}

export interface QuantPlan {
  baseType: string
  tokenEmbeddingType: string
  outputTensorType: string
  rules: QuantRule[]
}

const BOOL_ON = new Set(['1', 'true', 'yes', 'on'])

function pick(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const equinox = env[`EQUINOX_${name}`]
  if (equinox !== undefined) return equinox
  return env[`DSH_${name}`]
}

function pickBool(env: NodeJS.ProcessEnv, name: string): boolean | undefined {
  const v = pick(env, name)
  return v === undefined ? undefined : BOOL_ON.has(v.trim().toLowerCase())
}

/**
 * Load bridge config from environment, preferring `EQUINOX_*` and falling
 * back to the harness's `DSH_*` namespace, per the project invariant.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): EquinoxConfig {
  const cloud = pickBool(env, 'CLOUD')
  const dryRun = pickBool(env, 'DRY_RUN')
  const lightningStudio = pick(env, 'LIGHTNING_STUDIO')
  const lightningOwner = pick(env, 'LIGHTNING_OWNER')
  const lightningTeamspace = pick(env, 'LIGHTNING_TEAMSPACE')
  const machine = pick(env, 'LIGHTNING_MACHINE')
  const quantizeBin = pick(env, 'QUANTIZE_BIN')
  const imatrixBin = pick(env, 'IMATRIX_BIN')
  return {
    ...(cloud !== undefined ? { cloud } : {}),
    ...(dryRun !== undefined ? { dryRun } : {}),
    ...(lightningStudio !== undefined ? { lightningStudio } : {}),
    ...(lightningOwner !== undefined ? { lightningOwner } : {}),
    ...(lightningTeamspace !== undefined ? { lightningTeamspace } : {}),
    ...(machine !== undefined ? { machine } : {}),
    ...(quantizeBin !== undefined ? { quantizeBin } : {}),
    ...(imatrixBin !== undefined ? { imatrixBin } : {}),
  }
}
