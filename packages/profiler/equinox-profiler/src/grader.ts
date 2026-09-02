/**
 * Deterministic offline heuristic validators. Zero judge-model cost.
 *
 * Graders must be pure: regex + structural checks + constraint solving only.
 */

import type { ProbeResult } from '@solsticeai/core'

export interface Check {
  name: string
  ok: boolean
}

/** Weighted aggregate: pass iff every check passes; score = pass ratio. */
export function checksToResult(checks: Check[], context?: string): ProbeResult {
  const failed = checks.filter((c) => !c.ok)
  const score = checks.length === 0 ? 0 : checks.filter((c) => c.ok).length / checks.length
  const detail = failed.length === 0
    ? `all ${checks.length} check(s) passed`
    : `failed: ${failed.map((c) => c.name).join(', ')}${context ? ` (${context})` : ''}`
  return { pass: failed.length === 0, score, detail }
}

export function all(checks: Check[], context?: string): ProbeResult {
  const result = checksToResult(checks, context)
  // All-or-nothing scoring for hard constraints: any failure ⇒ 0.
  return result.pass ? result : { ...result, score: 0 }
}

/** Extract a fenced block (```lang ... ``` or plain ``` ... ```). */
export function extractFencedBlock(output: string, lang?: string): string | null {
  const fenceLang = lang ? `(?:${lang}|)` : ''
  const re = new RegExp(`\`\`\`${fenceLang}\\s*\\n?([\\s\\S]*?)\\n?\`\`\``)
  const m = output.match(re)
  return m ? m[1]! : null
}

/** Extract the (single) JSON block from model output, fenced or bare. */
export function extractJSON(output: string): string | null {
  const fenced = extractFencedBlock(output, 'json')
  if (fenced !== null) return fenced
  const start = output.indexOf('{')
  const end = output.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  return output.slice(start, end + 1)
}

export function parseJSONStrict(text: string): unknown {
  return JSON.parse(text) // strict: throws on trailing commas / bad syntax
}

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export const isArray = Array.isArray

export function isString(v: unknown): v is string {
  return typeof v === 'string'
}

export function isNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

export function isInteger(v: unknown): v is number {
  return isNumber(v) && Number.isInteger(v)
}

export function isBoolean(v: unknown): v is boolean {
  return typeof v === 'boolean'
}

export function lines(text: string): string[] {
  return text.split('\n')
}

export function countMatches(text: string, re: RegExp): number {
  const matches = text.match(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'))
  return matches ? matches.length : 0
}

export function hasBalancedBrackets(text: string, open = '{', close = '}'): boolean {
  let depth = 0
  for (const ch of text) {
    if (ch === open) depth++
    else if (ch === close) depth--
    if (depth < 0) return false
  }
  return depth === 0
}

/**
 * Tiny JSON-Schema subset validator: type / properties / required / items /
 * enum / pattern / minLength / maxLength / minimum / maximum.
 */
export function validateSchema(value: unknown, schema: Record<string, unknown>): string[] {
  const errors: string[] = []
  checkNode(value, schema, '', errors)
  return errors
}

function checkNode(value: unknown, schema: Record<string, unknown>, path: string, errors: string[]): void {
  const expected = schema.type
  if (expected === 'object') {
    if (!isPlainObject(value)) {
      errors.push(`${path}: expected object`)
      return
    }
    const required = (schema.required as string[]) ?? []
    for (const key of required) {
      if (!(key in (value as Record<string, unknown>))) errors.push(`${path}.${key}: missing required field`)
    }
    const props = (schema.properties as Record<string, Record<string, unknown>>) ?? {}
    for (const [key, sub] of Object.entries(props)) {
      if (key in (value as Record<string, unknown>)) checkNode((value as Record<string, unknown>)[key], sub, `${path}.${key}`, errors)
    }
    return
  }
  if (expected === 'array') {
    if (!Array.isArray(value)) {
      errors.push(`${path}: expected array`)
      return
    }
    const items = schema.items as Record<string, unknown> | undefined
    const maxItems = schema.maxItems as number | undefined
    const minItems = schema.minItems as number | undefined
    if (maxItems !== undefined && value.length > maxItems) errors.push(`${path}: too many items`)
    if (minItems !== undefined && value.length < minItems) errors.push(`${path}: too few items`)
    if (items) value.forEach((v, i) => checkNode(v, items, `${path}[${i}]`, errors))
    return
  }
  if (expected === 'string') {
    if (!isString(value)) {
      errors.push(`${path}: expected string`)
      return
    }
    const pattern = schema.pattern as string | undefined
    const minLength = schema.minLength as number | undefined
    const maxLength = schema.maxLength as number | undefined
    if (pattern !== undefined && !new RegExp(pattern).test(value)) errors.push(`${path}: pattern mismatch ${pattern}`)
    if (minLength !== undefined && value.length < minLength) errors.push(`${path}: too short`)
    if (maxLength !== undefined && value.length > maxLength) errors.push(`${path}: too long`)
    const enumVals = schema.enum as unknown[] | undefined
    if (enumVals !== undefined && !enumVals.includes(value)) errors.push(`${path}: not in enum`)
    return
  }
  if (expected === 'number' || expected === 'integer') {
    if (!isNumber(value) || (expected === 'integer' && !Number.isInteger(value))) {
      errors.push(`${path}: expected ${expected}`)
      return
    }
    const minimum = schema.minimum as number | undefined
    const maximum = schema.maximum as number | undefined
    if (minimum !== undefined && value < minimum) errors.push(`${path}: below minimum`)
    if (maximum !== undefined && value > maximum) errors.push(`${path}: above maximum`)
    return
  }
  if (expected === 'boolean') {
    if (!isBoolean(value)) errors.push(`${path}: expected boolean`)
    return
  }
  if (expected === 'null' && value !== null) errors.push(`${path}: expected null`)
}

export function parseLang(text: string): 'ts' | 'js' {
  return /:\s*(string|number|boolean|interface|type\s+\w+\s*=|:\s*[A-Z][A-Za-z]*\b)/.test(text) ? 'ts' : 'js'
}