import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { createRng } from '../../engine/rng'
import { balance } from '../config/balance'
import { weaponDefs } from './definitions'
import {
  cancelReload,
  createWeaponState,
  damageForZone,
  isReloading,
  reloadProgress,
  spreadDirection,
  stepWeapon,
  type TriggerInput,
} from './weaponState'

const DT = 1 / 60
const pistol = weaponDefs.pistol_service
const rifle = weaponDefs.rifle_carbine

const idle: TriggerInput = { held: false, pressed: false }
const hold: TriggerInput = { held: true, pressed: false }
const press: TriggerInput = { held: true, pressed: true }

function run(s: ReturnType<typeof createWeaponState>, trigger: TriggerInput, seconds: number) {
  let shots = 0
  for (let i = 0; i < Math.round(seconds / DT); i++) shots += stepWeapon(s, trigger, false, DT)
  return shots
}

describe('stepWeapon: firing', () => {
  it('semi-auto fires once per trigger press, not while held', () => {
    const s = createWeaponState(pistol)
    expect(stepWeapon(s, press, false, DT)).toBe(1)
    expect(run(s, hold, 1)).toBe(0)
    expect(s.mag).toBe(pistol.magazineSize - 1)
  })

  it('semi-auto ignores presses faster than its RPM', () => {
    const s = createWeaponState(pistol)
    expect(stepWeapon(s, press, false, DT)).toBe(1)
    expect(stepWeapon(s, press, false, DT)).toBe(0) // 1/60 s later; interval is 0.15 s
    run(s, idle, 0.15)
    expect(stepWeapon(s, press, false, DT)).toBe(1)
  })

  it('full-auto fires at its RPM while held', () => {
    const s = createWeaponState(rifle)
    const shots = run(s, hold, 1)
    const expected = rifle.rpm / 60
    expect(Math.abs(shots - expected)).toBeLessThanOrEqual(1)
  })

  it('does not bank idle time into a burst', () => {
    const s = createWeaponState(rifle)
    run(s, idle, 2)
    expect(stepWeapon(s, hold, false, DT)).toBe(1)
  })
})

describe('stepWeapon: ammo and reloads', () => {
  it('auto-reloads after the last round and refills from reserve', () => {
    const s = createWeaponState(pistol)
    s.mag = 1
    expect(stepWeapon(s, press, false, DT)).toBe(1)
    expect(s.mag).toBe(0)
    expect(isReloading(s)).toBe(true)
    run(s, idle, pistol.reloadTime + DT)
    expect(isReloading(s)).toBe(false)
    expect(s.mag).toBe(pistol.magazineSize)
    expect(s.reserve).toBe(pistol.reserveAmmo - pistol.magazineSize)
  })

  it('cannot fire while reloading', () => {
    const s = createWeaponState(rifle)
    s.mag = 5
    stepWeapon(s, idle, true, DT)
    expect(isReloading(s)).toBe(true)
    expect(run(s, hold, rifle.reloadTime / 2)).toBe(0)
    expect(reloadProgress(s)).toBeGreaterThan(0.4)
  })

  it('reload takes only what the reserve has', () => {
    const s = createWeaponState(pistol)
    s.mag = 2
    s.reserve = 3
    stepWeapon(s, idle, true, DT)
    run(s, idle, pistol.reloadTime + DT)
    expect(s.mag).toBe(5)
    expect(s.reserve).toBe(0)
  })

  it('will not reload a full magazine or with an empty reserve', () => {
    const full = createWeaponState(pistol)
    stepWeapon(full, idle, true, DT)
    expect(isReloading(full)).toBe(false)

    const dry = createWeaponState(pistol)
    dry.mag = 0
    dry.reserve = 0
    expect(stepWeapon(dry, press, true, DT)).toBe(0)
    expect(isReloading(dry)).toBe(false)
  })

  it('pulling the trigger on an empty magazine starts a reload', () => {
    const s = createWeaponState(pistol)
    s.mag = 0
    expect(stepWeapon(s, press, false, DT)).toBe(0)
    expect(isReloading(s)).toBe(true)
  })

  it('cancelling a reload moves no ammo', () => {
    const s = createWeaponState(rifle)
    s.mag = 3
    stepWeapon(s, idle, true, DT)
    run(s, idle, rifle.reloadTime * 0.9)
    cancelReload(s)
    expect(s.mag).toBe(3)
    expect(s.reserve).toBe(rifle.reserveAmmo)
  })
})

describe('damageForZone', () => {
  it('applies the weapon headshot multiplier and zone multipliers from balance', () => {
    const c = balance.combat
    expect(damageForZone(pistol, 'head', c)).toBe(pistol.damage * pistol.headshotMultiplier)
    expect(damageForZone(pistol, 'neck', c)).toBe(pistol.damage * c.neckMultiplier)
    expect(damageForZone(pistol, 'torso', c)).toBe(pistol.damage * c.torsoMultiplier)
    expect(damageForZone(pistol, 'limb', c)).toBe(pistol.damage * c.limbMultiplier)
  })

  it('pistol kills a round-1 target in 2 headshots or 4 body shots', () => {
    const hp = balance.targetDummy.health
    const c = balance.combat
    expect(Math.ceil(hp / damageForZone(pistol, 'head', c))).toBe(2)
    expect(Math.ceil(hp / damageForZone(pistol, 'torso', c))).toBe(4)
  })
})

describe('spreadDirection', () => {
  it('stays within the cone and is normalised', () => {
    const rng = createRng(42)
    const dir = new THREE.Vector3(0.3, -0.2, -1).normalize()
    const out = new THREE.Vector3()
    const spread = THREE.MathUtils.degToRad(3)
    for (let i = 0; i < 500; i++) {
      spreadDirection(dir, spread, rng, out)
      expect(out.length()).toBeCloseTo(1)
      expect(out.angleTo(dir)).toBeLessThanOrEqual(spread + 1e-9)
    }
  })

  it('zero spread returns the input direction', () => {
    const dir = new THREE.Vector3(0, 0, -1)
    const out = spreadDirection(dir, 0, createRng(1), new THREE.Vector3())
    expect(out.equals(dir)).toBe(true)
  })
})
