import { clientBundle } from '../tsdown.client.ts'

export default clientBundle(
  '@solsticeai/equinox-client-modules',
  ['lib/types/index.js', 'lib/types/invariant.js'],
)
