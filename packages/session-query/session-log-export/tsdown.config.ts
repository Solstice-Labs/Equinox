import { clientBundle } from '../../client/tsdown.client.ts'

export default clientBundle(
  '@solsticeai/equinox-session-log-export',
  ['lib/types/index.js'],
  { hostPhase: true },
)
