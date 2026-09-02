import type { ProbeResult } from '../types.ts'

import { all, extractJSON, isArray, isInteger, isPlainObject, isString, parseJSONStrict } from '../grader.ts'
import type { Probe } from './types.ts'

const LOGIC_SYSTEM =
  'You are a precise constraint solver. ' +
  'Respond with ONLY a single raw JSON object in the exact shape requested. No markdown, no prose.'

/** Map coloring: 4 regions, wheel graph, must use ≤ 3 colors. */
const log01: Probe = {
  id: 'log-01',
  domain: 'logic',
  title: 'Map coloring with 3 colors',
  messages: [
    {
      role: 'system',
      content: LOGIC_SYSTEM,
    },
    {
      role: 'user',
      content:
        'Color each region A, B, C, D with a color from ["red","blue","green"] so that adjacent regions differ. ' +
        'Adjacencies: A-B, A-C, A-D, B-C, C-D. ' +
        'Return {"regions": {"A": "<color>", "B": "<color>", "C": "<color>", "D": "<color>"}}',
    },
  ],
  grader(output: string): ProbeResult {
    const json = extractJSON(output)
    if (json === null) {
      return all([{ name: 'contains a JSON object', ok: false }], 'no JSON found')
    }
    let regions: Record<string, unknown>
    try {
      const parsed = parseJSONStrict(json)
      regions = isPlainObject(parsed) && isPlainObject(parsed['regions']) ? (parsed['regions']) : {}
    } catch (e) {
      return all([{ name: 'JSON parses', ok: false }], (e as Error).message)
    }
    const colors = ['red', 'blue', 'green']
    const edges: [string, string][] = [
      ['A', 'B'],
      ['A', 'C'],
      ['A', 'D'],
      ['B', 'C'],
      ['C', 'D'],
    ]
    const checks = [
      { name: 'all four regions colored', ok: ['A', 'B', 'C', 'D'].every(r => isString(regions[r])) },
      {
        name: 'colors from allowed palette only',
        ok: Object.values(regions).every(c => isString(c) && colors.includes(c)),
      },
      {
        name: 'adjacent regions differ',
        ok: edges.every(([a, b]) => regions[a] !== regions[b]),
      },
      {
        name: 'uses at most 3 distinct colors',
        ok: new Set(Object.values(regions)).size <= 3,
      },
    ]
    return all(checks, JSON.stringify(regions))
  },
}

/** Subset sum: find a subset of [3,5,7,9,12] summing to exactly 17. */
const log02: Probe = {
  id: 'log-02',
  domain: 'logic',
  title: 'Subset sum',
  messages: [
    {
      role: 'system',
      content: LOGIC_SYSTEM,
    },
    {
      role: 'user',
      content:
        'Find a subset of [3, 5, 7, 9, 12] (each number at most once) that sums to exactly 17. ' +
        'Return {"subset": [<numbers>], "sum": <number>}',
    },
  ],
  grader(output: string): ProbeResult {
    const json = extractJSON(output)
    if (json === null) return all([{ name: 'contains a JSON object', ok: false }], 'no JSON found')
    let parsed: unknown
    try {
      parsed = parseJSONStrict(json)
    } catch (e) {
      return all([{ name: 'JSON parses', ok: false }], (e as Error).message)
    }
    if (!isPlainObject(parsed)) return all([{ name: 'parsed object', ok: false }])
    const subset = parsed['subset']
    const pool = [3, 5, 7, 9, 12]
    const checks = [
      { name: 'subset is an array', ok: isArray(subset) },
      { name: 'elements from pool, no repeats', ok: isArray(subset) && subset.every(v => isInteger(v) && pool.includes(v)) && new Set(subset).size === (subset as unknown[]).length },
      { name: 'sum equals 17', ok: isArray(subset) && subset.reduce((s: number, v) => s + (isInteger(v) ? (v) : 0), 0) === 17 },
      { name: 'reported sum matches', ok: isInteger(parsed['sum']) && parsed['sum'] === 17 },
    ]
    return all(checks, `got ${JSON.stringify(subset)}`)
  },
}

/** Schedule 3 tasks into time slots without overlap; T1 before T3. */
const log03: Probe = {
  id: 'log-03',
  domain: 'logic',
  title: 'Task scheduling without overlap',
  messages: [
    {
      role: 'system',
      content: LOGIC_SYSTEM,
    },
    {
      role: 'user',
      content:
        'Schedule tasks T1 (1h), T2 (2h), T3 (1h) into slots from {9, 10, 11, 13, 14, 15} (integer hours, consecutive for length). ' +
        'T1 must finish before T3 starts. No two tasks may use the same (start,length) window. ' +
        'Return {"plan": [{"task": "T1", "start": 9}, {"task": "T2", "start": 13}, {"task": "T3", "start": 10}]}',
    },
  ],
  grader(output: string): ProbeResult {
    const json = extractJSON(output)
    if (json === null) return all([{ name: 'contains a JSON object', ok: false }], 'no JSON found')
    let plan: unknown
    try {
      const parsed = parseJSONStrict(json)
      plan = isPlainObject(parsed) ? parsed['plan'] : null
    } catch (e) {
      return all([{ name: 'JSON parses', ok: false }], (e as Error).message)
    }
    if (!isArray(plan)) return all([{ name: 'plan is an array', ok: false }])
    const durations: Record<string, number> = { T1: 1, T2: 2, T3: 1 }
    const tasks = plan.map((p): { task: string; start: number } | null => {
      if (!isPlainObject(p) || !isString(p['task']) || !isInteger(p['start'])) return null
      return { task: p['task'], start: p['start'] }
    })
    const valid = tasks.every(t => t !== null && t.task in durations && t.start >= 9 && (t.start < 12 || t.start >= 13))
    const windows = tasks.filter(t => t !== null).map(t => [t.start, t.start + (durations[t.task] ?? 1)] as const)
    const overlaps = windows.some((w1, i) => windows.some((w2, j) => j > i && w1[0] < w2[1] && w2[0] < w1[1]))
    const t1 = tasks.find(t => t?.task === 'T1')
    const t3 = tasks.find(t => t?.task === 'T3')
    const names = new Set(tasks.map(t => t?.task))
    const orderingOk = t1 === undefined || t1 === null || t3 === undefined || t3 === null || t1.start + 1 <= t3.start
    return all([
      { name: 'all tasks scheduled exactly once', ok: names.size === 3 && ['T1', 'T2', 'T3'].every(n => names.has(n)) },
      { name: 'valid slots', ok: valid },
      { name: 'no overlapping windows', ok: !overlaps },
      { name: 'T1 finishes before T3 starts', ok: orderingOk },
    ], JSON.stringify(plan))
  },
}

/** 0/1 knapsack, capacity 10 — optimum is value 50. */
const log04: Probe = {
  id: 'log-04',
  domain: 'logic',
  title: 'Knapsack optimization',
  messages: [
    {
      role: 'system',
      content: LOGIC_SYSTEM,
    },
    {
      role: 'user',
      content:
        'Choose items (each at most once) for capacity 10 maximizing total value. ' +
        'Items: a(w=6,v=30), b(w=5,v=25), c(w=4,v=20), d(w=3,v=15). ' +
        'Return {"chosen": ["a","c"], "weight": 10, "value": 50}',
    },
  ],
  grader(output: string): ProbeResult {
    const json = extractJSON(output)
    if (json === null) return all([{ name: 'contains a JSON object', ok: false }], 'no JSON found')
    let parsed: unknown
    try {
      parsed = parseJSONStrict(json)
    } catch (e) {
      return all([{ name: 'JSON parses', ok: false }], (e as Error).message)
    }
    if (!isPlainObject(parsed) || !isArray(parsed['chosen'])) return all([{ name: 'chosen is an array', ok: false }])
    const items: Record<string, [number, number]> = { a: [6, 30], b: [5, 25], c: [4, 20], d: [3, 15] }
    const chosen = (parsed['chosen'] as unknown[]).filter((x): x is string => isString(x))
    const weight = chosen.reduce((s, name) => s + (items[name]?.[0] ?? 0), 0)
    const value = chosen.reduce((s, name) => s + (items[name]?.[1] ?? 0), 0)
    const unique = new Set(chosen).size === chosen.length
    // Reference optimum via DP.
    const opt = knapsackOpt10(items)
    return all([
      { name: 'chosen items are valid', ok: chosen.every(c => c in items) },
      { name: 'no duplicates', ok: unique },
      { name: 'fits capacity 10', ok: weight <= 10 },
      { name: 'value equals optimum', ok: value === opt && value > 0 },
      { name: 'reported value matches choice', ok: isInteger(parsed['value']) && parsed['value'] === value },
    ], `chosen=${chosen.join(',')} value=${value} optimum=${opt}`)
  },
}

/** Seating arrangement with adjacency constraints. */
const log05: Probe = {
  id: 'log-05',
  domain: 'logic',
  title: 'Seating with adjacency constraints',
  messages: [
    {
      role: 'system',
      content: LOGIC_SYSTEM,
    },
    {
      role: 'user',
      content:
        'Seat Ann, Bob, Cy, Dan in a row of 4 seats. Constraints: Ann sits next to Bob; Cy does NOT sit next to Ann; ' +
        'Dan sits immediately left of Cy. ' +
        'Return {"seats": ["Bob", "Ann", "Dan", "Cy"]} (left to right, one name per seat)',
    },
  ],
  grader(output: string): ProbeResult {
    const json = extractJSON(output)
    if (json === null) return all([{ name: 'contains a JSON object', ok: false }], 'no JSON found')
    let seats: unknown
    try {
      const parsed = parseJSONStrict(json)
      seats = isPlainObject(parsed) ? parsed['seats'] : null
    } catch (e) {
      return all([{ name: 'JSON parses', ok: false }], (e as Error).message)
    }
    if (!isArray(seats)) return all([{ name: 'seats is an array', ok: false }])
    const list = seats.map(s => (isString(s) ? s : ''))
    const names = ['Ann', 'Bob', 'Cy', 'Dan']
    const adj = (a: string, b: string) => {
      const ia = list.indexOf(a)
      const ib = list.indexOf(b)
      return ia >= 0 && ib >= 0 && Math.abs(ia - ib) === 1
    }
    return all([
      { name: 'full permutation of the 4 names', ok: names.every(n => list.includes(n)) && list.length === 4 && new Set(list).size === 4 },
      { name: 'Ann sits next to Bob', ok: adj('Ann', 'Bob') },
      { name: 'Cy not next to Ann', ok: !adj('Cy', 'Ann') },
      { name: 'Dan immediately left of Cy', ok: list.indexOf('Dan') === list.indexOf('Cy') - 1 && list.indexOf('Cy') > 0 },
    ], JSON.stringify(list))
  },
}

/** Towers of Hanoi, 3 pegs, 3 disks, legal moves, ≤ 7 moves. */
const log06: Probe = {
  id: 'log-06',
  domain: 'logic',
  title: 'Towers of Hanoi plan (3 disks)',
  messages: [
    {
      role: 'system',
      content: LOGIC_SYSTEM,
    },
    {
      role: 'user',
      content:
        'Produce the move sequence to move all 3 disks (sizes 1 < 2 < 3) from peg A to peg C using peg B, never placing a larger disk on a smaller one. ' +
        'Return {"moves": [["A","C"], ["A","B"], ["C","B"], ["A","C"], ["B","A"], ["B","C"], ["A","C"]]}',
    },
  ],
  grader(output: string): ProbeResult {
    const json = extractJSON(output)
    if (json === null) return all([{ name: 'contains a JSON object', ok: false }], 'no JSON found')
    let moves: unknown
    try {
      const parsed = parseJSONStrict(json)
      moves = isPlainObject(parsed) ? parsed['moves'] : null
    } catch (e) {
      return all([{ name: 'JSON parses', ok: false }], (e as Error).message)
    }
    if (!isArray(moves)) return all([{ name: 'moves is an array', ok: false }])
    const pegs: Record<string, number[]> = { A: [3, 2, 1], B: [], C: [] }
    let legal = true
    for (const m of moves) {
      if (!isArray(m) || !isString(m[0]) || !isString(m[1])) {
        legal = false
        break
      }
      const from = m[0]
      const to = m[1]
      const fromPeg = pegs[from]
      const toPeg = pegs[to]
      if (fromPeg === undefined || toPeg === undefined) {
        legal = false
        break
      }
      const disk = fromPeg.pop()
      if (disk === undefined) {
        legal = false
        break
      }
      const top = toPeg[toPeg.length - 1]
      if (top !== undefined && disk > top) {
        legal = false
        break
      }
      toPeg.push(disk)
    }
    const done = pegs['C']?.length === 3
    return all([
      { name: 'all moves legal (no larger on smaller)', ok: legal },
      { name: 'all disks end on C', ok: done },
      { name: 'uses at most 7 moves (minimum)', ok: moves.length <= 7 },
      { name: 'every move uses pegs A/B/C', ok: (moves as unknown[]).every(m => isArray(m) && (m as string[]).every(p => 'ABC'.includes(p))) },
    ], `moves=${moves.length}`)
  },
}

/** Shortest path on a 3×3 grid with walls. */
const log07: Probe = {
  id: 'log-07',
  domain: 'logic',
  title: 'Shortest path with walls',
  messages: [
    {
      role: 'system',
      content: LOGIC_SYSTEM,
    },
    {
      role: 'user',
      content:
        'In a 3×3 grid (rows/cols 0..2), walls occupy (0,1) and (1,1). Find a path from (0,0) to (2,2) moving only up/down/left/right, never through a wall, without revisiting cells. ' +
        'Return {"path": [[0,0], [1,0], [2,0], [2,1], [2,2]]}',
    },
  ],
  grader(output: string): ProbeResult {
    const json = extractJSON(output)
    if (json === null) return all([{ name: 'contains a JSON object', ok: false }], 'no JSON found')
    let path: unknown
    try {
      const parsed = parseJSONStrict(json)
      path = isPlainObject(parsed) ? parsed['path'] : null
    } catch (e) {
      return all([{ name: 'JSON parses', ok: false }], (e as Error).message)
    }
    if (!isArray(path)) return all([{ name: 'path is an array', ok: false }])
    const cells = path.map((p): [number, number] | null => (isArray(p) && isInteger(p[0]) && isInteger(p[1]) ? [p[0], p[1]] : null))
    const walls = new Set(['0,1', '1,1'])
    const validCells = cells.every(c => c !== null && c[0] >= 0 && c[0] < 3 && c[1] >= 0 && c[1] < 3 && !walls.has(`${c[0]},${c[1]}`))
    const first = cells.at(0)
    const last = cells.at(-1)
    const starts = first !== undefined && first !== null && first[0] === 0 && first[1] === 0
    const ends = last !== undefined && last !== null && last[0] === 2 && last[1] === 2
    let stepsValid = validCells
    const seen = new Set<string>()
    let prev: [number, number] | null = null
    let firstCell = true
    for (const cell of cells) {
      if (cell === null) {
        stepsValid = false
        break
      }
      const key = `${cell[0]},${cell[1]}`
      if (seen.has(key)) {
        stepsValid = false
        break
      }
      seen.add(key)
      if (!firstCell) {
        const p = prev
        if (p === null) {
          stepsValid = false
          break
        }
        const d = Math.abs(cell[0] - p[0]) + Math.abs(cell[1] - p[1])
        if (d !== 1) {
          stepsValid = false
          break
        }
      }
      prev = cell
      firstCell = false
    }
    return all([
      { name: 'starts at (0,0)', ok: starts },
      { name: 'ends at (2,2)', ok: ends },
      { name: 'valid cells, no walls', ok: validCells },
      { name: 'adjacent steps, no revisits', ok: stepsValid },
      { name: 'length ≤ 6 (optimal is 4)', ok: cells.length >= 2 && cells.length <= 7 },
    ], `steps=${cells.length - 1}`)
  },
}

/** Digit deduction with distinctness. */
const log08: Probe = {
  id: 'log-08',
  domain: 'logic',
  title: 'Distinct digit deduction',
  messages: [
    {
      role: 'system',
      content: LOGIC_SYSTEM,
    },
    {
      role: 'user',
      content:
        'A, B, C are distinct single digits (0-9) with: A + B = 9, B + C = 14, and C > A. ' +
        'Return {"A": 4, "B": 5, "C": 9}',
    },
  ],
  grader(output: string): ProbeResult {
    const json = extractJSON(output)
    if (json === null) return all([{ name: 'contains a JSON object', ok: false }], 'no JSON found')
    let a: unknown, b: unknown, c: unknown
    try {
      const parsed = parseJSONStrict(json)
      if (!isPlainObject(parsed)) return all([{ name: 'parsed object', ok: false }])
      a = parsed['A']
      b = parsed['B']
      c = parsed['C']
    } catch (e) {
      return all([{ name: 'JSON parses', ok: false }], (e as Error).message)
    }
    const ints = [a, b, c].every(isInteger) ? ([a, b, c] as number[]) : []
    const a0 = ints[0] ?? Number.NaN
    const b0 = ints[1] ?? Number.NaN
    const c0 = ints[2] ?? Number.NaN
    return all([
      { name: 'A, B, C are digits', ok: ints.length === 3 && ints.every(v => v >= 0 && v <= 9) },
      { name: 'A + B = 9', ok: ints.length === 3 && a0 + b0 === 9 },
      { name: 'B + C = 14', ok: ints.length === 3 && b0 + c0 === 14 },
      { name: 'C > A', ok: ints.length === 3 && c0 > a0 },
      { name: 'all pairwise distinct', ok: ints.length === 3 && new Set(ints).size === 3 },
    ], JSON.stringify({ A: a, B: b, C: c }))
  },
}

/** Talk scheduling avoiding same-room + same-time conflicts. */
const log09: Probe = {
  id: 'log-09',
  domain: 'logic',
  title: 'Timetable non-conflict',
  messages: [
    {
      role: 'system',
      content: LOGIC_SYSTEM,
    },
    {
      role: 'user',
      content:
        'Assign talks T1, T2, T3 to either room R1/R2 and hour 9/10. T1 and T2 must NOT be at the same hour (same audience). ' +
        'No two talks may share both room and hour. ' +
        'Return {"slots": [{"talk": "T1", "room": "R1", "hour": 9}, {"talk": "T2", "room": "R1", "hour": 10}, {"talk": "T3", "room": "R2", "hour": 9}]}',
    },
  ],
  grader(output: string): ProbeResult {
    const json = extractJSON(output)
    if (json === null) return all([{ name: 'contains a JSON object', ok: false }], 'no JSON found')
    let slots: unknown
    try {
      const parsed = parseJSONStrict(json)
      slots = isPlainObject(parsed) ? parsed['slots'] : null
    } catch (e) {
      return all([{ name: 'JSON parses', ok: false }], (e as Error).message)
    }
    if (!isArray(slots)) return all([{ name: 'slots is an array', ok: false }])
    const items = slots.map((s): { talk: string; room: string; hour: number } | null => {
      if (!isPlainObject(s) || !isString(s['talk']) || !isString(s['room']) || !isInteger(s['hour'])) return null
      return { talk: s['talk'], room: s['room'], hour: s['hour'] }
    })
    const valid = items.every(i => i !== null && ['R1', 'R2'].includes(i.room) && (i.hour === 9 || i.hour === 10))
    const keys: string[] = []
    for (const item of items) {
      if (item !== null) keys.push(`${item.room}-${item.hour}`)
    }
    const dupKey = new Set(keys).size !== keys.length
    const talks = new Set(items.map(i => i?.talk))
    const t1 = items.find(i => i?.talk === 'T1')
    const t2 = items.find(i => i?.talk === 'T2')
    return all([
      { name: 'every field valid', ok: valid },
      { name: 'T1, T2, T3 each scheduled once', ok: talks.size === 3 && ['T1', 'T2', 'T3'].every(t => talks.has(t)) },
      { name: 'no room+hour collisions', ok: !dupKey },
      { name: 'T1 and T2 at different hours', ok: t1 !== undefined && t2 !== undefined && t1 !== null && t2 !== null && t1.hour !== t2.hour },
    ], JSON.stringify(items))
  },
}

/** Binary row constraints: exactly two 1s, never adjacent. */
const log10: Probe = {
  id: 'log-10',
  domain: 'logic',
  title: 'Binary row constraints',
  messages: [
    {
      role: 'system',
      content: LOGIC_SYSTEM,
    },
    {
      role: 'user',
      content:
        'Produce a row of exactly 6 bits (0 or 1) with exactly two 1s and no two 1s adjacent. ' +
        'Return {"bits": [0, 1, 0, 0, 1, 0]}',
    },
  ],
  grader(output: string): ProbeResult {
    const json = extractJSON(output)
    if (json === null) return all([{ name: 'contains a JSON object', ok: false }], 'no JSON found')
    let bits: unknown
    try {
      const parsed = parseJSONStrict(json)
      bits = isPlainObject(parsed) ? parsed['bits'] : null
    } catch (e) {
      return all([{ name: 'JSON parses', ok: false }], (e as Error).message)
    }
    if (!isArray(bits)) return all([{ name: 'bits is an array', ok: false }])
    const list = bits as unknown[]
    const valid = list.every(b => b === 0 || b === 1)
    const ones = valid ? list.filter(b => b === 1).length : -1
    let adjacent = false
    for (let i = 0; i < list.length - 1; i++) {
      if (list[i] === 1 && list[i + 1] === 1) {
        adjacent = true
        break
      }
    }
    return all([
      { name: 'exactly 6 bits', ok: list.length === 6 },
      { name: 'only 0/1 values', ok: valid },
      { name: 'exactly two 1s', ok: ones === 2 },
      { name: 'no adjacent 1s', ok: !adjacent },
    ], JSON.stringify(list))
  },
}

function knapsackOpt10(items: Record<string, [number, number]>): number {
  // DP over capacity 0..10
  const weights = Object.values(items).map(([w]) => w)
  const values = Object.values(items).map(([, v]) => v)
  const dp = new Array(11).fill(0)
  for (let i = 0; i < weights.length; i++) {
    for (let cap = 10; cap >= (weights[i] as number); cap--) {
      dp[cap] = Math.max(dp[cap] as number, (dp[cap - (weights[i] as number)] as number) + (values[i] as number))
    }
  }
  return dp[10] as number
}

export const LOGIC_PROBES: Probe[] = [log01, log02, log03, log04, log05, log06, log07, log08, log09, log10]
