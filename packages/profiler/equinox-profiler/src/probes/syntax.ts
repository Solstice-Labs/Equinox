import type { ProbeResult } from '@solsticeai/core'

import {
  all,
  countMatches,
  extractJSON,
  hasBalancedBrackets,
  isArray,
  isBoolean,
  isInteger,
  isNumber,
  isPlainObject,
  isString,
  parseJSONStrict,
  validateSchema,
} from '../grader.js'
import type { Probe } from './types.js'

const JSON_ONLY = 'Respond with ONLY a single raw JSON object. No markdown, no prose, no trailing commas, no explanation.'

/** A pure-JSON answer with a nested schema must validate. */
const syn01: Probe = {
  id: 'syn-01',
  domain: 'syntax',
  title: 'Strict JSON conformance with nested schema',
  messages: [
    {
      role: 'system',
      content:
        'You are a precision data formatter. ' + JSON_ONLY,
    },
    {
      role: 'user',
      content:
        'Return a JSON object describing a user with EXACTLY these fields, types, and nothing else: ' +
        '{"user": {"id": <integer>, "email": <string>, "tags": <array of strings>}, "active": <boolean>}. ' +
        'Example shape: {"user":{"id":7,"email":"a@b.co","tags":["x","y"]},"active":true}',
    },
  ],
  grader(output: string): ProbeResult {
    const checks = [
      { name: 'raw output starts with {', ok: output.trim().startsWith('{') },
      { name: 'raw output ends with }', ok: output.trim().endsWith('}') },
    ]
    if (!checks.every((c) => c.ok)) return all(checks)
    try {
      const value = parseJSONStrict(output)
      const errors = validateSchema(value, {
        type: 'object',
        properties: {
          user: {
            type: 'object',
            properties: {
              id: { type: 'integer' },
              email: { type: 'string', pattern: '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$' },
              tags: { type: 'array', items: { type: 'string' }, minItems: 1 },
            },
            required: ['id', 'email', 'tags'],
          },
          active: { type: 'boolean' },
        },
        required: ['user', 'active'],
      })
      return all(
        [
          ...checks,
          { name: 'schema validates cleanly', ok: errors.length === 0 },
        ],
        errors.join('; '),
      )
    } catch (e) {
      return all([...checks, { name: 'parses as JSON', ok: false }], (e as Error).message)
    }
  },
}

/** Answer must live inside a single ```json fenced block — nothing outside. */
const syn02: Probe = {
  id: 'syn-02',
  domain: 'syntax',
  title: 'JSON confined to a single fenced block',
  messages: [
    {
      role: 'system',
      content:
        'You are a disciplined formatter. Always wrap your JSON answer in a ```json fenced code block. Nothing may appear outside the fences. ',
    },
    {
      role: 'user',
      content: 'Return the JSON object {"ok": true, "count": 3} inside a ```json fence and nothing else.',
    },
  ],
  grader(output: string): ProbeResult {
    const block = /```json\s*\n([\s\S]*?)\n?```/.exec(output)
    const outside = block ? output.slice(0, block.index) + output.slice(block.index + block[0].length) : output
    const checks = [
      { name: 'has a ```json fence', ok: block !== null },
      { name: 'nothing outside the fence', ok: outside.trim() === '' },
    ]
    if (!block) return all(checks)
    try {
      const value = parseJSONStrict(block[1]!)
      return all([
        ...checks,
        { name: 'block parses', ok: true },
        { name: 'has ok=true', ok: isPlainObject(value) && value['ok'] === true },
        { name: 'has count=3', ok: isPlainObject(value) && isInteger(value['count']) && value['count'] === 3 },
      ])
    } catch (e) {
      return all([...checks, { name: 'block parses', ok: false }], (e as Error).message)
    }
  },
}

/** Escaped quotes, backslashes, and newline escapes must survive a round-trip. */
const syn03: Probe = {
  id: 'syn-03',
  domain: 'syntax',
  title: 'Escape handling round-trip',
  messages: [
    {
      role: 'system',
      content: 'You are a JSON serializer. ' + JSON_ONLY,
    },
    {
      role: 'user',
      content:
        'Encode these exact values as a JSON object: quote = say "hi" (with double quotes), ' +
        'path = C:\\dir\\file.txt (with backslashes), multiline = "line one\\nline two" (with an escaped newline). ' +
        'Return {"quote": "...", "path": "...", "multiline": "..."}',
    },
  ],
  grader(output: string): ProbeResult {
    try {
      const value = parseJSONStrict(output)
      return all([
        { name: 'quote round-trips', ok: isPlainObject(value) && value['quote'] === 'say "hi"' },
        { name: 'path round-trips backslashes', ok: isPlainObject(value) && value['path'] === 'C:\\dir\\file.txt' },
        { name: 'multiline keeps escaped newline', ok: isPlainObject(value) && value['multiline'] === 'line one\nline two' },
      ])
    } catch (e) {
      return all([{ name: 'parses as JSON', ok: false }], (e as Error).message)
    }
  },
}

/** One JSON object per line; no commas between lines. */
const syn04: Probe = {
  id: 'syn-04',
  domain: 'syntax',
  title: 'JSONL — one object per line',
  messages: [
    {
      role: 'system',
      content:
        'You output strict JSON Lines: one JSON object per line, no commas between lines, no fences, no prose.',
    },
    {
      role: 'user',
      content:
        'Produce exactly 3 JSONL lines. Each line must parse as JSON and have fields {"event": <string>, "ts": <integer ms>}. ' +
        'Example: {"event":"start","ts":1000}',
    },
  ],
  grader(output: string): ProbeResult {
    const ls = output.split('\n').filter((l) => l.trim() !== '')
    const checks: { name: string; ok: boolean }[] = [
      { name: 'exactly 3 lines', ok: ls.length === 3 },
      { name: 'no commas between lines', ok: !ls.some((l) => l.startsWith(',')) },
      { name: 'no trailing commas', ok: !ls.some((l) => /,\s*$/.test(l)) },
    ]
    const parsed = ls.map((l) => {
      try {
        return parseJSONStrict(l)
      } catch {
        return null
      }
    })
    checks.push({ name: 'every line parses', ok: parsed.every((p) => p !== null) })
    const clean = parsed.filter((p): p is Record<string, unknown> => isPlainObject(p))
    checks.push({
      name: 'fields are correct types',
      ok: clean.length === 3 && clean.every((o) => isString(o['event']) && isInteger(o['ts'])),
    })
    return all(checks)
  },
}

/** A markdown fence with a language tag must be produced verbatim. */
const syn05: Probe = {
  id: 'syn-05',
  domain: 'syntax',
  title: 'Markdown fence preservation',
  messages: [
    {
      role: 'system',
      content: 'You always answer inside a ```txt fenced code block. The content of the fence may not contain the fence delimiter.',
    },
    {
      role: 'user',
      content: 'Write the word "hello" three times, once per line, inside a ```txt fence.',
    },
  ],
  grader(output: string): ProbeResult {
    const m = /```txt\s*\n([\s\S]*?)\n?```/.exec(output)
    const checks = [
      { name: 'uses ```txt fence', ok: m !== null },
      { name: 'fence content has 3 lines', ok: m !== null && m[1]!.trim().split('\n').length === 3 },
      {
        name: 'content is exactly hello ×3',
        ok: m !== null && m[1]!.trim().split('\n').every((l) => l.trim() === 'hello'),
      },
      { name: 'no delimiter inside fence', ok: m !== null && !m[1]!.includes('```') },
    ]
    return all(checks)
  },
}

/** Numeric literals must be canonical (no leading zeros, valid floats). */
const syn06: Probe = {
  id: 'syn-06',
  domain: 'syntax',
  title: 'Canonical number literals',
  messages: [
    {
      role: 'system',
      content: 'You output strict JSON. ' + JSON_ONLY,
    },
    {
      role: 'user',
      content:
        'Return {"a": 1.5, "b": 0.25, "c": 100, "d": -3, "e": 0}. Use canonical literal forms: no leading zeros, no trailing-dot floats.',
    },
  ],
  grader(output: string): ProbeResult {
    const checks = [{ name: 'no leading-zero integers', ok: !/\b0\d/.test(output) }]
    try {
      const value = parseJSONStrict(output)
      return all([
        ...checks,
        { name: 'a=1.5 (number)', ok: isPlainObject(value) && value['a'] === 1.5 },
        { name: 'b=0.25 (number)', ok: isPlainObject(value) && value['b'] === 0.25 },
        { name: 'c=100 (number)', ok: isPlainObject(value) && value['c'] === 100 },
        { name: 'd=-3 (number)', ok: isPlainObject(value) && value['d'] === -3 },
        { name: 'e=0 (number)', ok: isPlainObject(value) && value['e'] === 0 },
      ])
    } catch (e) {
      return all([...checks, { name: 'parses as JSON', ok: false }], (e as Error).message)
    }
  },
}

/** true/false must be JSON booleans, never quoted strings. */
const syn07: Probe = {
  id: 'syn-07',
  domain: 'syntax',
  title: 'Boolean strictness',
  messages: [
    {
      role: 'system',
      content: 'You output strict JSON. Booleans are literal true/false, never strings. ' + JSON_ONLY,
    },
    {
      role: 'user',
      content: 'Return {"yes": true, "no": false, "flag": null} with real JSON booleans and a real null.',
    },
  ],
  grader(output: string): ProbeResult {
    const checks = [
      { name: 'booleans never quoted', ok: !/"(true|false)"/.test(output) },
      { name: 'null never quoted', ok: !/"null"/.test(output) },
    ]
    try {
      const value = parseJSONStrict(output)
      return all([
        ...checks,
        { name: 'yes is boolean true', ok: isPlainObject(value) && value['yes'] === true && isBoolean(value['yes']) },
        { name: 'no is boolean false', ok: isPlainObject(value) && value['no'] === false && isBoolean(value['no']) },
        { name: 'flag is null', ok: isPlainObject(value) && value['flag'] === null && 'flag' in value },
      ])
    } catch (e) {
      return all([...checks, { name: 'parses as JSON', ok: false }], (e as Error).message)
    }
  },
}

/** Distinguishing absent vs null requires all keys present, one null. */
const syn08: Probe = {
  id: 'syn-08',
  domain: 'syntax',
  title: 'Null vs missing key distinction',
  messages: [
    {
      role: 'system',
      content: 'You output strict JSON. ' + JSON_ONLY,
    },
    {
      role: 'user',
      content:
        'Return an object with EXACTLY three keys — "a", "b", "c" — where a is the string "present", b is the number 0, and c is null. ' +
        'Every key must appear; do not omit c.',
    },
  ],
  grader(output: string): ProbeResult {
    try {
      const value = parseJSONStrict(output)
      return all([
        { name: 'is an object', ok: isPlainObject(value) },
        { name: 'has all three keys', ok: isPlainObject(value) && 'a' in value && 'b' in value && 'c' in value },
        { name: 'a="present"', ok: isPlainObject(value) && value['a'] === 'present' },
        { name: 'b=0 (not missing)', ok: isPlainObject(value) && value['b'] === 0 },
        { name: 'c is null', ok: isPlainObject(value) && value['c'] === null && typeof value['c'] === 'object' },
      ])
    } catch (e) {
      return all([{ name: 'parses as JSON', ok: false }], (e as Error).message)
    }
  },
}

/** Unicode / emoji must survive an exact round-trip. */
const syn09: Probe = {
  id: 'syn-09',
  domain: 'syntax',
  title: 'UTF-8 and emoji round-trip',
  messages: [
    {
      role: 'system',
      content: 'You output strict JSON. Preserve Unicode exactly. ' + JSON_ONLY,
    },
    {
      role: 'user',
      content: 'Return {"greeting": "héllo 🌍", "rocket": "🚀", "japanese": "こんにちは"}',
    },
  ],
  grader(output: string): ProbeResult {
    try {
      const value = parseJSONStrict(output)
      return all([
        {
          name: 'greeting round-trips with é and emoji',
          ok: isPlainObject(value) && value['greeting'] === 'héllo 🌍',
        },
        { name: 'rocket emoji round-trips', ok: isPlainObject(value) && value['rocket'] === '🚀' },
        { name: 'CJK text round-trips', ok: isPlainObject(value) && value['japanese'] === 'こんにちは' },
      ])
    } catch (e) {
      return all([{ name: 'parses as JSON', ok: false }], (e as Error).message)
    }
  },
}

/** Strict parsing rejects trailing commas; braces must balance. */
const syn10: Probe = {
  id: 'syn-10',
  domain: 'syntax',
  title: 'Array of objects, no trailing commas',
  messages: [
    {
      role: 'system',
      content: 'You output strict JSON. Never use trailing commas. ' + JSON_ONLY,
    },
    {
      role: 'user',
      content: 'Return an array of exactly 2 objects {"n": <integer>} — n = 1 and n = 2 — with a trailing comma after nothing.',
    },
  ],
  grader(output: string): ProbeResult {
    const checks = [
      { name: 'braces balance', ok: hasBalancedBrackets(output, '[', ']') && hasBalancedBrackets(output) },
      { name: 'no trailing commas', ok: !/,\s*[}\]\]]/.test(output) },
    ]
    try {
      const value = parseJSONStrict(output)
      const objs = isArray(value) ? value.filter(isPlainObject) : []
      return all([
        ...checks,
        { name: 'array of exactly 2', ok: isArray(value) && value.length === 2 },
        { name: 'all elements are objects', ok: isArray(value) && value.every(isPlainObject) },
        { name: 'n values 1 and 2', ok: objs.length === 2 && isInteger(objs[0]?.['n']) && isInteger(objs[1]?.['n']) },
      ])
    } catch (e) {
      return all([...checks, { name: 'parses as JSON (no trailing commas)', ok: false }], (e as Error).message)
    }
  },
}

export const SYNTAX_PROBES: Probe[] = [syn01, syn02, syn03, syn04, syn05, syn06, syn07, syn08, syn09, syn10]