/**
 * Compiles a Mixed Calibration Pool:
 *   30% general anchors (ShareGPT format) + 70% failure recoveries
 * to prevent calibration drift during background re-quantization.
 *
 * Selection is deterministic (seeded RNG) so a pool rebuilds identically.
 */

import type { ChatMessage } from '@solsticeai/core'
import { mulberry32, sha256Hex } from '@solsticeai/core'

export interface ShareGptEntry {
  conversations?: { from: string; value: string }[]
}

export interface CalibrationInput {
  anchors: ShareGptEntry[]
  /** Failure-recovery pairs: prompt → verified teacher resolution text. */
  recoveries: { prompt: string; resolution: string }[]
  poolSize?: number
  anchorRatio?: number
  seed?: number
}

export interface CalibrationEntry {
  messages: ChatMessage[]
  source: 'anchor' | 'recovery'
  sha: string
}

export interface CalibrationStats {
  poolSize: number
  anchorCount: number
  recoveryCount: number
  anchorRatio: number
  deduped: number
}

export interface CalibrationPoolResult {
  entries: CalibrationEntry[]
  stats: CalibrationStats
}

const ROLE_MAP: Record<string, ChatMessage['role']> = {
  human: 'user',
  user: 'user',
  system: 'system',
  gpt: 'assistant',
  assistant: 'assistant',
}

export function shareGptToMessages(entry: ShareGptEntry): ChatMessage[] | null {
  const convos = entry.conversations ?? []
  const messages: ChatMessage[] = []
  for (const c of convos) {
    const role = ROLE_MAP[String(c.from).toLowerCase()]
    if (!role || typeof c.value !== 'string' || c.value.trim() === '') continue
    messages.push({ role, content: c.value })
  }
  if (!messages.some((m) => m.role === 'user')) return null
  return messages
}

export function compileCalibrationPool(input: CalibrationInput): CalibrationPoolResult {
  const poolSize = input.poolSize ?? 512
  const anchorRatio = input.anchorRatio ?? 0.3
  const seed = input.seed ?? 42
  const rand = mulberry32(seed)

  const anchorMessages = input.anchors
    .map(shareGptToMessages)
    .filter((m): m is ChatMessage[] => m !== null)

  const recoveryMessages = input.recoveries
    .filter((r) => r.prompt.trim() !== '' && r.resolution.trim() !== '')
    .map((r): ChatMessage[] => [
      { role: 'user', content: r.prompt },
      { role: 'assistant', content: r.resolution },
    ])

  const anchorCount = Math.round(poolSize * anchorRatio)
  const recoveryCount = poolSize - anchorCount

  const entries: CalibrationEntry[] = []
  const seen = new Set<string>()
  let deduped = 0

  const sample = (candidates: ChatMessage[][], count: number, source: 'anchor' | 'recovery') => {
    const toSample = [...candidates]
    while (entries.length < poolSize && toSample.length > 0 && sampleRemaining(source, count)) {
      const idx = Math.floor(rand() * toSample.length)
      const chosen = toSample.splice(idx, 1)[0] as ChatMessage[]
      const sha = sha256Hex(JSON.stringify(chosen))
      if (seen.has(sha)) {
        deduped++
        continue
      }
      seen.add(sha)
      entries.push({ messages: chosen, source, sha })
    }
  }

  const sampleRemaining = (source: 'anchor' | 'recovery', target: number): boolean => {
    const current = entries.filter((e) => e.source === source).length
    return current < target
  }

  // Alternate sources (seeded order) until the pool is full or candidates run out.
  let guard = 0
  while (entries.length < poolSize && guard < 10_000) {
    guard++
    if (anchorCounts(entries) < anchorCount) sample(anchorMessages, anchorCount - anchorCounts(entries), 'anchor')
    if (entries.length >= poolSize) break
    if (recoveryCounts(entries) < recoveryCount) sample(recoveryMessages, recoveryCount - recoveryCounts(entries), 'recovery')
    if (entries.length === 0) break
    const before = entries.length
    if (entries.length === before) break
  }

  return {
    entries,
    stats: {
      poolSize: entries.length,
      anchorCount: anchorCounts(entries),
      recoveryCount: recoveryCounts(entries),
      anchorRatio: entries.length > 0 ? anchorCounts(entries) / entries.length : 0,
      deduped,
    },
  }
}

function anchorCounts(entries: CalibrationEntry[]): number {
  return entries.filter((e) => e.source === 'anchor').length
}

function recoveryCounts(entries: CalibrationEntry[]): number {
  return entries.filter((e) => e.source === 'recovery').length
}

/** Serialize the pool as a ShareGPT-style JSONL file content string. */
export function serializePool(entries: CalibrationEntry[]): string {
  return entries
    .map((e) =>
      JSON.stringify({
        conversations: e.messages.map((m) => ({
          from: m.role === 'user' ? 'human' : m.role === 'assistant' ? 'gpt' : m.role,
          value: m.content,
        })),
      }),
    )
    .join('\n')
}