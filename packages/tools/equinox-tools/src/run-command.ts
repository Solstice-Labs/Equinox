import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import type { Tool, ToolContext, ToolResult } from './tools.js'
import { fail, result } from './tools.js'

export const OUTPUT_LIMIT = 2048 // 2 KiB
export const DEFAULT_TIMEOUT_MS = 15_000

const BLOCKLIST: RegExp[] = [
  /\bsudo\b/,
  /\brm\s+-rf\s+[\/\s]/,
  /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;?\s*:/, // fork bomb
  /\bdd\s+if=\/dev\/(zero|sda|sdb|nul)/i,
  /\bmkfs(\.|\s)/,
  /\bchmod\s+(-R\s+)?777\s+\//,
  />\s*\/dev\/(sda|sdb|sdc|nul)/i,
  /\b(shutdown|reboot|halt|poweroff)\b/,
  /\bcurl\b.*\|\s*(ba)?sh\b/i,
  /\bwget\b.*\|\s*(ba)?sh\b/i,
  /\bkill\s+-9\s+-1\b/,
]

/**
 * Sandboxed bash runner: working-directory confinement, command blocklist,
 * hard timeout, and 2 KiB output truncation so long-running/stderr-heavy
 * commands cannot blow context.
 */
export const runCommandTool: Tool = {
  name: 'run_command',
  description: `Run a bash command inside the sandbox (cwd-constrained, ${DEFAULT_TIMEOUT_MS}ms timeout). Output truncated at ${OUTPUT_LIMIT} bytes.`,
  parameters: {
    type: 'object',
    properties: {
      command: { type: 'string' },
      timeout_ms: { type: 'integer', description: `Default ${DEFAULT_TIMEOUT_MS}` },
    },
    required: ['command'],
  },
  run(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const command = String(args.command ?? '')
    if (!command) return Promise.resolve(fail('command is required'))
    for (const pattern of BLOCKLIST) {
      if (pattern.test(command)) {
        return Promise.resolve(fail(`command blocked by sandbox policy (matches ${pattern})`))
      }
    }
    const timeoutMs = Number(args.timeout_ms) || DEFAULT_TIMEOUT_MS
    const cwd = resolveSandboxCwd(ctx)
    return new Promise<ToolResult>((resolvePromise) => {
      execFile(
        'bash',
        ['-lc', command],
        {
          cwd: resolve(cwd),
          timeout: timeoutMs,
          maxBuffer: OUTPUT_LIMIT * 512,
          env: { ...process.env, EQUINOX_SANDBOX: '1', ...ctx.env },
          encoding: 'utf8',
        },
        (error, stdout, stderr) => {
          const raw = `${stdout}${stderr ? `\n[stderr]\n${stderr}` : ''}`
          const output = truncate(raw)
          const killed = Boolean(error && 'signal' in error && (error as { signal?: string }).signal)
          if (killed) {
            const signal = (error as { signal?: string }).signal ?? 'SIGNAL'
            return resolvePromise(fail(`command was killed: ${signal}\n${output}`))
          }
          const code = typeof (error as { code?: unknown } | null)?.code === 'number' ? ((error as { code: number }).code) : 0
          if (code === 0) return resolvePromise(result(output))
          return resolvePromise({
            ok: false,
            output: `exit ${code}\n${output}`,
            error: `command exited with code ${code}`,
          })
        },
      )
    }).then((r) => r)
  },
}

function truncate(text: string): string {
  if (Buffer.byteLength(text, 'utf8') <= OUTPUT_LIMIT) return text
  const cut = Buffer.from(text, 'utf8').subarray(0, OUTPUT_LIMIT).toString('utf8')
  return `${cut}\n...[truncated: ${Buffer.byteLength(text, 'utf8') - OUTPUT_LIMIT} bytes omitted]`
}

/**
 * Resolve a command working directory:
 *  1. jail root + ctx.cwd (created if missing), when a root is configured;
 *  2. ctx.cwd if it already exists;
 *  3. an ephemeral temp dir otherwise (never touches `/`).
 */
function resolveSandboxCwd(ctx: ToolContext): string {
  if (ctx.root) {
    const target = resolve(ctx.root, ctx.cwd === '/' ? '' : ctx.cwd)
    try {
      mkdirSync(target, { recursive: true })
      return target
    } catch {
      return mkdtempSync(join(tmpdir(), 'equinox-cmd-'))
    }
  }
  if (ctx.cwd && existsSync(ctx.cwd)) return resolve(ctx.cwd)
  return mkdtempSync(join(tmpdir(), 'equinox-cmd-'))
}