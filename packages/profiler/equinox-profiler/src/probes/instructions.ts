import type { ProbeResult } from '../types.ts'

import { all, countMatches, lines } from '../grader.ts'
import type { Probe } from './types.ts'

/** No digits anywhere in a technical explanation. */
const ins01: Probe = {
  id: 'ins-01',
  domain: 'instructions',
  title: 'Negative constraint: no digits',
  messages: [
    {
      role: 'system',
      content: 'Follow constraints literally.',
    },
    {
      role: 'user',
      content:
        'Explain what a variable is in programming, in a single paragraph of at least twenty words. You must NOT use any digit (0-9) anywhere.',
    },
  ],
  grader(output: string): ProbeResult {
    return all([
      { name: 'no digits', ok: !/\d/.test(output) },
      { name: 'substantive answer (≥ 20 words)', ok: output.split(/\s+/).filter(Boolean).length >= 20 },
    ])
  },
}

/** Exactly five bullet lines, nothing else. */
const ins02: Probe = {
  id: 'ins-02',
  domain: 'instructions',
  title: 'Format invariant: exactly 5 bullets',
  messages: [
    {
      role: 'system',
      content: 'Follow formatting instructions exactly.',
    },
    {
      role: 'user',
      content:
        'List exactly five reasons to write unit tests. Each reason on its own line starting with "- ". Output nothing that is not a bullet line.',
    },
  ],
  grader(output: string): ProbeResult {
    const ls = lines(output).filter(l => l.trim() !== '')
    const bullets = ls.filter(l => /^-\s+/.test(l))
    return all([
      { name: 'exactly 5 bullet lines', ok: bullets.length === 5 },
      { name: 'no non-bullet lines', ok: bullets.length === ls.length },
      { name: 'bullets are substantive', ok: bullets.every(b => b.trim().length > 10) },
    ])
  },
}

/** Must start with an exact marker. */
const ins03: Probe = {
  id: 'ins-03',
  domain: 'instructions',
  title: 'Prefix invariant: RESULT: marker',
  messages: [
    {
      role: 'system',
      content: 'Follow the required prefix exactly.',
    },
    {
      role: 'user',
      content: 'State the capital of France and its approximate population. Begin your entire answer with exactly "RESULT:".',
    },
  ],
  grader(output: string): ProbeResult {
    return all([
      { name: 'starts with RESULT:', ok: output.trim().startsWith('RESULT:') },
      { name: 'mentions Paris', ok: /paris/i.test(output) },
    ])
  },
}

/** No markdown constructs at all. */
const ins04: Probe = {
  id: 'ins-04',
  domain: 'instructions',
  title: 'Negative constraint: no markdown',
  messages: [
    {
      role: 'system',
      content: 'Follow constraints literally.',
    },
    {
      role: 'user',
      content:
        'Describe your favorite season in 2-3 sentences. Use NO markdown of any kind: no headings, no bold, no italics, no backticks, no bullets, no links.',
    },
  ],
  grader(output: string): ProbeResult {
    const flags = ['#', '*', '`', '>', '---', '[', '](']
    const bad = flags.filter(f => output.includes(f))
    return all([
      { name: 'no markdown syntax', ok: bad.length === 0 },
      { name: 'substantive answer (≥ 40 chars)', ok: output.trim().length >= 40 },
    ], `found ${bad.join(',') || 'none'}`)
  },
}

/** All lowercase, no capitals. */
const ins05: Probe = {
  id: 'ins-05',
  domain: 'instructions',
  title: 'Format invariant: lowercase only',
  messages: [
    {
      role: 'system',
      content: 'Follow case constraints exactly.',
    },
    {
      role: 'user',
      content: 'Write a two-sentence apology to a teammate for a late review. Every character must be lowercase; no capitals anywhere.',
    },
  ],
  grader(output: string): ProbeResult {
    return all([
      { name: 'no uppercase letters', ok: !/[A-Z]/.test(output) },
      { name: 'two sentences-ish (≥ 2 sentence endings)', ok: countMatches(output, /[.!?]/g) >= 2 },
    ])
  },
}

/** Single paragraph: no blank lines. */
const ins06: Probe = {
  id: 'ins-06',
  domain: 'instructions',
  title: 'Format invariant: single paragraph',
  messages: [
    {
      role: 'system',
      content: 'Follow formatting constraints exactly.',
    },
    {
      role: 'user',
      content: 'Explain the difference between TCP and UDP in exactly ONE paragraph of at least eighty characters. No blank lines anywhere.',
    },
  ],
  grader(output: string): ProbeResult {
    return all([
      { name: 'no blank lines', ok: !output.includes('\n\n') },
      { name: 'no internal line breaks', ok: lines(output).filter(l => l.trim() !== '').length === 1 },
      { name: 'length ≥ 80 chars', ok: output.trim().length >= 80 },
      { name: 'mentions both protocols', ok: /TCP/i.test(output) && /UDP/i.test(output) },
    ])
  },
}

/** Avoid a forbidden word. */
const ins07: Probe = {
  id: 'ins-07',
  domain: 'instructions',
  title: 'Negative constraint: banned word',
  messages: [
    {
      role: 'system',
      content: 'Follow constraints literally.',
    },
    {
      role: 'user',
      content:
        'Describe a large land mammal that has a trunk, weighs several tons, and is native to Africa and Asia, in 2-3 sentences. ' +
        'You must not use the word "elephant" at any point.',
    },
  ],
  grader(output: string): ProbeResult {
    return all([
      { name: 'banned word absent', ok: !/elephant/i.test(output) },
      { name: 'trunk mentioned without the word', ok: /trunk/i.test(output) },
      { name: 'substantive (≥ 40 chars)', ok: output.trim().length >= 40 },
    ])
  },
}

/** Exact suffix marker. */
const ins08: Probe = {
  id: 'ins-08',
  domain: 'instructions',
  title: 'Suffix invariant: ---END--- marker',
  messages: [
    {
      role: 'system',
      content: 'Follow the required suffix exactly.',
    },
    {
      role: 'user',
      content: 'Summarize the water cycle in one sentence and then end your entire answer with exactly "---END---".',
    },
  ],
  grader(output: string): ProbeResult {
    return all([
      { name: 'ends with ---END---', ok: output.trimEnd().endsWith('---END---') },
      { name: 'mentions water cycle', ok: /water|evaporat|condens/i.test(output) },
    ])
  },
}

/** Minimum length in words. */
const ins09: Probe = {
  id: 'ins-09',
  domain: 'instructions',
  title: 'Format invariant: ≥ 50 words',
  messages: [
    {
      role: 'system',
      content: 'Follow the length constraint exactly.',
    },
    {
      role: 'user',
      content: 'Write a paragraph of at least fifty words explaining how caching improves latency.',
    },
  ],
  grader(output: string): ProbeResult {
    const words = output.split(/\s+/).filter(Boolean).length
    return all([
      { name: '≥ 50 words', ok: words >= 50 },
      { name: 'mentions caching and latency', ok: /cach/i.test(output) && /latenc/i.test(output) },
    ], `${words} words`)
  },
}

/** No consecutive duplicated words. */
const ins10: Probe = {
  id: 'ins-10',
  domain: 'instructions',
  title: 'Format invariant: no word repeats',
  messages: [
    {
      role: 'system',
      content: 'Follow stylistic constraints exactly.',
    },
    {
      role: 'user',
      content:
        'In two sentences, describe your workspace. No word may appear twice in a row (for example, never write "the the").',
    },
  ],
  grader(output: string): ProbeResult {
    const words = output.toLowerCase().split(/\s+/).filter(w => /[a-z0-9]/.test(w))
    let repeated = false
    for (let i = 0; i < words.length - 1; i++) {
      if (words[i] === words[i + 1]) {
        repeated = true
        break
      }
    }
    return all([
      { name: 'no consecutive duplicate words', ok: !repeated },
      { name: 'substantive answer (≥ 20 words)', ok: words.length >= 20 },
    ])
  },
}

export const INSTRUCTIONS_PROBES: Probe[] = [ins01, ins02, ins03, ins04, ins05, ins06, ins07, ins08, ins09, ins10]
