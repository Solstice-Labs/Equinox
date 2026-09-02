import type { TurnBoundaryProjection } from './types.ts'
import type {} from '@solsticeai/equinox-session-projection'

declare module '@solsticeai/equinox-session-projection/types' {
  interface SessionProjectionStateMap {
    /** The agent session's open/last turn and step boundary facts (whole value). */
    turnBoundary: TurnBoundaryProjection
  }
}

export {}
