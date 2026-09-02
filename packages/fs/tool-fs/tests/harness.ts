import { Context } from '@solsticeai/cordis'
import type { Agent } from '@solsticeai/equinox-agent'
import AgentLoop from '@solsticeai/equinox-agent-loop'
import SessionProjectionRegistry from '@solsticeai/equinox-session-projection'
import { mountAgentLoopTestDependencies } from '@solsticeai/equinox-agent-loop-testkit'
import LocalFileSystem from '@solsticeai/equinox-fs-local'
import * as FsPolicy from '@solsticeai/equinox-fs-observation-policy'
import * as ToolFs from '@solsticeai/equinox-tool-fs'
import * as LlmDeepSeek from '@solsticeai/equinox-llm-deepseek'

/**
 * Build the real fs-tool stack for with-key e2e tests. Agents have no session
 * cwd, so `fsCwd` is their workspace; `persona` configures the deployment prompt.
 * This helper lives outside the e2e glob so imports do not register tests.
 */
export async function fsHarness(fsCwd: string, persona = ''): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionProjectionRegistry)
  await mountAgentLoopTestDependencies(ctx, { systemPrompt: { persona } })
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(LlmDeepSeek)
  await ctx.plugin(LocalFileSystem, { cwd: fsCwd })
  await ctx.plugin(FsPolicy)
  await ctx.plugin(ToolFs)
  return ctx
}

export function waitForIdle(ctx: Context, agent: Agent): Promise<void> {
  return new Promise((resolve) => {
    const dispose = ctx.on('agent/status', ({ agent: subject, status }) => {
      if (subject === agent && status === 'idle') {
        dispose()
        resolve()
      }
    })
  })
}
