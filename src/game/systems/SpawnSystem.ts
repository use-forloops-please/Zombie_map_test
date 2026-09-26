import * as THREE from 'three'
import type { Rng } from '../../engine/rng'
import type { Navigation } from '../../maps/navmesh'
import type { ZombieTuning } from '../config/balance'
import type { SpawnWindow } from '../entities/SpawnWindow'
import type { Zombie } from '../entities/Zombie'
import type { ZoneState } from '../entities/Zones'
import type { ZombieSpawner } from './RoundSystem'

/**
 * Puts zombies into the world outside windows, from where they approach, tear the boards
 * and climb in. Only windows in active zones are used. The round system decides when and
 * how tough; this decides where.
 */
export class SpawnSystem implements ZombieSpawner {
  private readonly zombies: readonly Zombie[]
  private readonly windows: readonly SpawnWindow[]
  private readonly zones: ZoneState
  private readonly nav: Navigation
  private readonly rng: Rng
  private readonly t: ZombieTuning
  private readonly available: SpawnWindow[] = []
  private readonly snapped = new THREE.Vector3()

  constructor(
    zombies: readonly Zombie[],
    windows: readonly SpawnWindow[],
    zones: ZoneState,
    nav: Navigation,
    rng: Rng,
    tuning: ZombieTuning,
  ) {
    this.zombies = zombies
    this.windows = windows
    this.zones = zones
    this.nav = nav
    this.rng = rng
    this.t = tuning
  }

  get aliveCount(): number {
    let n = 0
    for (const z of this.zombies) if (z.alive) n++
    return n
  }

  /** Windows zombies can currently spawn at (those in active zones). */
  activeWindows(): SpawnWindow[] {
    this.available.length = 0
    for (const w of this.windows) if (this.zones.isActive(w.zone)) this.available.push(w)
    return this.available
  }

  spawn(health: number, runnerChance: number): boolean {
    return this.spawnAt(undefined, health, runnerChance) !== null
  }

  /**
   * Spawns one zombie outside `window` (or a random active window). Returns null if the
   * pool is full or no window is available.
   */
  spawnAt(window: SpawnWindow | undefined, health: number, runnerChance: number): Zombie | null {
    // A pool slot is free once its corpse has cleared.
    const zombie = this.zombies.find((z) => !z.active)
    const choices = this.activeWindows()
    const w = window ?? choices[Math.floor(this.rng() * choices.length)]
    if (!zombie || !w) return null

    const { spawnPoint } = w.anchors
    const ref = this.nav.closestPoint(spawnPoint, this.snapped)
    if (ref === 0) return null

    const runner = this.rng() < runnerChance
    // Face the window.
    const yaw = Math.atan2(-(w.center.x - spawnPoint.x), -(w.center.z - spawnPoint.z))
    zombie.activate(this.snapped, ref, yaw, health, runner ? this.t.runSpeed : this.t.walkSpeed, w)
    return zombie
  }
}
