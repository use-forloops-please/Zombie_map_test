import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { balance } from '../config/balance'
import { applyLook, createPlayer, stepVelocity, wishDirection, type MoveIntent } from './Player'

const t = balance.player
const DT = 1 / 60

function intent(wish: THREE.Vector3, sprint = false, jump = false): MoveIntent {
  return { wish, sprint, jump }
}

function simulate(v: THREE.Vector3, i: MoveIntent, grounded: boolean, seconds: number) {
  for (let s = 0; s < Math.round(seconds / DT); s++) stepVelocity(v, i, grounded, DT, t)
}

const horizontalSpeed = (v: THREE.Vector3) => Math.hypot(v.x, v.z)

describe('wishDirection', () => {
  it('yaw 0 forward faces -Z and strafe right faces +X', () => {
    const out = new THREE.Vector3()
    wishDirection(1, 0, 0, out)
    expect(out.x).toBeCloseTo(0)
    expect(out.z).toBeCloseTo(-1)
    wishDirection(0, 1, 0, out)
    expect(out.x).toBeCloseTo(1)
    expect(out.z).toBeCloseTo(0)
  })

  it('yaw 90° forward faces -X', () => {
    const out = wishDirection(1, 0, Math.PI / 2, new THREE.Vector3())
    expect(out.x).toBeCloseTo(-1)
    expect(out.z).toBeCloseTo(0)
  })

  it('normalises diagonals', () => {
    const out = wishDirection(1, 1, 0.3, new THREE.Vector3())
    expect(out.length()).toBeCloseTo(1)
  })
})

describe('stepVelocity', () => {
  it('accelerates to walk speed on the ground and no faster', () => {
    const v = new THREE.Vector3()
    simulate(v, intent(new THREE.Vector3(0, 0, -1)), true, 2)
    expect(horizontalSpeed(v)).toBeCloseTo(t.walkSpeed)
  })

  it('sprint reaches sprint speed', () => {
    const v = new THREE.Vector3()
    simulate(v, intent(new THREE.Vector3(1, 0, 0), true), true, 2)
    expect(horizontalSpeed(v)).toBeCloseTo(t.sprintSpeed)
  })

  it('stops quickly on the ground with no input', () => {
    const v = new THREE.Vector3(t.sprintSpeed, 0, 0)
    simulate(v, intent(new THREE.Vector3()), true, 0.25)
    expect(horizontalSpeed(v)).toBeCloseTo(0)
  })

  it('keeps most momentum in the air', () => {
    const v = new THREE.Vector3(t.walkSpeed, 0, 0)
    simulate(v, intent(new THREE.Vector3()), false, 0.25)
    expect(horizontalSpeed(v)).toBeGreaterThan(t.walkSpeed * 0.5)
  })

  it('jumps only when grounded', () => {
    const v = new THREE.Vector3()
    stepVelocity(v, intent(new THREE.Vector3(), false, true), true, DT, t)
    expect(v.y).toBe(t.jumpVelocity)

    const air = new THREE.Vector3()
    stepVelocity(air, intent(new THREE.Vector3(), false, true), false, DT, t)
    expect(air.y).toBeLessThan(0)
  })

  it('jump apex is about 1 m', () => {
    const v = new THREE.Vector3()
    let y = 0
    let apex = 0
    stepVelocity(v, intent(new THREE.Vector3(), false, true), true, DT, t)
    for (let i = 0; i < 120; i++) {
      y += v.y * DT
      apex = Math.max(apex, y)
      stepVelocity(v, intent(new THREE.Vector3()), false, DT, t)
    }
    expect(apex).toBeGreaterThan(0.9)
    expect(apex).toBeLessThan(1.1)
  })

  it('clamps fall speed', () => {
    const v = new THREE.Vector3()
    simulate(v, intent(new THREE.Vector3()), false, 10)
    expect(v.y).toBe(-t.maxFallSpeed)
  })
})

describe('applyLook', () => {
  it('clamps pitch short of straight up/down', () => {
    const p = createPlayer({ x: 0, y: 0, z: 0 }, 0)
    applyLook(p, 0, -1e6, t.mouseSensitivity)
    expect(p.pitch).toBeLessThan(Math.PI / 2)
    expect(p.pitch).toBeGreaterThan(Math.PI / 2 - 0.05)
  })

  it('moving the mouse right turns right (yaw decreases)', () => {
    const p = createPlayer({ x: 0, y: 0, z: 0 }, 0)
    applyLook(p, 100, 0, t.mouseSensitivity)
    expect(p.yaw).toBeLessThan(0)
  })
})
