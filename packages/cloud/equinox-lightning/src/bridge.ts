/**
 * Lightning AI cloud compute bridge.
 *
 * Detects whether the local machine can handle a workload; if not (or when
 * `EQUINOX_CLOUD=1`), bundles inputs, dispatches a job to the configured
 * Lightning Studio (`EQUINOX_LIGHTNING_STUDIO`), and pulls artifacts back via
 * the `lightning` CLI:
 *
 *   lightning job run  --studio <studio> --machine <type> --command "<cmd>"
 *   lightning cp       -r local lit://<owner>/<teamspace>/studios/<studio>/<path>
 *   lightning job inspect --name <job>          (poll to completion)
 *
 * `EQUINOX_DRY_RUN=1` prints commands instead of executing anything.
 */

import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { cpus, totalmem } from 'node:os'
import { join } from 'node:path'

import type { EquinoxConfig, QuantPlan, QuantRule } from './config.ts'

export type ExecMode = 'local' | 'cloud'

export interface OffloadCheck {
  mode: ExecMode
  reason: string
}

export interface Resources {
  cpus: number
  memBytes: number
  hasGpu: boolean
}

export function detectResources(): Resources {
  const cpus = Math.max(1, requireCpus())
  const memBytes = requireMemBytes()
  const hasGpu = detectGpu()
  return { cpus, memBytes, hasGpu }
}

function requireCpus(): number {
  return cpus().length
}

function requireMemBytes(): number {
  return totalmem()
}

function detectGpu(): boolean {
  const probe = spawnSync('nvidia-smi', ['-L'], { stdio: 'pipe', timeout: 5000 })
  return probe.status === 0 && probe.stdout.toString().includes('GPU')
}

const LOW_MEM_BYTES = 8 * 1024 * 1024 * 1024 // 8 GiB
const MIN_CPUS = 4
const MIN_FREE_GB = 3

/** Decide execution mode: local vs offloaded to the Lightning Studio. */
export function shouldOffload(
  config: EquinoxConfig,
  resources: Resources = detectResources(),
  freeDiskGb?: number,
): OffloadCheck {
  if (config.cloud) return { mode: 'cloud', reason: 'EQUINOX_CLOUD forced' }
  if (!resources.hasGpu) return { mode: 'cloud', reason: 'no local GPU detected' }
  if (resources.memBytes < LOW_MEM_BYTES) return { mode: 'cloud', reason: `low memory (${(resources.memBytes / 1e9).toFixed(1)} GiB)` }
  if (resources.cpus < MIN_CPUS) return { mode: 'cloud', reason: `few CPUs (${resources.cpus})` }
  if (freeDiskGb !== undefined && freeDiskGb < MIN_FREE_GB) {
    return { mode: 'cloud', reason: `low free disk (${freeDiskGb.toFixed(1)} GiB)` }
  }
  return { mode: 'local', reason: 'resources sufficient' }
}

export interface ExecResult {
  ok: boolean
  stdout: string
  stderr: string
  code: number | null
  dryRun?: boolean
}

export interface Executor {
  run(argv: string[], opts?: { cwd?: string; timeoutMs?: number }): Promise<ExecResult>
}

/** Runs a process locally with argv, capturing output. */
export class LocalExecutor implements Executor {
  async run(argv: string[], opts: { cwd?: string; timeoutMs?: number } = {}): Promise<ExecResult> {
    return execProcess(argv[0] as string, argv.slice(1), opts)
  }
}

export function execProcess(
  cmd: string,
  args: string[],
  opts: { cwd?: string; timeoutMs?: number } = {},
): Promise<ExecResult> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: opts.timeoutMs ?? 600_000,
      shell: false,
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d: Buffer) => {
      stdout += d.toString()
    })
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString()
    })
    child.on('error', (err: Error) => {
      resolve({ ok: false, stdout, stderr: stderr + err.message, code: -1 })
    })
    child.on('close', (code) => {
      resolve({ ok: code === 0, stdout, stderr, code })
    })
  })
}

const TIER_QTYPE: Record<QuantRule['tier'], string> = {
  f16: 'f16',
  q8_0: 'q8_0',
  q4_k_m: 'q4_k_m',
  iq2_xxs: 'iq2_xxs',
}

/** Compile a QuantPlan into `--tensor-type "REGEX=QTYPE"` pairs. */
export function quantPlanToTensorTypeArgs(plan: QuantPlan): string[] {
  const args: string[] = []
  for (const rule of plan.rules) {
    if (rule.tier === 'q4_k_m') continue // base quant already covers mid tier
    const qtype = TIER_QTYPE[rule.tier]
    for (const family of ['attn', 'ffn'] as const) {
      const pattern = `blk\\.(${rule.layers.join('|')})\\.${family}_.*=${qtype}`
      args.push('--tensor-type', pattern)
    }
  }
  return args
}

export interface ImatrixArgsOptions {
  bin: string
  model: string
  corpus: string
  out: string
  ctx?: number
  batch?: number
}

export function buildImatrixArgs(opts: ImatrixArgsOptions): string[] {
  return [
    opts.bin,
    '-m', opts.model,
    '-f', opts.corpus,
    '-o', opts.out,
    '-c', String(opts.ctx ?? 512),
    '-b', String(opts.batch ?? 512),
    '--process-output',
  ]
}

export interface QuantizeArgsOptions {
  bin: string
  modelIn: string
  modelOut: string
  plan: QuantPlan
  imatrix?: string
}

export function buildQuantizeArgs(opts: QuantizeArgsOptions): string[] {
  const args = [opts.bin]
  if (opts.imatrix) args.push('--imatrix', opts.imatrix)
  args.push('--token-embedding-type', opts.plan.tokenEmbeddingType)
  args.push('--output-tensor-type', opts.plan.outputTensorType)
  args.push(...quantPlanToTensorTypeArgs(opts.plan))
  args.push(opts.modelIn, opts.modelOut, opts.plan.baseType)
  return args
}

export interface RemoteJobArgsOptions {
  command: string
  studio?: string
  machine?: string
  name?: string
  teamspace?: string
}

export function buildRemoteJobArgs(opts: RemoteJobArgsOptions): string[] {
  const args = ['job', 'run']
  if (opts.name) args.push('--name', opts.name)
  if (opts.machine) args.push('--machine', opts.machine)
  if (opts.studio) args.push('--studio', opts.studio)
  if (opts.teamspace) args.push('--teamspace', opts.teamspace)
  args.push('--command', opts.command)
  return args
}

/** `lit://<owner>/<teamspace>/studios/<studio>/<path>` — requires config. */
export function remoteStudioUrl(config: EquinoxConfig, relPath: string): string {
  const owner = config.lightningOwner
  const teamspace = config.lightningTeamspace
  const studio = config.lightningStudio
  if (!owner || !teamspace || !studio) {
    throw new Error(
      'Lightning remote URL requires EQUINOX_LIGHTNING_OWNER, EQUINOX_LIGHTNING_TEAMSPACE and EQUINOX_LIGHTNING_STUDIO',
    )
  }
  return `lit://${owner}/${teamspace}/studios/${studio}/${relPath.replace(/^\/+/, '')}`
}

export interface DispatchOptions {
  name: string
  /** Full shell command to run on the remote (or locally in 'local' mode). */
  command: string
  /** Relative output artifacts to pull back from the remote after the job. */
  outputs: string[]
  /** Directory to bundle and upload (uploaded to `<remoteDir>/bundle`). */
  bundleDir?: string
  localDir?: string
  remoteDir?: string
  machine?: string
}

const JOB_STATE_RE = /"state"\s*:\s*"([A-Z_]+)"/i

/**
 * The bridge: dispatches a workload that is too heavy for local compute.
 * Honors dry-run mode and returns structured results.
 */
export class EquinoxBridge {
  constructor(
    private readonly config: EquinoxConfig,
    private readonly deps: { executor?: Executor; resources?: Resources } = {},
  ) {}

  get mode(): OffloadCheck {
    const resources = this.deps.resources ?? detectResources()
    return shouldOffload(this.config, resources)
  }

  async dispatch(opts: DispatchOptions): Promise<ExecResult> {
    if (this.mode.mode === 'local' && !this.config.cloud) {
      return this.deps.executor?.run(opts.command.split(' ')) ?? execShell(opts.command)
    }
    return this.dispatchRemote(opts)
  }

  async dispatchRemote(opts: DispatchOptions, _attempt = 0): Promise<ExecResult> {
    if (this.config.dryRun) {
      const printed = printDryRun(opts, this.config)
      return { ok: true, stdout: printed, stderr: '', code: 0, dryRun: true }
    }
    if (!this.config.lightningStudio) {
      return { ok: false, stdout: '', stderr: 'EQUINOX_LIGHTNING_STUDIO unset; set it to your Lightning Studio name', code: -1 }
    }
    const executor = this.deps.executor ?? new LocalExecutor()
    const remoteDir = opts.remoteDir ?? 'equinox-jobs'
    const remoteWork = `${remoteDir}/${opts.name}`
    const outUrl = (rel: string) => remoteStudioUrl(this.config, `${remoteWork}/${rel}`)

    // 1. Upload the bundle (corpus, script, tokenizer-free data).
    if (opts.bundleDir && existsSync(opts.bundleDir)) {
      const up = await executor.run(['cp', '-r', opts.bundleDir, outUrl('bundle')])
      if (!up.ok) return { ...up, stderr: `upload failed: ${up.stderr}` }
    }

    // 2. Dispatch the job (async). The command runs inside the Studio at /artifacts.
    const fullCommand = `cd /artifacts/${remoteWork} 2>/dev/null || mkdir -p /artifacts/${remoteWork} && cd /artifacts/${remoteWork}; mv /artifacts/${remoteWork}/bundle/* . 2>/dev/null; ${opts.command}`
    const jobArgs = buildRemoteJobArgs({
      name: opts.name,
      command: fullCommand,
      studio: this.config.lightningStudio,
      ...(opts.machine !== undefined
        ? { machine: opts.machine }
        : this.config.machine !== undefined ? { machine: this.config.machine } : {}),
      ...(this.config.lightningTeamspace !== undefined ? { teamspace: this.config.lightningTeamspace } : {}),
    })
    const jobRes = await executor.run(['lightning', ...jobArgs], { timeoutMs: 300_000 })
    if (!jobRes.ok) {
      return { ...jobRes, stderr: `job dispatch failed: ${jobRes.stderr}` }
    }

    // 3. Poll until completion.
    const polled = await this.waitForJob(executor, opts.name, 60)
    if (!polled.ok) return polled

    // 4. Pull artifacts back.
    for (const out of opts.outputs) {
      const local = join(opts.localDir ?? '.', out)
      const down = await executor.run(['cp', '-r', outUrl(out), local])
      if (!down.ok) return { ...down, stderr: `artifact pull failed for ${out}: ${down.stderr}` }
    }
    return { ok: true, stdout: `job ${opts.name} completed; artifacts pulled`, stderr: '', code: 0 }
  }

  /** Poll `lightning job inspect --name <job>` until terminal state. */
  async waitForJob(executor: Executor, name: string, maxAttempts = 60, intervalMs = 5_000): Promise<ExecResult> {
    if (this.config.dryRun) return { ok: true, stdout: `dry-run: would poll job ${name}`, stderr: '', code: 0, dryRun: true }
    for (let i = 0; i < maxAttempts; i++) {
      const res = await executor.run(['lightning', 'job', 'inspect', '--name', name], { timeoutMs: 60_000 })
      if (!res.ok) return { ...res, stderr: `job inspect failed: ${res.stderr}` }
      const state = jobState(res.stdout)
      if (state === 'COMPLETED' || state === 'SUCCEEDED' || state === 'FINISHED') return res
      if (state === 'FAILED' || state === 'CANCELLED' || state === 'STOPPED') {
        return { ...res, ok: false, stderr: `job ${name} ended in state ${state}` }
      }
      await sleep(intervalMs)
    }
    return { ok: false, stdout: '', stderr: `timed out waiting for job ${name}`, code: -1 }
  }
}

export function jobState(plainText: string): string | null {
  const m = JOB_STATE_RE.exec(plainText)
  return m ? (m[1] as string) : null
}

/** Try to locate a llama.cpp binary on PATH; suggest offload when missing. */
export function findLlamaBinary(bin: string | undefined, fallbackName: string): string | null {
  if (bin && existsSync(bin)) return bin
  const probe = spawnSync('which', [bin ?? fallbackName], { stdio: 'pipe' })
  if (probe.status === 0) return probe.stdout.toString().trim()
  return null
}

export function printDryRun(opts: DispatchOptions, config: EquinoxConfig): string {
  const remoteWork = `${opts.remoteDir ?? 'equinox-jobs'}/${opts.name}`
  const lines = [
    `[dry-run] would dispatch job "${opts.name}" to studio "${config.lightningStudio ?? '<unset>'}"`,
    `  command: ${opts.command}`,
    `  outputs: ${opts.outputs.join(', ')}`,
    `  remote workdir: ${remoteWork}`,
  ]
  if (opts.bundleDir) lines.push(`  would upload: ${opts.bundleDir} → ${remoteWork}/bundle`)
  return lines.join('\n')
}

function execShell(command: string): Promise<ExecResult> {
  return execProcess('bash', ['-lc', command])
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}
