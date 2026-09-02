import { describe, expect, it } from 'vitest'

import {
  buildImatrixArgs,
  buildQuantizeArgs,
  buildRemoteJobArgs,
  EquinoxBridge,
  jobState,
  printDryRun,
  quantPlanToTensorTypeArgs,
  remoteStudioUrl,
  shouldOffload,
} from '../src/index.ts'
import { loadConfig, type EquinoxConfig, type QuantPlan } from '../src/index.ts'

const PLAN: QuantPlan = {
  baseType: 'Q4_K_M',
  tokenEmbeddingType: 'q4_k',
  outputTensorType: 'q8_0',
  rules: [
    { tier: 'iq2_xxs', layers: [0, 1] },
    { tier: 'q4_k_m', layers: [2, 3] },
    { tier: 'q8_0', layers: [4] },
  ],
}

function cfg(overrides: Partial<EquinoxConfig>): EquinoxConfig {
  return { ...loadConfig({}), ...overrides }
}

describe('shouldOffload', () => {
  it('force-offloads when EQUINOX_CLOUD is set', () => {
    expect(shouldOffload(cfg({ cloud: true }), { cpus: 32, memBytes: 128e9, hasGpu: true }).mode).toBe('cloud')
  })
  it('offloads without a GPU', () => {
    expect(shouldOffload(cfg({}), { cpus: 8, memBytes: 32e9, hasGpu: false }).mode).toBe('cloud')
  })
  it('stays local with ample resources', () => {
    expect(shouldOffload(cfg({}), { cpus: 16, memBytes: 64e9, hasGpu: true }, 20).mode).toBe('local')
  })
  it('offloads on low memory or low disk', () => {
    expect(shouldOffload(cfg({}), { cpus: 16, memBytes: 2e9, hasGpu: true }).mode).toBe('cloud')
    expect(shouldOffload(cfg({}), { cpus: 16, memBytes: 64e9, hasGpu: true }, 1).mode).toBe('cloud')
  })
})

describe('quantPlanToTensorTypeArgs', () => {
  it('emits per-tier regex pairs, skipping the base tier', () => {
    const args = quantPlanToTensorTypeArgs(PLAN)
    expect(args).toContain('--tensor-type')
    const pairs = args.filter(a => a !== '--tensor-type')
    expect(pairs).toContain('blk\\.(0|1)\\.attn_.*=iq2_xxs')
    expect(pairs).toContain('blk\\.(0|1)\\.ffn_.*=iq2_xxs')
    expect(pairs).toContain('blk\\.(4)\\.attn_.*=q8_0')
    expect(pairs.some(p => p.includes('q4_k_m'))).toBe(false)
  })
})

describe('buildQuantizeArgs', () => {
  it('orders flags before positionals and appends base ftype', () => {
    const args = buildQuantizeArgs({ bin: 'llama-quantize', modelIn: 'in.gguf', modelOut: 'out.gguf', plan: PLAN, imatrix: 'm.dat' })
    expect(args[0]).toBe('llama-quantize')
    expect(args).toContain('--imatrix')
    expect(args).toContain('m.dat')
    expect(args).toContain('--token-embedding-type')
    expect(args.slice(-3)).toEqual(['in.gguf', 'out.gguf', 'Q4_K_M'])
  })

  it('omits imatrix when not provided', () => {
    const args = buildQuantizeArgs({ bin: 'llama-quantize', modelIn: 'i.gguf', modelOut: 'o.gguf', plan: PLAN })
    expect(args).not.toContain('--imatrix')
  })
})

describe('buildImatrixArgs', () => {
  it('builds a llama-imatrix invocation', () => {
    const args = buildImatrixArgs({ bin: 'llama-imatrix', model: 'm.gguf', corpus: 'c.txt', out: 'm.dat' })
    expect(args).toContain('-m')
    expect(args).toContain('m.gguf')
    const bIdx = args.indexOf('-b')
    expect(args[bIdx + 1]).toBe('512')
    expect(args[args.length - 1]).toBe('--process-output')
  })
})

describe('buildRemoteJobArgs', () => {
  it('includes studio, machine, name, command', () => {
    const args = buildRemoteJobArgs({ command: 'echo hi', studio: 'converter', machine: 'T4', name: 'job-1' })
    expect(args).toEqual(['job', 'run', '--name', 'job-1', '--machine', 'T4', '--studio', 'converter', '--command', 'echo hi'])
  })
})

describe('remoteStudioUrl', () => {
  it('builds a lit:// URL from config', () => {
    const url = remoteStudioUrl(cfg({ lightningOwner: 'acme', lightningTeamspace: 'ml', lightningStudio: 'converter' }), 'jobs/x/dat')
    expect(url).toBe('lit://acme/ml/studios/converter/jobs/x/dat')
  })
  it('throws when parts are missing', () => {
    expect(() => remoteStudioUrl(cfg({}), 'x')).toThrow(/EQUINOX_LIGHTNING_OWNER/)
  })
})

describe('EquinoxBridge dispatch (dry-run)', () => {
  it('prints a dry-run plan and never executes remote commands', async () => {
    let executed = 0
    const executor = {
      run: async (): Promise<never> => {
        executed++
        throw new Error('should not execute in dry-run')
      },
    }
    const bridge = new EquinoxBridge(cfg({ cloud: true, dryRun: true, lightningStudio: 'converter' }), { executor })
    const res = await bridge.dispatch({ name: 'quant-1', command: 'llama-quantize ...', outputs: ['out.gguf'] })
    expect(res.ok).toBe(true)
    expect(res.dryRun).toBe(true)
    expect(res.stdout).toContain('dry-run')
    expect(res.stdout).toContain('quant-1')
    expect(executed).toBe(0)
  })
})

describe('printDryRun', () => {
  it('describes the would-be job', () => {
    const text = printDryRun({ name: 'n', command: 'c', outputs: ['o'] }, cfg({ lightningStudio: 'converter' }))
    expect(text).toContain('converter')
    expect(text).toContain('o')
  })
})

describe('jobState', () => {
  it('parses state from inspect output', () => {
    expect(jobState('{"name":"j","state":"COMPLETED"}')).toBe('COMPLETED')
    expect(jobState('{"state": "RUNNING"}')).toBe('RUNNING')
    expect(jobState('{"foo":1}')).toBeNull()
  })
})
