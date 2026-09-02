import type { ToolCall } from '../types.ts'

import { all } from '../grader.ts'
import type { Probe } from './types.ts'

function toolSequence(results: string[], transcript: ToolCall[]): string {
  return `tools=[${transcript.map(t => t.name).join(',')}] ${results.join(' | ')}`
}

/** Create → read → delete lifecycle. */
const too01: Probe = {
  id: 'too-01',
  domain: 'tools',
  title: 'File lifecycle (create → read → delete)',
  kind: 'tool-flow',
  messages: [
    {
      role: 'system',
      content: 'Work through each instruction in order. Keep the sandbox tidy.',
    },
  ],
  flow: {
    turns: [
      { instruction: 'Create a file "greeting.txt" whose content is exactly "hello world".', tools: ['write_file'] },
      { instruction: 'Read the file you just created and confirm its content.', tools: ['read_file'] },
      { instruction: 'Delete the file "greeting.txt".', tools: ['rm'] },
    ],
    verify: ((fs, transcript, results) => {
      const names = transcript.map(t => t.name)
      return all([
        { name: 'file was created', ok: results.some(r => r.includes('ok: wrote greeting.txt')) },
        { name: 'file was read', ok: names.includes('read_file') },
        { name: 'file deleted', ok: !fs.exists('greeting.txt') && names.includes('rm') },
        { name: 'calls in sensible order', ok: names.indexOf('write_file') < names.lastIndexOf('read_file') && names.lastIndexOf('read_file') < names.indexOf('rm') },
      ], toolSequence(results, transcript))
    }),
  },
}

/** Counter file advanced across three overwrites. */
const too02: Probe = {
  id: 'too-02',
  domain: 'tools',
  title: 'State persists across write turns',
  kind: 'tool-flow',
  messages: [
    {
      role: 'system',
      content: 'You keep a counter in a file, incrementing it by rewriting the file each turn.',
    },
  ],
  flow: {
    turns: [
      { instruction: 'Write "count.txt" containing exactly "0".', tools: ['write_file'] },
      { instruction: 'Read count so far, then write "1" to count.txt (replace its content).', tools: ['read_file', 'write_file'] },
      { instruction: 'Read count so far, then write "2" to count.txt (replace its content).', tools: ['read_file', 'write_file'] },
    ],
    verify: ((fs, transcript, results) => {
      const writes = transcript.filter(t => t.name === 'write_file')
      const contents: unknown[] = []
      for (const w of writes) {
        const c = (w.arguments as { content?: unknown }).content
        contents.push(c)
      }
      return all([
        { name: 'three writes happened', ok: writes.length === 3 },
        { name: 'started at 0', ok: contents[0] === '0' },
        { name: 'increments monotonically', ok: String(contents[1]) === '1' && String(contents[2]) === '2' },
        { name: 'final content is "2"', ok: fs.read('count.txt') === '2' },
      ], toolSequence(results, transcript))
    }),
  },
}

/** Append-only log built across turns. */
const too03: Probe = {
  id: 'too-03',
  domain: 'tools',
  title: 'Append-only log accumulation',
  kind: 'tool-flow',
  messages: [
    {
      role: 'system',
      content: 'You maintain an append-only log file. Never overwrite earlier entries.',
    },
  ],
  flow: {
    turns: [
      { instruction: 'Create "log.txt" containing "one\\n".', tools: ['write_file'] },
      { instruction: 'Append "two\\n" to "log.txt" without disturbing the first line.', tools: ['append_file'] },
      { instruction: 'Append "three\\n" to "log.txt" without disturbing earlier lines.', tools: ['append_file'] },
    ],
    verify: ((fs, transcript, results) => {
      const content = fs.read('log.txt')
      return all([
        { name: 'all three entries present', ok: content.includes('one') && content.includes('two') && content.includes('three') },
        { name: 'append tool used twice', ok: transcript.filter(t => t.name === 'append_file').length === 2 },
        { name: 'order preserved', ok: content.indexOf('one') < content.indexOf('two') && content.indexOf('two') < content.indexOf('three') },
      ], toolSequence(results, transcript))
    }),
  },
}

/** Directory creation + nested file. */
const too04: Probe = {
  id: 'too-04',
  domain: 'tools',
  title: 'Nested directory structure',
  kind: 'tool-flow',
  messages: [
    {
      role: 'system',
      content: 'You build a small directory structure.',
    },
  ],
  flow: {
    turns: [
      { instruction: 'Create a directory "reports".', tools: ['mkdir'] },
      { instruction: 'Create the file "reports/quarterly.md" containing "Q3 results".', tools: ['write_file'] },
      { instruction: 'List the contents of "reports" to confirm the file is there.', tools: ['ls'] },
    ],
    verify: ((fs, transcript, results) => {
      return all([
        { name: 'file exists at nested path', ok: fs.exists('reports/quarterly.md') },
        { name: 'content is correct', ok: fs.read('reports/quarterly.md') === 'Q3 results' },
        { name: 'listing shows it', ok: results.some(r => r.includes('quarterly.md')) },
      ], toolSequence(results, transcript))
    }),
  },
}

/** Two-file consistency: copy content exactly. */
const too05: Probe = {
  id: 'too-05',
  domain: 'tools',
  title: 'Two-file content consistency',
  kind: 'tool-flow',
  messages: [
    {
      role: 'system',
      content: 'You keep two files consistent with each other.',
    },
  ],
  flow: {
    turns: [
      { instruction: 'Write "a.txt" containing exactly "42".', tools: ['write_file'] },
      { instruction: 'Read "a.txt" and remember its exact content.', tools: ['read_file'] },
      { instruction: 'Write "b.txt" containing the exact same content you read from "a.txt".', tools: ['write_file'] },
    ],
    verify: ((fs, transcript, results) => {
      return all([
        { name: 'a.txt content is 42', ok: fs.read('a.txt') === '42' },
        { name: 'b.txt matches a.txt', ok: fs.exists('b.txt') && fs.read('b.txt') === fs.read('a.txt') },
        { name: 'read happened before the b write', ok: transcript.findIndex(t => t.name === 'read_file') < transcript.findIndex(t => t.name === 'write_file' && (t.arguments as { path?: string }).path !== 'a.txt') },
      ], toolSequence(results, transcript))
    }),
  },
}

/** Directory listing grows with files. */
const too06: Probe = {
  id: 'too-06',
  domain: 'tools',
  title: 'Listing reflects writes',
  kind: 'tool-flow',
  messages: [
    {
      role: 'system',
      content: 'You populate a data directory incrementally.',
    },
  ],
  flow: {
    turns: [
      { instruction: 'Create a directory "data".', tools: ['mkdir'] },
      { instruction: 'Write "data/x.csv" containing "a,b".', tools: ['write_file'] },
      { instruction: 'Write "data/y.csv" containing "c,d", then list "data".', tools: ['write_file', 'ls'] },
    ],
    verify: ((fs, transcript, results) => {
      return all([
        { name: 'both csvs exist', ok: fs.exists('data/x.csv') && fs.exists('data/y.csv') },
        { name: 'ls was called after both writes', ok: transcript.filter(t => t.name === 'ls').length === 1 && transcript.some(t => t.name === 'write_file' && (t.arguments as { path?: string }).path === 'data/y.csv') },
        { name: 'listing contains both', ok: results.some(r => r.includes('x.csv') && r.includes('y.csv')) },
      ], toolSequence(results, transcript))
    }),
  },
}

/** Deleting a missing file surfaces an error the model must handle. */
const too07: Probe = {
  id: 'too-07',
  domain: 'tools',
  title: 'Error recovery on missing file',
  kind: 'tool-flow',
  messages: [
    {
      role: 'system',
      content: 'Handle tool errors gracefully; do not invent files that do not exist.',
    },
  ],
  flow: {
    turns: [
      { instruction: 'Check whether "missing.txt" exists by listing the current directory.', tools: ['ls'] },
      { instruction: 'Try to delete "missing.txt" (it does not exist).', tools: ['rm'] },
      { instruction: 'Create "ok.txt" with content "done" to confirm you recovered from the error.', tools: ['write_file'] },
    ],
    verify: ((fs, transcript, results) => {
      const rmResult = results.find(r => r.includes('removed') || r.startsWith('error'))
      return all([
        { name: 'rm attempted on missing file surfaced an error', ok: rmResult !== undefined && rmResult.startsWith('error') },
        { name: 'recovered and completed the task', ok: fs.exists('ok.txt') && fs.read('ok.txt') === 'done' },
      ], toolSequence(results, transcript))
    }),
  },
}

/** Surgical rewrite then verify by reading back. */
const too08: Probe = {
  id: 'too-08',
  domain: 'tools',
  title: 'Rewrite with verification read-back',
  kind: 'tool-flow',
  messages: [
    {
      role: 'system',
      content: 'You modify files surgically and verify by reading them back.',
    },
  ],
  flow: {
    turns: [
      { instruction: 'Write "phrase.txt" containing "one two three".', tools: ['write_file'] },
      { instruction: 'Read "phrase.txt" to confirm its content.', tools: ['read_file'] },
      { instruction: 'Rewrite "phrase.txt" as "one red three" (replace "two" with "red").', tools: ['write_file'] },
      { instruction: 'Read "phrase.txt" again to confirm the rewrite.', tools: ['read_file'] },
    ],
    verify: ((fs, transcript, results) => {
      const reads = results.filter(r => r.includes('one') || r.includes('<empty'))
      const firstRead = reads[0]
      return all([
        { name: 'content rewritten', ok: fs.read('phrase.txt') === 'one red three' },
        { name: 'read back the original before rewriting', ok: firstRead === 'one two three' },
        { name: 'read twice', ok: transcript.filter(t => t.name === 'read_file').length === 2 },
      ], toolSequence(results, transcript))
    }),
  },
}

/** Structured config extended with preserved fields. */
const too09: Probe = {
  id: 'too-09',
  domain: 'tools',
  title: 'Structured config kept valid',
  kind: 'tool-flow',
  messages: [
    {
      role: 'system',
      content: 'You version a JSON config file; fields must never be dropped.',
    },
  ],
  flow: {
    turns: [
      { instruction: 'Write "config.json" containing exactly {"name":"app"}.', tools: ['write_file'] },
      { instruction: 'Write "config.json" adding "version":"1.0.0" AND keeping the existing "name" field.', tools: ['write_file'] },
      { instruction: 'Write "config.json" adding "id":"abc123" while keeping all existing fields.', tools: ['write_file'] },
    ],
    verify: ((fs, _t, results) => {
      let parsed: Record<string, unknown> | null = null
      try {
        const v: unknown = JSON.parse(fs.read('config.json'))
        if (v && typeof v === 'object' && !Array.isArray(v)) parsed = v as Record<string, unknown>
      } catch {
        parsed = null
      }
      return all([
        { name: 'config.json parses as JSON', ok: parsed !== null },
        { name: 'keeps name', ok: parsed !== null && parsed['name'] === 'app' },
        { name: 'keeps version', ok: parsed !== null && parsed['version'] === '1.0.0' },
        { name: 'keeps id', ok: parsed !== null && parsed['id'] === 'abc123' },
        { name: 'wrote no malformed intermediate', ok: results.every(r => !r.includes('error:')) },
      ], toolSequence(results, []))
    }),
  },
}

/** Clean up all temp artifacts after use. */
const too10: Probe = {
  id: 'too-10',
  domain: 'tools',
  title: 'Cleanup after work',
  kind: 'tool-flow',
  messages: [
    {
      role: 'system',
      content: 'You create temporary files and must delete every one of them before you are done.',
    },
  ],
  flow: {
    turns: [
      { instruction: 'Create a directory "tmp" and files "tmp/a.tmp" and "tmp/b.tmp" inside it.', tools: ['mkdir', 'write_file'] },
      { instruction: 'Delete "tmp/a.tmp".', tools: ['rm'] },
      { instruction: 'Delete "tmp/b.tmp", then list "tmp" to confirm it is empty.', tools: ['rm', 'ls'] },
    ],
    verify: ((fs, transcript, results) => {
      return all([
        { name: 'a.tmp removed', ok: !fs.exists('tmp/a.tmp') },
        { name: 'b.tmp removed', ok: !fs.exists('tmp/b.tmp') },
        { name: 'two rm calls', ok: transcript.filter(t => t.name === 'rm').length === 2 },
        { name: 'final listing empty', ok: fs.ls('tmp').length === 0 },
      ], toolSequence(results, transcript))
    }),
  },
}

export const TOOLS_PROBES: Probe[] = [too01, too02, too03, too04, too05, too06, too07, too08, too09, too10]
