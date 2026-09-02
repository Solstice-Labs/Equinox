import { clientBundle } from '../../client/tsdown.client.ts'

export default clientBundle(
  '@solsticeai/equinox-api-workspace-controller',
  ['lib/types/index.js'],
  { hostPhase: true },
)
