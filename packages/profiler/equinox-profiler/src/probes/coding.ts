import type { ProbeResult } from '../types.ts'

import { all, extractFencedBlock, hasBalancedBrackets } from '../grader.ts'
import { containsNode, findNodes, parseJS } from './ast.ts'
import type { Probe } from './types.ts'

const FENCE =
  'Put your final code in a single ```js fenced code block. The code inside must be complete, parseable JavaScript.'

function code(output: string): string | null {
  return extractFencedBlock(output, 'js') ?? extractFencedBlock(output)
}

/** Callback pyramid → async/await. */
const cod01: Probe = {
  id: 'cod-01',
  domain: 'coding',
  title: 'Callback → async/await refactor',
  messages: [
    {
      role: 'system',
      content: 'You refactor JavaScript into modern async/await style. ' + FENCE,
    },
    {
      role: 'user',
      content:
        'Refactor this to async/await, keeping behavior identical:\n' +
        '```js\nfunction load() {\n  getA(function (a) {\n    getB(a, function (b) {\n      console.log(a + b);\n    });\n  });\n}\n```',
    },
  ],
  grader(output: string): ProbeResult {
    const js = code(output)
    if (!js) return all([{ name: 'produces a js code block', ok: false }])
    try {
      const ast = parseJS(js)
      const awaits = findNodes(js, n => n.type === 'AwaitExpression')
      const thens = findNodes(js, n => !!n.type && !!n.callee && (n.callee as { property?: { name?: string } }).property?.name === 'then' && n.type === 'CallExpression')
      return all([
        { name: 'code parses', ok: true },
        { name: 'uses await', ok: awaits.length > 0 },
        { name: 'declares async function', ok: containsNode(js, 'FunctionDeclaration') || containsNode(js, 'ArrowFunctionExpression') },
        { name: 'no .then() chains remain', ok: thens.length === 0 },
        { name: 'no nested callback calls', ok: !/function\s*\(\s*[^)]*\)\s*\{[\s\S]*function\s*\(/.test(js) },
      ], `ast nodes: ${ast.type}`)
    } catch (e) {
      return all([{ name: 'code parses', ok: false }], (e as Error).message)
    }
  },
}

/** Derive a typed interface from an object shape. */
const cod02: Probe = {
  id: 'cod-02',
  domain: 'coding',
  title: 'TypeScript interface extraction',
  messages: [
    {
      role: 'system',
      content: 'You write clean TypeScript. ' + FENCE.replace('js', 'ts'),
    },
    {
      role: 'user',
      content:
        'Given this object, write a TypeScript interface named User with a field for every key and correct types ' +
        '(email optional, others required):\n```js\nconst u = { id: 1, name: "ada", email: "ada@example.com" };\n```',
    },
  ],
  grader(output: string): ProbeResult {
    const ts = extractFencedBlock(output, 'ts')
    const checks = [
      { name: 'produces a ts code block', ok: ts !== null },
      { name: 'has balanced braces', ok: ts !== null && hasBalancedBrackets(ts) },
      { name: 'declares interface User', ok: ts !== null && /interface\s+User\s*\{/.test(ts) },
      { name: 'has id: number', ok: ts !== null && /id\s*:\s*number/.test(ts) },
      { name: 'has name: string', ok: ts !== null && /name\s*:\s*string/.test(ts) },
      { name: 'has optional email', ok: ts !== null && /email\??\s*:\s*string/.test(ts) && ts.includes('email') },
    ]
    return all(checks)
  },
}

/** Fire independent awaits in parallel with Promise.all. */
const cod03: Probe = {
  id: 'cod-03',
  domain: 'coding',
  title: 'Parallelize with Promise.all',
  messages: [
    {
      role: 'system',
      content: 'You write performant JavaScript. ' + FENCE,
    },
    {
      role: 'user',
      content:
        'Optimize this so the two awaits run in parallel:\n```js\nasync function fetchAll() {\n  const a = await fetchA();\n  const b = await fetchB();\n  return [a, b];\n}\n```',
    },
  ],
  grader(output: string): ProbeResult {
    const js = code(output)
    if (!js) return all([{ name: 'produces a js code block', ok: false }])
    try {
      parseJS(js)
      const promiseAll = findNodes(
        js,
        n =>
          n.type === 'CallExpression' &&
          ((n.callee as { object?: { name?: string }; property?: { name?: string } }).object?.name === 'Promise') &&
          ((n.callee as { property?: { name?: string } }).property?.name === 'all'),
      )
      return all([
        { name: 'code parses', ok: true },
        { name: 'calls Promise.all', ok: promiseAll.length > 0 },
        { name: 'still awaits the parallel result', ok: findNodes(js, n => n.type === 'AwaitExpression').length >= 1 },
        { name: 'has no sequential awaits', ok: !/await\s+[^;]+\s*;\s*\n\s*await/.test(js) },
      ])
    } catch (e) {
      return all([{ name: 'code parses', ok: false }], (e as Error).message)
    }
  },
}

/** var → const/let. */
const cod04: Probe = {
  id: 'cod-04',
  domain: 'coding',
  title: 'Eliminate var declarations',
  messages: [
    {
      role: 'system',
      content: 'You write idiomatic modern JavaScript. ' + FENCE,
    },
    {
      role: 'user',
      content:
        'Rewrite using const (preferred) or let, never var:\n```js\nfunction total(xs) {\n  var sum = 0;\n  for (var i = 0; i < xs.length; i++) {\n    sum += xs[i];\n  }\n  return sum;\n}\n```',
    },
  ],
  grader(output: string): ProbeResult {
    const js = code(output)
    if (!js) return all([{ name: 'produces a js code block', ok: false }])
    try {
      parseJS(js)
      const vars = findNodes(js, n => n.type === 'VariableDeclaration' && n.kind === 'var')
      return all([
        { name: 'code parses', ok: true },
        { name: 'uses const/let', ok: /\b(const|let)\s+\w+/.test(js) },
        { name: 'no var declarations', ok: vars.length === 0 },
        { name: 'preserves loop', ok: /for\s*\(/.test(js) },
      ])
    } catch (e) {
      return all([{ name: 'code parses', ok: false }], (e as Error).message)
    }
  },
}

/** Destructuring assignment. */
const cod05: Probe = {
  id: 'cod-05',
  domain: 'coding',
  title: 'Destructuring assignment',
  messages: [
    {
      role: 'system',
      content: 'You write concise modern JavaScript. ' + FENCE,
    },
    {
      role: 'user',
      content:
        'Rewrite extracting name and age via destructuring instead of property access:\n```js\nconst person = { name: "ada", age: 36 };\nconst n = person.name;\nconst a = person.age;\n```',
    },
  ],
  grader(output: string): ProbeResult {
    const js = code(output)
    if (!js) return all([{ name: 'produces a js code block', ok: false }])
    try {
      parseJS(js)
      const destructures = findNodes(
        js,
        n => n.type === 'VariableDeclarator' && (n.id as { type?: string }).type !== 'Identifier',
      )
      return all([
        { name: 'code parses', ok: true },
        { name: 'uses an object/array destructuring pattern', ok: destructures.length > 0 || /const\s*\{[^}]+\}\s*=/.test(js) },
        { name: 'binds name', ok: /name/.test(js) },
        { name: 'binds age', ok: /age/.test(js) },
      ])
    } catch (e) {
      return all([{ name: 'code parses', ok: false }], (e as Error).message)
    }
  },
}

/** Nullish coalescing over || defaults. */
const cod06: Probe = {
  id: 'cod-06',
  domain: 'coding',
  title: 'Nullish coalescing',
  messages: [
    {
      role: 'system',
      content: 'You write defensive modern JavaScript. ' + FENCE,
    },
    {
      role: 'user',
      content:
        'Rewrite without changing behavior, using ?? so 0 and empty string stay valid:\n```js\nfunction port(cfg) {\n  return cfg.port || 8080;\n}\n```',
    },
  ],
  grader(output: string): ProbeResult {
    const js = code(output)
    if (!js) return all([{ name: 'produces a js code block', ok: false }])
    try {
      parseJS(js)
      return all([
        { name: 'code parses', ok: true },
        { name: 'uses ??', ok: /\?\?/.test(js) },
        { name: 'does not use || for the default', ok: !/\bc\.?port\s*\|\|/.test(js) && !/return\s+[^;]*\|\|/.test(js) },
        { name: 'keeps default 8080', ok: /8080/.test(js) },
      ])
    } catch (e) {
      return all([{ name: 'code parses', ok: false }], (e as Error).message)
    }
  },
}

/** Template literals with interpolation. */
const cod07: Probe = {
  id: 'cod-07',
  domain: 'coding',
  title: 'Template literal interpolation',
  messages: [
    {
      role: 'system',
      content: 'You write idiomatic JavaScript. ' + FENCE,
    },
    {
      role: 'user',
      content:
        'Rewrite using a template literal:\n```js\nfunction greet(name) {\n  return "Hello, " + name + "!";\n}\n```',
    },
  ],
  grader(output: string): ProbeResult {
    const js = code(output)
    if (!js) return all([{ name: 'produces a js code block', ok: false }])
    try {
      parseJS(js)
      const templates = findNodes(js, n => n.type === 'TemplateLiteral')
      return all([
        { name: 'code parses', ok: true },
        { name: 'uses a template literal', ok: templates.length > 0 },
        { name: 'interpolates name', ok: templates.some(t => JSON.stringify(t.expressions ?? []).includes('name')) || /\$\{name\}/.test(js) },
        { name: 'no string concatenation with +', ok: !/\+ name \+/.test(js) },
      ])
    } catch (e) {
      return all([{ name: 'code parses', ok: false }], (e as Error).message)
    }
  },
}

/** Arrow functions only. */
const cod08: Probe = {
  id: 'cod-08',
  domain: 'coding',
  title: 'Arrow functions only',
  messages: [
    {
      role: 'system',
      content: 'You write functional JavaScript. ' + FENCE,
    },
    {
      role: 'user',
      content:
        'Rewrite with arrow functions only, no function keyword:\n```js\nfunction double(xs) {\n  return xs.map(function (x) { return x * 2; });\n}\n```',
    },
  ],
  grader(output: string): ProbeResult {
    const js = code(output)
    if (!js) return all([{ name: 'produces a js code block', ok: false }])
    try {
      parseJS(js)
      const arrows = findNodes(js, n => n.type === 'ArrowFunctionExpression' || n.type === 'FunctionExpression')
      const funcDecl = findNodes(js, n => n.type === 'FunctionDeclaration')
      return all([
        { name: 'code parses', ok: true },
        { name: 'uses arrow functions', ok: arrows.length > 0 },
        { name: 'no function keyword', ok: funcDecl.length === 0 && !/\bfunction\s*\(/.test(js) },
        { name: 'still maps over xs', ok: /\.map\(/.test(js) },
      ])
    } catch (e) {
      return all([{ name: 'code parses', ok: false }], (e as Error).message)
    }
  },
}

/** try/catch with await inside. */
const cod09: Probe = {
  id: 'cod-09',
  domain: 'coding',
  title: 'Error handling around awaits',
  messages: [
    {
      role: 'system',
      content: 'You write robust JavaScript with proper error handling. ' + FENCE,
    },
    {
      role: 'user',
      content:
        'Add error handling: wrap the fetch in try/catch and rethrow a clearer error on failure (or log and return null):\n```js\nasync function load(id) {\n  const res = await fetch(`/api/${id}`);\n  return res.json();\n}\n```',
    },
  ],
  grader(output: string): ProbeResult {
    const js = code(output)
    if (!js) return all([{ name: 'produces a js code block', ok: false }])
    try {
      parseJS(js)
      const tries = findNodes(js, n => n.type === 'TryStatement')
      return all([
        { name: 'code parses', ok: true },
        { name: 'has a try block', ok: tries.length > 0 },
        { name: 'has a catch clause', ok: tries.some(t => t.handler !== null) },
        { name: 'await lives inside try', ok: /try\s*\{[\s\S]*await/.test(js) },
      ])
    } catch (e) {
      return all([{ name: 'code parses', ok: false }], (e as Error).message)
    }
  },
}

/** Named ESM export shape. */
const cod10: Probe = {
  id: 'cod-10',
  domain: 'coding',
  title: 'Named export module shape',
  messages: [
    {
      role: 'system',
      content: 'You write ESM modules. ' + FENCE,
    },
    {
      role: 'user',
      content:
        'Complete this module: export a function named sum that adds its arguments, plus a named export of the constant VERSION = "1.0":\n```js\n// export { sum, VERSION }\n```',
    },
  ],
  grader(output: string): ProbeResult {
    const js = code(output)
    if (!js) return all([{ name: 'produces a js code block', ok: false }])
    try {
      parseJS(js)
      const exports = findNodes(js, n => /^(Export|ExportNamedDeclaration|ExportSpecifier)/.test(n.type))
      return all([
        { name: 'code parses as module', ok: true },
        { name: 'has an export', ok: exports.length > 0 || /\bexport\b/.test(js) },
        { name: 'exports sum', ok: /export\s*\{[^}]*sum/.test(js) || /export\s+(function|const)\s+sum/.test(js) || /sum\s*[,=:]?/.test(js) },
        { name: 'exports VERSION', ok: (/VERSION\s*=\s*"1\.0"/.test(js) || /\bVERSION\b/.test(js)) && /export/.test(js) },
        { name: 'no default export leakage', ok: ! /export\s+default/.test(js) },
      ])
    } catch (e) {
      return all([{ name: 'code parses', ok: false }], (e as Error).message)
    }
  },
}

export const CODING_PROBES: Probe[] = [cod01, cod02, cod03, cod04, cod05, cod06, cod07, cod08, cod09, cod10]
