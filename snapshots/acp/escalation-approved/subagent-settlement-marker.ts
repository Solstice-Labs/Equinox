import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Context } from '@solsticeai/cordis'
import type {} from '@solsticeai/equinox-subagent'

export const name = 'subagent-settlement-marker'

/** Publish a workspace marker after a subagent lifecycle end. */
export function apply(ctx: Context): void {
  ctx.on('subagent/end', () => {
    writeFileSync(join(process.cwd(), '.dsh-snapshot-subagent-settled'), '')
  })
}
