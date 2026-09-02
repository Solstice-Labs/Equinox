import { clientBundle } from '../../client/tsdown.client.ts'

export default clientBundle(
  '@solsticeai/equinox-api-remotes',
  ['lib/types/index.js'],
  { hostPhase: true },
)
