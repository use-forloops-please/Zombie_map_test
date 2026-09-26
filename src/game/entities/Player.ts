import * as THREE from 'three'
import type { PlayerTuning } from '../config/balance'

const MAX_PITCH = THREE.MathUtils.degToRad(89)

export interface Player {
  /** Feet position after the latest simulation step. */
  readonly position: THREE.Vector3
  /** Feet position before the latest simulation step, for render interpolation. */
  readonly prevPosition: THREE.Vector3
  readonly velocity: THREE.Vector3
  /** Radians about +Y. 0 faces -Z. */
  yaw: number
  /** Radians. Positive looks up. */
  pitch: number
  grounded: boolean
}

export function createPlayer(feet: THREE.Vector3Like, yaw: number): Player {
  return {
    position: new THREE.Vector3().copy(feet),
    prevPosition: new THREE.Vector3().copy(feet),
    velocity: new THREE.Vector3(),
    yaw,
    pitch: 0,
    grounded: false,
  }
}

/** Applies a mouse delta (pixels) to the player's view angles. */
export function applyLook(player: Player, dx: number, dy: number, sensitivity: number): void {
  player.yaw -= dx * sensitivity
  player.pitch = THREE.MathUtils.clamp(player.pitch - dy * sensitivity, -MAX_PITCH, MAX_PITCH)
}

/** Rotates the view by a recoil kick (radians; positive pitch looks up, positive yaw turns left). */
export function addViewKick(player: Player, pitch: number, yaw: number): void {
  player.yaw += yaw
  player.pitch = THREE.MathUtils.clamp(player.pitch + pitch, -MAX_PITCH, MAX_PITCH)
}

/** Writes the unit vector the player is looking along into `out`. */
export function viewDirection(player: Player, out: THREE.Vector3): THREE.Vector3 {
  const cp = Math.cos(player.pitch)
  return out.set(-Math.sin(player.yaw) * cp, Math.sin(player.pitch), -Math.cos(player.yaw) * cp)
}

/**
 * Converts forward/strafe axes (each -1..1) into a horizontal world-space direction
 * for the given yaw. The result has length ≤ 1, so diagonals are no faster.
 */
export function wishDirection(
  forward: number,
  strafe: number,
  yaw: number,
  out: THREE.Vector3,
): THREE.Vector3 {
  const sin = Math.sin(yaw)
  const cos = Math.cos(yaw)
  // forward = (-sin, 0, -cos), right = (cos, 0, -sin)
  out.set(-sin * forward + cos * strafe, 0, -cos * forward - sin * strafe)
  const len = out.length()
  if (len > 1) out.divideScalar(len)
  return out
}

export interface MoveIntent {
  /** Horizontal direction, length ≤ 1. */
  readonly wish: THREE.Vector3
  readonly sprint: boolean
  readonly jump: boolean
}

/**
 * Advances the player's velocity by one step. Horizontal velocity moves toward
 * `wish × speed` at a capped acceleration (which doubles as ground friction);
 * vertical velocity handles jumping and gravity.
 */
export function stepVelocity(
  velocity: THREE.Vector3,
  intent: MoveIntent,
  grounded: boolean,
  dt: number,
  t: PlayerTuning,
): void {
  const speed = intent.sprint ? t.sprintSpeed : t.walkSpeed
  const accel = grounded ? t.groundAccel : t.airAccel
  const dx = intent.wish.x * speed - velocity.x
  const dz = intent.wish.z * speed - velocity.z
  const diff = Math.hypot(dx, dz)
  const maxDelta = accel * dt
  const k = diff > maxDelta ? maxDelta / diff : 1
  velocity.x += dx * k
  velocity.z += dz * k

  if (grounded && intent.jump) {
    velocity.y = t.jumpVelocity
  } else {
    velocity.y = Math.max(velocity.y - t.gravity * dt, -t.maxFallSpeed)
  }
}
