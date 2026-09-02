import type { Tool, ToolContext, ToolResult } from './tools.js'
import { fail, result } from './tools.js'

/**
 * Surgical line-range editor: replaces a unique string occurrence.
 * Refuses to apply when the needle is ambiguous or missing, so the model
 * cannot accidentally corrupt a file with a non-unique match.
 */
export const editFileTool: Tool = {
  name: 'edit_file',
  description:
    'Replace a unique substring in a file. Fails if the old_string occurs 0 times (not found) or more than once (ambiguous). Use replace_all=true to replace every occurrence.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string' },
      old_string: { type: 'string' },
      new_string: { type: 'string' },
      replace_all: { type: 'boolean', default: false },
    },
    required: ['path', 'old_string', 'new_string'],
  },
  run(args: Record<string, unknown>, ctx: ToolContext): ToolResult {
    const path = String(args.path ?? '')
    const oldString = String(args.old_string ?? '')
    const newString = String(args.new_string ?? '')
    const replaceAll = args.replace_all === true
    if (!path || oldString === '') return fail('path and old_string are required')
    if (oldString === newString) return fail('old_string and new_string are identical')

    let content: string
    try {
      content = ctx.fs.read(path)
    } catch (e) {
      return fail((e as Error).message)
    }

    const occurrences = countOccurrences(content, oldString)
    if (occurrences === 0) {
      return fail(`old_string not found in ${path}`)
    }
    if (occurrences > 1 && !replaceAll) {
      return fail(`old_string matches ${occurrences} times in ${path}; provide more context or set replace_all=true`)
    }
    if (replaceAll) {
      const updated = content.split(oldString).join(newString)
      ctx.fs.write(path, updated)
      return result(`replaced all ${occurrences} occurrence(s) in ${path}`)
    }
    const idx = content.indexOf(oldString)
    const line = content.slice(0, idx).split('\n').length
    const updated = content.slice(0, idx) + newString + content.slice(idx + oldString.length)
    ctx.fs.write(path, updated)
    return result(`replaced 1 occurrence in ${path} (starting at line ${line})`)
  },
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0
  let idx = haystack.indexOf(needle)
  while (idx >= 0) {
    count++
    idx = haystack.indexOf(needle, idx + needle.length)
  }
  return count
}