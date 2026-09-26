import * as THREE from 'three'
import { weaponDefs, type WeaponId } from '../weapons/definitions'

/**
 * Placeholder "box-gun" for a weapon, from its `viewmodel` entry: body + barrel + grip
 * (+ magazine for long guns), pointing down -Z, with the rear of the body near the origin.
 * Used for the first-person viewmodel and the weapon floating in the supply crate.
 */
export function buildBoxGun(id: WeaponId): THREE.Group {
  const { size, color, glow } = weaponDefs[id].viewmodel
  const [len, h, w] = size
  const body = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.6,
    metalness: 0.3,
    emissive: glow ?? '#000000',
    emissiveIntensity: glow ? 0.9 : 0,
  })
  const dark = new THREE.MeshStandardMaterial({ color: '#151618', roughness: 0.8 })
  const box = (
    sx: number,
    sy: number,
    sz: number,
    mat: THREE.Material,
    x: number,
    y: number,
    z: number,
  ) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat)
    m.position.set(x, y, z)
    return m
  }

  const group = new THREE.Group()
  group.add(box(w, h, len, body, 0, 0, -len / 2 + 0.08))
  group.add(
    box(w * 0.45, h * 0.45, len * 0.3, glow ? body : dark, 0, h * 0.15, -len + 0.08 - len * 0.15),
  )
  group.add(box(w * 0.9, h * 1.3, 0.05, dark, 0, -h * 0.9, 0.04))
  if (len > 0.3) group.add(box(w * 0.8, h * 1.1, 0.07, dark, 0, -h * 0.9, -len * 0.45))
  return group
}

/** Disposes every geometry and material in a box-gun group. */
export function disposeBoxGun(group: THREE.Object3D): void {
  group.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.geometry.dispose()
      ;(obj.material as THREE.Material).dispose()
    }
  })
}
