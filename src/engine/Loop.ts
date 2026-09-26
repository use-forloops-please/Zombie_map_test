export interface LoopHandlers {
  /** Advance the simulation by exactly one fixed step. */
  update(dt: number): void
  /**
   * Draw a frame. `alpha` in [0, 1) is how far real time has progressed
   * between the last two simulation steps, for interpolating visuals.
   */
  render(alpha: number, frameDt: number): void
}

export interface LoopOptions {
  /** Simulation rate in Hz. */
  hz?: number
  /** Longest real frame time we will try to catch up on (avoids a spiral of death after a stall). */
  maxFrameTime?: number
}

/** Fixed-step simulation (default 60 Hz) with an interpolated render. */
export class Loop {
  readonly step: number
  private readonly maxFrameTime: number
  private readonly handlers: LoopHandlers
  private accumulator = 0
  private lastTime: number | null = null
  private rafId = 0
  private running = false

  constructor(handlers: LoopHandlers, options: LoopOptions = {}) {
    this.handlers = handlers
    this.step = 1 / (options.hz ?? 60)
    this.maxFrameTime = options.maxFrameTime ?? 0.25
  }

  get isRunning(): boolean {
    return this.running
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.lastTime = null
    this.rafId = requestAnimationFrame(this.frame)
  }

  stop(): void {
    this.running = false
    cancelAnimationFrame(this.rafId)
  }

  /**
   * Feed `elapsed` seconds of real time: runs as many fixed updates as fit,
   * then renders once. Returns the number of updates run. Separated from
   * requestAnimationFrame so it can be unit-tested.
   */
  advance(elapsed: number): number {
    const frameDt = Math.min(Math.max(elapsed, 0), this.maxFrameTime)
    this.accumulator += frameDt
    let steps = 0
    while (this.accumulator >= this.step) {
      this.handlers.update(this.step)
      this.accumulator -= this.step
      steps++
    }
    this.handlers.render(this.accumulator / this.step, frameDt)
    return steps
  }

  private frame = (now: number): void => {
    if (!this.running) return
    const elapsed = this.lastTime === null ? 0 : (now - this.lastTime) / 1000
    this.lastTime = now
    this.advance(elapsed)
    this.rafId = requestAnimationFrame(this.frame)
  }
}
