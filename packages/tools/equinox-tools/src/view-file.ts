import type { Tool, ToolContext, ToolResult } from './tools.js'
import { fail, result } from './tools.js'

export const WINDOW_SIZE = 50

/**
 * Windowed, 1-indexed, 50-line pagination. Prevents context blowout on
 * sub-8B models by never exposing an entire file at once.
 */
export const viewFileTool: Tool = {
  name: 'view_file',
  description: 'View a file with 1-indexed line numbers, 50 lines at a time. Pass start_line to page forward.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Path to the file' },
      start_line: { type: 'integer', description: '1-indexed first line to show (default 1)' },
    },
    required: ['path'],
  },
  run(args: Record<string, unknown>, ctx: ToolContext): ToolResult {
    const path = String(args.path ?? '')
    if (!path) return fail('path is required')
    let content: string
    try {
      content = ctx.fs.read(path)
    } catch (e) {
      return fail((e as Error).message)
    }
    const lines = content.split('\n')
    const total = lines.length
    const start = Math.max(1, Number(args.start_line) || 1)
    const end = Math.min(total, start + WINDOW_SIZE - 1)
    if (start > total) {
      return fail(`start_line ${start} exceeds file length ${total}`)
    }
    const window = lines.slice(start - 1, end)
    const gutter = String(end).length
    const body = window.map((line, i) => `${String(start + i).padStart(gutter)} | ${line}`).join('\n')
    const remaining = total - end
    const footer = remaining > 0 ? `\n... ${remaining} more line(s) (view_file start_line=${end + 1})` : `
--- end of file (${total} line${total === 1 ? '' : 's'}) ---`
    return result(`lines ${start}-${end} of ${total}\n${body}${footer}`)
  },
}