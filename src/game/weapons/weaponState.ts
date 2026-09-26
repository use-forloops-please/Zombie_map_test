import * as THREE from 'three'
import type { Rng } from '../../engine/rng'
import type { CombatTuning } from '../config/balance'
import type { HitZone } from '../entities/hitboxes'
import type { WeaponDef } from './definitions'

/** Runtime state of one owned weapon. Pure data; advanced by `stepWeapon`. */
export interface WeaponState {
  readonly def: WeaponDef
  mag: number
  reserve: number
  /** Seconds until the next shot is allowed. May carry a small negative remainder while firing. */
  cooldown: number
  /** Seconds left on the current reload; 0 when not reloading. */
  reloadTimer: number
}

export interface TriggerInput {
  /** Fire button is held this step. */
  held: boolean
  /** Fire button went down since the last step. */
  pressed: boolean
}

export function createWeaponState(def: WeaponDef): WeaponState {
  return { def, mag: def.magazineSize, reserve: def.reserveAmmo, cooldown: 0, reloadTimer: 0 }
}

export function isReloading(s: WeaponState): boolean {
  return s.reloadTimer > 0
}

export function canReload(s: WeaponState): boolean {
  return !isReloading(s) && s.mag < s.def.magazineSize && s.reserve > 0
}

export function startReload(s: WeaponState): boolean {
  if (!canReload(s)) return false
  s.reloadTimer = s.def.reloadTime
  return true
}

/** Abandons a reload in progress (e.g. on weapon switch). No ammo moves. */
export function cancelReload(s: WeaponState): void {
  s.reloadTimer = 0
}

/** 0 → 1 over the current reload; 0 when not reloading. */
export function reloadProgress(s: WeaponState): number {
  return isReloading(s) ? 1 - s.reloadTimer / s.def.reloadTime : 0
}

function finishReload(s: WeaponState): void {
  const take = Math.min(s.def.magazineSize - s.mag, s.reserve)
  s.mag += take
  s.reserve -= take
  s.reloadTimer = 0
}

/**
 * Advances one weapon by `dt`: reload progress, manual reload, and firing.
 * Returns how many rounds were fired this step. Firing the last round, or pulling
 * the trigger on an empty magazine, starts a reload automatically.
 */
export function stepWeapon(
  s: WeaponState,
  trigger: TriggerInput,
  reloadPressed: boolean,
  dt: number,
): number {
  if (isReloading(s)) {
    s.reloadTimer -= dt
    if (s.reloadTimer <= 0) finishReload(s)
    s.cooldown = Math.max(s.cooldown - dt, 0)
    return 0
  }

  if (reloadPressed && startReload(s)) return 0

  s.cooldown -= dt
  const auto = s.def.fireMode === 'auto'
  const wantsFire = auto ? trigger.held : trigger.pressed
  const interval = 60 / s.def.rpm
  let shots = 0

  if (wantsFire) {
    if (s.mag === 0) {
      startReload(s)
    } else {
      // Loop so fire rate stays exact even when the interval isn't a multiple of dt.
      while (s.cooldown <= 0 && s.mag > 0 && (auto || shots === 0)) {
        s.mag--
        s.cooldown += interval
        shots++
      }
      if (shots > 0 && s.mag === 0) startReload(s)
    }
  }

  // Don't bank idle time as extra shots.
  if (s.cooldown < 0) s.cooldown = 0
  return shots
}

export function damageForZone(def: WeaponDef, zone: HitZone, t: CombatTuning): number {
  switch (zone) {
    case 'head':
      return def.damage * def.headshotMultiplier
    case 'neck':
      return def.damage * t.neckMultiplier
    case 'torso':
      return def.damage * t.torsoMultiplier
    case 'limb':
      return def.damage * t.limbMultiplier
  }
}

const tmpA = new THREE.Vector3()
const tmpB = new THREE.Vector3()

/**
 * Writes `dir` (normalised) deflected by a random angle within a cone of half-angle
 * `spreadRad` into `out`, uniformly distributed over the cone's cross-section.
 */
export function spreadDirection(
  dir: THREE.Vector3,
  spreadRad: number,
  rng: Rng,
  out: THREE.Vector3,
): THREE.Vector3 {
  out.copy(dir)
  if (spreadRad <= 0) return out
  // Orthonormal basis around dir.
  const up = Math.abs(dir.y) < 0.99 ? tmpA.set(0, 1, 0) : tmpA.set(1, 0, 0)
  const right = tmpB.crossVectors(dir, up).normalize()
  const upOrtho = tmpA.crossVectors(right, dir).normalize()
  const angle = spreadRad * Math.sqrt(rng())
  const theta = 2 * Math.PI * rng()
  const r = Math.tan(angle)
  out
    .addScaledVector(right, Math.cos(theta) * r)
    .addScaledVector(upOrtho, Math.sin(theta) * r)
    .normalize()
  return out
}
