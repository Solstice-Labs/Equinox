import { describe, expect, it } from 'vitest'

import {
  all,
  checksToResult,
  extractFencedBlock,
  extractJSON,
  hasBalancedBrackets,
  isInteger,
  parseJSONStrict,
  validateSchema,
} from '../src/index.ts'

describe('checksToResult / all', () => {
  it('passes when every check passes, score = ratio', () => {
    const r = checksToResult([
      { name: 'a', ok: true },
      { name: 'b', ok: true },
    ])
    expect(r).toMatchObject({ pass: true, score: 1 })
  })
  it('fails with detail naming failed checks', () => {
    const r = checksToResult([
      { name: 'a', ok: true },
      { name: 'b', ok: false },
    ])
    expect(r.pass).toBe(false)
    expect(r.score).toBe(0.5)
    expect(r.detail).toContain('b')
  })
  it('all() zeroes the score on any failure', () => {
    const r = all([
      { name: 'a', ok: true },
      { name: 'b', ok: false },
    ])
    expect(r.score).toBe(0)
  })
})

describe('fenced block extraction', () => {
  it('extracts a json fence with or without lang', () => {
    expect(extractFencedBlock('a\n```json\n{"x":1}\n```\nb', 'json')).toBe('{"x":1}')
    expect(extractFencedBlock('a\n```\ncode\n```\nb')).toBe('code')
  })
  it('returns null when no fence', () => {
    expect(extractFencedBlock('no fence here')).toBeNull()
  })
  it('extractJSON finds bare or fenced objects', () => {
    expect(parseJSONStrict(extractJSON('prefix {"ok":true} suffix') as string)).toEqual({ ok: true })
    expect(parseJSONStrict(extractJSON('```json\n{"a":1}\n```') as string)).toEqual({ a: 1 })
  })
})

describe('validateSchema (tiny subset)', () => {
  const schema = {
    type: 'object',
    properties: {
      id: { type: 'integer', minimum: 0 },
      name: { type: 'string', pattern: '^[A-Z]' },
      tags: { type: 'array', items: { type: 'string' }, minItems: 1 },
    },
    required: ['id', 'name'],
  }
  it('validates a conforming object', () => {
    expect(validateSchema({ id: 1, name: 'Ada', tags: ['x'] }, schema)).toEqual([])
  })
  it('reports missing required fields', () => {
    const errors = validateSchema({ id: 1 }, schema)
    expect(errors.some(e => e.includes('name'))).toBe(true)
  })
  it('reports type and constraint violations', () => {
    const errors = validateSchema({ id: -1, name: 'ada', tags: [] }, schema)
    expect(errors.join('|')).toContain('below minimum')
    expect(errors.join('|')).toContain('pattern mismatch')
    expect(errors.join('|')).toContain('too few items')
  })
})

describe('helpers', () => {
  it('hasBalancedBrackets', () => {
    expect(hasBalancedBrackets('{}')).toBe(true)
    expect(hasBalancedBrackets('{a:{b:1}}')).toBe(true)
    expect(hasBalancedBrackets('{a:}')).toBe(true) // depth never goes negative
    expect(hasBalancedBrackets('{{a}')).toBe(false)
    expect(hasBalancedBrackets('a}')).toBe(false)
    expect(hasBalancedBrackets('}{')).toBe(false)
  })
  it('isInteger', () => {
    expect(isInteger(3)).toBe(true)
    expect(isInteger(3.5)).toBe(false)
  })
})
