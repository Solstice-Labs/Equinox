/** The standalone SDK-minimal bundle's complete declared Cordis tree. */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as yaml from 'js-yaml'
import { describe, expect, it } from 'vitest'
import { entryListSchema } from '@solsticeai/cordis-plugin-include'

function packageName(specifier: string): string {
  return specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0]!
}

describe('dsh-sdk-minimal bundle', () => {
  it('declares one standalone allowlisted tree with every row dependency', () => {
    const root = fileURLToPath(new URL('..', import.meta.url))
    const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
      dsh?: { bundle?: { patch?: string } }
    }
    expect(manifest.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
    const patches = yaml.load(
      readFileSync(resolve(root, manifest.dsh!.bundle!.patch!), 'utf8'),
      { schema: entryListSchema },
    ) as Array<{ insert?: Array<{ id?: string; inject?: string[]; name?: string; config?: Record<string, unknown>; disabled?: unknown }> }>
    expect(patches).toHaveLength(1)
    const rows = patches[0]?.insert ?? []
    expect(rows.map(row => [row.id, row.name])).toEqual([
      ['sdk-app-startup', '@solsticeai/equinox-sdk-app'],
      ['sdk-jsonrpc-server', '@solsticeai/equinox-sdk-jsonrpc-server'],
      ['deepseek-llm-api-extensions', '@solsticeai/equinox-deepseek-llm-api-extensions'],
      ['session-log-deepseek', '@solsticeai/equinox-session-log-deepseek'],
      ['plugin-package-inventory-deepseek', '@solsticeai/equinox-plugin-package-inventory-deepseek'],
      ['llm-deepseek', '@solsticeai/equinox-llm-deepseek'],
      ['sandbox', '@solsticeai/equinox-sandbox-local'],
      ['session-projection', '@solsticeai/equinox-session-projection'],
      ['sandbox-policy', '@solsticeai/equinox-sandbox-policy'],
      ['subprocess', '@solsticeai/equinox-subprocess-local'],
      ['pty', '@solsticeai/equinox-terminal'],
      ['terminal-bash', '@solsticeai/equinox-terminal-bash'],
      ['terminal-pwsh', '@solsticeai/equinox-terminal-bash'],
      ['fs-local', '@solsticeai/equinox-fs-local'],
      ['timer', '@solsticeai/cordis-plugin-timer'],
      ['llm', '@solsticeai/equinox-llm'],
      ['session', '@solsticeai/equinox-session'],
      ['session-title', '@solsticeai/equinox-session-title'],
      ['system-prompt', '@solsticeai/equinox-system-prompt'],
      ['tools', '@solsticeai/equinox-tools'],
      ['agent', '@solsticeai/equinox-agent'],
      ['llm-retry', '@solsticeai/equinox-llm-retry'],
      ['jobs', '@solsticeai/equinox-jobs-local'],
      ['invariants', '@solsticeai/equinox-invariants'],
      ['session-invariant', '@solsticeai/equinox-session/invariant'],
      ['agent-invariant', '@solsticeai/equinox-agent/invariant'],
      ['scope-invariant', '@solsticeai/equinox-scope/invariant'],
      ['agent-loop-invariant', '@solsticeai/equinox-agent-loop/invariant'],
      ['agent-loop', '@solsticeai/equinox-agent-loop'],
      ['persistent-bash', '@solsticeai/equinox-tool-bash-persistent'],
      ['persistent-pwsh', '@solsticeai/equinox-tool-pwsh-persistent'],
      ['str-replace-editor', '@solsticeai/equinox-tool-str-replace-editor'],
      ['sessions', '@solsticeai/equinox-session-persistence-jsonl'],
    ])
    expect(rows.find(row => row.id === 'sdk-app-startup')?.config).toEqual({ profile: 'sdk-minimal' })
    expect(rows.find(row => row.id === 'sdk-jsonrpc-server')).toMatchObject({
      inject: ['sdkAppStartup', 'loader'],
      config: { maxTokensAsSuccess: false },
    })
    expect(rows.find(row => row.id === 'llm-deepseek')?.config).toEqual({
      apiKeyEnv: 'DEEPSEEK_API_KEY',
      defaultContextWindow: { __jsExpr: 'Number(process.env.DSH_CONTEXT_WINDOW ?? 1000000)' },
      streamIdleTimeoutMs: 172800000,
    })
    expect(rows.find(row => row.id === 'system-prompt')?.config).toEqual({
      includeHarnessIdentity: false,
      includeRuntimeContext: false,
      persona: { __jsExpr: "process.env.DSH_SYSTEM_PROMPT ?? 'You are a helpful software engineer assistant.'" },
    })
    expect(rows.find(row => row.id === 'agent-loop')?.config).toEqual({ agents: [] })
    expect(rows.find(row => row.id === 'terminal-bash')).toMatchObject({
      disabled: { __jsExpr: "process.platform === 'win32'" },
    })
    expect(rows.find(row => row.id === 'terminal-pwsh')).toMatchObject({
      disabled: { __jsExpr: "process.platform !== 'win32'" },
      config: { shellDialect: 'pwsh', timeoutMs: 300000 },
    })
    expect(Object.keys(manifest.dependencies ?? {}).sort()).toEqual(
      [...new Set(rows.map(row => row.name).filter((name): name is string => name !== undefined).map(packageName))].sort(),
    )
  })
})
