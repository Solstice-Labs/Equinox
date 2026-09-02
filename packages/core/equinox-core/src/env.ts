/**
 * Environment resolution with the hard invariant:
 *
 *   Every configuration reads from `EQUINOX_*` first, falling back to `DSH_*`.
 */

export type EnvSource = 'EQUINOX' | 'DSH' | 'default'

export interface ResolvedEnv<T> {
  value: T
  source: EnvSource
}

const PREFIXES = ['EQUINOX', 'DSH'] as const

export function readEnv(
  key: string,
  fallback?: string,
  env: NodeJS.ProcessEnv = process.env,
): ResolvedEnv<string | undefined> {
  for (const prefix of PREFIXES) {
    const raw = env[`${prefix}_${key}`]
    if (raw !== undefined && raw !== '') {
      return { value: raw, source: prefix }
    }
  }
  return { value: fallback, source: 'default' }
}

export function readInt(key: string, fallback: number, env: NodeJS.ProcessEnv = process.env): ResolvedEnv<number> {
  const { value, source } = readEnv(key, undefined, env)
  if (value === undefined) return { value: fallback, source: 'default' }
  const parsed = Number.parseInt(value, 10)
  if (Number.isNaN(parsed)) return { value: fallback, source: 'default' }
  return { value: parsed, source }
}

export function readFloat(key: string, fallback: number, env: NodeJS.ProcessEnv = process.env): ResolvedEnv<number> {
  const { value, source } = readEnv(key, undefined, env)
  if (value === undefined) return { value: fallback, source: 'default' }
  const parsed = Number.parseFloat(value)
  if (Number.isNaN(parsed)) return { value: fallback, source: 'default' }
  return { value: parsed, source }
}

export function readBool(key: string, fallback: boolean, env: NodeJS.ProcessEnv = process.env): ResolvedEnv<boolean> {
  const { value, source } = readEnv(key, undefined, env)
  if (value === undefined) return { value: fallback, source: 'default' }
  return { value: ['1', 'true', 'yes', 'on'].includes(value.toLowerCase()), source }
}

export function readList(key: string, fallback: string[], env: NodeJS.ProcessEnv = process.env): ResolvedEnv<string[]> {
  const { value, source } = readEnv(key, undefined, env)
  if (value === undefined) return { value: fallback, source: 'default' }
  const list = value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
  return { value: list, source }
}

export const DEFAULT_CONFIG: EquinoxConfig = {
  baseUrl: 'http://localhost:8080/v1',
  model: 'local-model',
  provider: 'openai-compatible',
  timeoutMs: 60_000,
  maxRetries: 3,
  concurrency: 4,
  maxSteps: 24,
  cloud: false,
  dryRun: false,
  machine: 'T4',
  calPoolSize: 512,
  teacher: 'api',
  teacherCmd: [],
  home: '.equinox',
  tempCode: 0.1,
  tempReasoning: 0.6,
  scratchpadDrift: 0.65,
  liveProbeOnly: false,
}

export interface EquinoxConfig {
  /** Base URL of any OpenAI-compatible endpoint (llama.cpp, Ollama, vLLM, SGLang, MLX-LM, cloud APIs). */
  baseUrl: string
  apiKey?: string
  model: string
  provider: string
  timeoutMs: number
  maxRetries: number
  concurrency: number
  /** Max tool-loop iterations in the agent execution loop. */
  maxSteps: number
  /** Force offload of compute-heavy workloads to the Lightning studio. */
  cloud: boolean
  /** Do not actually execute remote commands; print them instead. */
  dryRun: boolean
  /** Lightning machine type for dispatched jobs. */
  machine: string
  /** Mixed calibration pool target size. */
  calPoolSize: number
  teacher: 'api' | 'claude' | 'codex' | 'gemini'
  teacherCmd: string[]
  teacherModel?: string
  lightningStudio?: string
  lightningTeamspace?: string
  lightningOwner?: string
  imatrixBin?: string
  quantizeBin?: string
  llamaServerBin?: string
  home: string
  tempCode: number
  tempReasoning: number
  /** Composite-drift threshold above which `<thinking>` scratchpads are injected. */
  scratchpadDrift: number
  /** When true, skip probes that require model responses and only run local checks. */
  liveProbeOnly: boolean
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): EquinoxConfig {
  const baseUrl = readEnv('BASE_URL', DEFAULT_CONFIG.baseUrl, env)
  const apiKey = readEnv('API_KEY', undefined, env)
  const model = readEnv('MODEL', DEFAULT_CONFIG.model, env)
  const provider = readEnv('PROVIDER', (baseUrl.value ?? DEFAULT_CONFIG.baseUrl).includes('11434') ? 'ollama' : 'openai-compatible', env)
  const teacher = readEnv('TEACHER', DEFAULT_CONFIG.teacher, env)
  const cloud = readBool('CLOUD', DEFAULT_CONFIG.cloud, env)
  const dryRun = readBool('DRY_RUN', DEFAULT_CONFIG.dryRun, env)
  const home = readEnv('HOME_DIR', DEFAULT_CONFIG.home, env)
  const scratchpadDrift = readFloat('SCRATCHPAD_DRIFT', DEFAULT_CONFIG.scratchpadDrift, env)

  return {
    baseUrl: baseUrl.value ?? DEFAULT_CONFIG.baseUrl,
    apiKey: apiKey.value,
    model: model.value ?? DEFAULT_CONFIG.model,
    provider: provider.value ?? 'openai-compatible',
    timeoutMs: readInt('TIMEOUT_MS', DEFAULT_CONFIG.timeoutMs, env).value,
    maxRetries: readInt('MAX_RETRIES', DEFAULT_CONFIG.maxRetries, env).value,
    concurrency: readInt('CONCURRENCY', DEFAULT_CONFIG.concurrency, env).value,
    maxSteps: readInt('MAX_STEPS', DEFAULT_CONFIG.maxSteps, env).value,
    cloud: cloud.value,
    dryRun: dryRun.value,
    machine: readEnv('LIGHTNING_MACHINE', DEFAULT_CONFIG.machine, env).value!,
    calPoolSize: readInt('CAL_POOL_SIZE', DEFAULT_CONFIG.calPoolSize, env).value,
    teacher: isValidTeacher(teacher.value) ? teacher.value : DEFAULT_CONFIG.teacher,
    teacherCmd: readList('TEACHER_CMD', [], env).value,
    teacherModel: readEnv('TEACHER_MODEL', undefined, env).value,
    lightningStudio: readEnv('LIGHTNING_STUDIO', undefined, env).value,
    lightningTeamspace: readEnv('LIGHTNING_TEAMSPACE', undefined, env).value,
    lightningOwner: readEnv('LIGHTNING_OWNER', undefined, env).value,
    imatrixBin: readEnv('IMATRIX_BIN', undefined, env).value,
    quantizeBin: readEnv('QUANTIZE_BIN', undefined, env).value,
    llamaServerBin: readEnv('LLAMA_SERVER_BIN', undefined, env).value,
    home: home.value ?? DEFAULT_CONFIG.home,
    tempCode: readFloat('TEMP_CODE', DEFAULT_CONFIG.tempCode, env).value,
    tempReasoning: readFloat('TEMP_REASONING', DEFAULT_CONFIG.tempReasoning, env).value,
    scratchpadDrift: scratchpadDrift.value,
    liveProbeOnly: readBool('LIVE_PROBE_ONLY', DEFAULT_CONFIG.liveProbeOnly, env).value,
  }
}

function isValidTeacher(v: string | undefined): v is EquinoxConfig['teacher'] {
  return v === 'api' || v === 'claude' || v === 'codex' || v === 'gemini'
}