import type { ProbeDomain } from '@solsticeai/core'

import { CODING_PROBES } from './coding.js'
import { INSTRUCTIONS_PROBES } from './instructions.js'
import { LOGIC_PROBES } from './logic.js'
import { SYNTAX_PROBES } from './syntax.js'
import { TOOLS_PROBES } from './tools.js'
import type { Probe } from './types.js'

export type { Probe, ProbeFlow, ProbeFlowTurn } from './types.js'
export { SYNTAX_PROBES } from './syntax.js'
export { CODING_PROBES } from './coding.js'
export { LOGIC_PROBES } from './logic.js'
export { TOOLS_PROBES } from './tools.js'
export { INSTRUCTIONS_PROBES } from './instructions.js'

export const ALL_PROBES: Probe[] = [
  ...SYNTAX_PROBES,
  ...CODING_PROBES,
  ...LOGIC_PROBES,
  ...TOOLS_PROBES,
  ...INSTRUCTIONS_PROBES,
]

export const PROBE_DOMAINS: ProbeDomain[] = ['syntax', 'coding', 'logic', 'tools', 'instructions']

/** Structural sanity check: 50 probes, unique ids, 10 per domain. */
export function validateProbeSet(probes: Probe[] = ALL_PROBES): { ok: boolean; errors: string[] } {
  const errors: string[] = []
  if (probes.length !== 50) errors.push(`expected 50 probes, got ${probes.length}`)
  const ids = new Set<string>()
  for (const p of probes) {
    if (ids.has(p.id)) errors.push(`duplicate probe id ${p.id}`)
    ids.add(p.id)
    if (p.kind === 'tool-flow' && !p.flow) errors.push(`${p.id}: tool-flow without flow`)
    if (p.kind !== 'tool-flow' && !p.grader) errors.push(`${p.id}: missing grader`)
  }
  for (const domain of PROBE_DOMAINS) {
    const count = probes.filter((p) => p.domain === domain).length
    if (count !== 10) errors.push(`domain ${domain}: expected 10 probes, got ${count}`)
  }
  return { ok: errors.length === 0, errors }
}