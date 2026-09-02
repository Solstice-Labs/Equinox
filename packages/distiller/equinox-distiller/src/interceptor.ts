/**
 * Intercepts 2 consecutive execution errors in the agent loop, freezing the
 * loop and handing the failing step to the sub-agent teacher for distillation.
 */

export interface InterceptorEvent {
  step: number
  consecutive: number
  error: Error
  /** True when the 2x threshold is crossed — the loop should freeze here. */
  triggered: boolean
}

export class ConsecutiveErrorInterceptor {
  private consecutive = 0
  private lastStep = -1

  constructor(private readonly threshold = 2) {}

  record(step: number, error: Error): InterceptorEvent {
    // A gap in step numbers means the loop progressed — reset the streak.
    if (step !== this.lastStep + 1 || this.lastStep < 0) {
      this.consecutive = 0
    }
    this.lastStep = step
    this.consecutive++
    const triggered = this.consecutive >= this.threshold
    if (triggered) this.consecutive = 0 // re-arm for the next pair
    return { step, consecutive: triggered ? this.threshold : this.consecutive, error, triggered }
  }

  reset(): void {
    this.consecutive = 0
    this.lastStep = -1
  }

  get streak(): number {
    return this.consecutive
  }
}