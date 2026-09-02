/** Tiny AST walker on top of acorn for deterministic coding-probe grading. */

import { parse } from 'acorn'

export interface AcornNode {
  type: string
  [key: string]: unknown
}

export function parseJS(code: string): AcornNode {
  return parse(code, {
    ecmaVersion: 'latest',
    sourceType: 'module',
    allowHashBang: true,
  }) as unknown as AcornNode
}

export function walk(node: unknown, visit: (n: AcornNode) => void): void {
  if (node === null || typeof node !== 'object') return
  const n = node as AcornNode
  if (typeof n.type === 'string') visit(n)
  for (const key of Object.keys(n)) {
    const value = n[key]
    if (Array.isArray(value)) {
      for (const item of value) walk(item, visit)
    } else if (value !== null && typeof value === 'object') {
      walk(value, visit)
    }
  }
}

export function findNodes(code: string, predicate: (n: AcornNode) => boolean): AcornNode[] {
  const ast = parseJS(code)
  const found: AcornNode[] = []
  walk(ast, (n) => {
    if (predicate(n)) found.push(n)
  })
  return found
}

export function containsFunctionKind(code: string, kind: 'arrow' | 'function'): boolean {
  return findNodes(code, n => n.type === (kind === 'arrow' ? 'ArrowFunctionExpression' : 'FunctionDeclaration')).length > 0
}

export function containsNode(code: string, type: string): boolean {
  return findNodes(code, n => n.type === type).length > 0
}
