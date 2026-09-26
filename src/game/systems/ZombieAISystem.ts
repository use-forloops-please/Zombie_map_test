import * as THREE from 'three'
import type { Navigation } from '../../maps/navmesh'
import type { BarricadeTuning, ZombieTuning } from '../config/balance'
import type { Player } from '../entities/Player'
import type { Zombie } from '../entities/Zombie'
import type { GameEventBus } from '../events'
import type { BarricadeSystem } from './BarricadeSystem'

/** Max vertical gap between zombie and player feet for a swing to start or land. */
const ATTACK_HEIGHT_TOLERANCE = 1.2

/**
 * Adds a push away from nearby zombies to `out` (XZ only). Each neighbour closer than
 * `radius` contributes a unit vector away from it, scaled by how deep the overlap is.
 */
export function addSeparation(
  self: Zombie,
  zombies: readonly Zombie[],
  radius: number,
  out: THREE.Vector3,
): THREE.Vector3 {
  for (const other of zombies) {
    if (other === self || !other.alive) continue
    const dx = self.position.x - other.position.x
    const dz = self.position.z - other.position.z
    const d = Math.hypot(dx, dz)
    if (d >= radius) continue
    if (d < 1e-4) {
      // Exactly stacked: split them deterministically by index.
      out.x += self.index < other.index ? 1 : -1
      continue
    }
    const weight = 1 - d / radius
    out.x += (dx / d) * weight
    out.z += (dz / d) * weight
  }
  return out
}

/** Rotates `current` toward `target` by at most `maxStep` radians, taking the short way round. */
export function turnToward(current: number, target: number, maxStep: number): number {
  let diff = target - current
  diff = Math.atan2(Math.sin(diff), Math.cos(diff))
  if (Math.abs(diff) <= maxStep) return target
  return current + Math.sign(diff) * maxStep
}

/** Yaw (0 = facing -Z) that looks along the XZ direction (dx, dz). */
export function yawFromDirection(dx: number, dz: number): number {
  return Math.atan2(-dx, -dz)
}

/**
 * Drives every active zombie through its lifecycle:
 * spawning → approachWindow → tearingBoards → entering → chasing ⇄ attacking → dead.
 * Zombies without an entry window (tests, future scripted spawns) skip straight to chasing.
 */
export class ZombieAISystem {
  private readonly zombies: readonly Zombie[]
  private readonly player: Player
  private readonly nav: Navigation
  private readonly barricades: BarricadeSystem
  private readonly events: GameEventBus
  private readonly t: ZombieTuning
  private readonly bt: BarricadeTuning

  /** Player position snapped to the navmesh, refreshed each step. */
  private readonly target = new THREE.Vector3()
  private targetValid = false

  // Scratch vectors, reused every step.
  private readonly steer = new THREE.Vector3()
  private readonly push = new THREE.Vector3()
  private readonly next = new THREE.Vector3()
  private readonly unsubscribe: () => void

  constructor(
    zombies: readonly Zombie[],
    player: Player,
    nav: Navigation,
    barricades: BarricadeSystem,
    events: GameEventBus,
    tuning: ZombieTuning,
    barricadeTuning: BarricadeTuning,
  ) {
    this.zombies = zombies
    this.player = player
    this.nav = nav
    this.barricades = barricades
    this.events = events
    this.t = tuning
    this.bt = barricadeTuning
    this.unsubscribe = events.on('navmeshRebuilt', () => this.resnapAll())
  }

  dispose(): void {
    this.unsubscribe()
  }

  /** After a navmesh rebuild: refresh every zombie's polygon ref and force a repath. */
  private resnapAll(): void {
    for (const z of this.zombies) {
      if (!z.active) continue
      z.polyRef = this.nav.closestPoint(z.position, this.next)
      z.pathLength = 0
      z.repathTimer = 0
    }
  }

  update(dt: number): void {
    // Keep the last good target while the player is airborne or off the mesh.
    if (this.nav.closestPoint(this.player.position, this.target) !== 0) this.targetValid = true

    for (const z of this.zombies) {
      if (!z.active) continue
      z.prevPosition.copy(z.position)
      z.prevYaw = z.yaw
      z.flashTimer = Math.max(z.flashTimer - dt, 0)

      switch (z.state) {
        case 'spawning':
          z.stateTimer -= dt
          if (z.stateTimer <= 0) {
            if (z.entryWindow) this.startApproach(z)
            else this.startChasing(z)
          }
          break
        case 'approachWindow':
          this.approachWindow(z, dt)
          break
        case 'tearingBoards':
          this.tearBoards(z, dt)
          break
        case 'entering':
          this.enter(z, dt)
          break
        case 'chasing':
          this.chase(z, dt)
          break
        case 'attacking':
          this.attack(z, dt)
          break
        case 'dead':
          z.stateTimer -= dt
          if (z.stateTimer <= 0) z.deactivate()
          break
      }
      if (z.active) z.syncBody()
    }
  }

  private startApproach(z: Zombie): void {
    z.state = 'approachWindow'
    z.repathTimer = 0
    z.pathLength = 0
  }

  private startChasing(z: Zombie): void {
    z.state = 'chasing'
    // Stagger repaths across zombies so they don't all query the navmesh on the same step.
    z.repathTimer = (z.index / this.zombies.length) * this.t.repathInterval
    z.pathLength = 0
  }

  private startSwing(z: Zombie): void {
    z.state = 'attacking'
    z.stateTimer = this.t.attackWindup
    z.swingLanded = false
  }

  private approachWindow(z: Zombie, dt: number): void {
    const w = z.entryWindow
    if (!w) return this.startChasing(z)
    const stand = w.anchors.outsideStand
    if (horizontalDistance(z.position, stand) <= this.bt.tearRange) {
      z.state = 'tearingBoards'
      z.stateTimer = this.bt.tearInterval
      return
    }
    this.moveToward(z, stand, true, dt)
  }

  private tearBoards(z: Zombie, dt: number): void {
    const w = z.entryWindow
    if (!w) return this.startChasing(z)
    // Keep edging up to the window; separation lets a crowd tear from around the front one.
    if (horizontalDistance(z.position, w.anchors.outsideStand) > 0.1) {
      this.moveToward(z, w.anchors.outsideStand, true, dt)
    }
    z.yaw = turnToward(z.yaw, yawFromDirection(-w.outward.x, -w.outward.z), this.t.turnRate * dt)

    // Swipe through the window at a player standing right behind it.
    if (this.inAttackRange(z, this.t.windowAttackRange)) return this.startSwing(z)

    if (w.boards > 0) {
      z.stateTimer -= dt
      if (z.stateTimer <= 0) {
        this.barricades.tear(w)
        z.stateTimer = this.bt.tearInterval
      }
      return
    }
    if (w.tryClaim(z)) {
      z.state = 'entering'
      z.stateTimer = this.bt.climbTime
      z.climbFrom.copy(z.position)
    }
    // Otherwise another zombie is climbing through; wait our turn.
  }

  private enter(z: Zombie, dt: number): void {
    const w = z.entryWindow
    if (!w) return this.startChasing(z)
    const land = w.anchors.insideLand
    z.stateTimer -= dt
    const t = THREE.MathUtils.clamp(1 - z.stateTimer / this.bt.climbTime, 0, 1)
    // Arc over the sill: highest mid-climb, feet just clearing it.
    const sillTop = w.center.y - w.def.height / 2
    const lift = Math.max(sillTop - Math.min(z.climbFrom.y, land.y), 0) + 0.1
    z.position.lerpVectors(z.climbFrom, land, t)
    z.position.y += Math.sin(t * Math.PI) * lift
    z.yaw = turnToward(z.yaw, yawFromDirection(-w.outward.x, -w.outward.z), this.t.turnRate * dt)
    if (t < 1) return

    z.position.copy(land)
    z.polyRef = this.nav.closestPoint(land, z.position)
    w.release(z)
    z.entryWindow = null
    this.startChasing(z)
    z.repathTimer = 0
  }

  private chase(z: Zombie, dt: number): void {
    if (this.inAttackRange(z, this.t.attackRange)) return this.startSwing(z)
    this.moveToward(z, this.target, this.targetValid, dt)
  }

  private attack(z: Zombie, dt: number): void {
    const { t, player } = this
    const dx = player.position.x - z.position.x
    const dz = player.position.z - z.position.z
    z.yaw = turnToward(z.yaw, yawFromDirection(dx, dz), t.turnRate * dt)

    z.stateTimer -= dt
    if (z.stateTimer > 0) return
    if (!z.swingLanded) {
      z.swingLanded = true
      z.stateTimer = t.attackRecovery
      if (this.inAttackRange(z, t.attackReach)) {
        this.events.emit('playerHit', { damage: t.attackDamage })
      }
      return
    }
    // Back to work: zombies still outside go back to the boards.
    if (z.entryWindow) {
      z.state = 'tearingBoards'
      z.stateTimer = this.bt.tearInterval
      return
    }
    this.startChasing(z)
    z.repathTimer = 0
  }

  /**
   * Follows a navmesh path toward `goal` (repathing at most every repathInterval), with
   * separation from other zombies, staying on the navmesh surface.
   */
  private moveToward(z: Zombie, goal: THREE.Vector3, goalValid: boolean, dt: number): void {
    const { t } = this
    z.repathTimer -= dt
    if (z.repathTimer <= 0 && goalValid) {
      z.repathTimer += t.repathInterval
      z.pathLength = this.nav.findPath(z.position, goal, z.path)
      z.pathIndex = 1
    }

    // Head for the next path corner, or straight at the goal if there's no path yet.
    let corner: THREE.Vector3 | undefined
    while (z.pathIndex < z.pathLength) {
      corner = z.path[z.pathIndex]
      if (!corner || horizontalDistance(z.position, corner) > t.cornerReachDist) break
      z.pathIndex++
      corner = undefined
    }
    const aim = corner ?? goal
    this.steer.set(aim.x - z.position.x, 0, aim.z - z.position.z)
    if (this.steer.lengthSq() > 1e-6) this.steer.normalize().multiplyScalar(z.speed)

    this.push.set(0, 0, 0)
    addSeparation(z, this.zombies, t.separationRadius, this.push)
    // Scaled by speed so runners are held apart as firmly as walkers.
    this.steer.addScaledVector(this.push, t.separationStrength * z.speed)
    const maxSpeed = z.speed * 1.25
    if (this.steer.lengthSq() > maxSpeed * maxSpeed) this.steer.setLength(maxSpeed)

    this.next.copy(z.position).addScaledVector(this.steer, dt)
    z.polyRef = this.nav.moveAlong(z.polyRef, z.position, this.next, z.position)

    // Face where we're heading (the path, not the separation jostle).
    const faceX = aim.x - z.position.x
    const faceZ = aim.z - z.position.z
    if (faceX * faceX + faceZ * faceZ > 1e-4) {
      z.yaw = turnToward(z.yaw, yawFromDirection(faceX, faceZ), t.turnRate * dt)
    }
  }

  private inAttackRange(z: Zombie, range: number): boolean {
    const p = this.player.position
    return (
      horizontalDistance(z.position, p) <= range &&
      Math.abs(z.position.y - p.y) <= ATTACK_HEIGHT_TOLERANCE
    )
  }
}

function horizontalDistance(a: THREE.Vector3, b: THREE.Vector3): number {
  return Math.hypot(a.x - b.x, a.z - b.z)
}
