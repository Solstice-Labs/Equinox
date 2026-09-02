import { clientBundle } from '../../client/tsdown.client.ts'

export default clientBundle(
  '@solsticeai/equinox-api-session-controller',
  ['lib/types/index.js'],
  { hostPhase: true },
)
