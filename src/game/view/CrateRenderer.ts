import * as THREE from 'three'
import { CRATE_SIZE, type CrateSpotDef } from '../../maps/schema'
import type { CrateTuning } from '../config/balance'
import type { Crate } from '../entities/Crate'
import { weaponIds, type WeaponId } from '../weapons/definitions'
import { buildBoxGun, disposeBoxGun } from './boxGun'

const [W, H, D] = CRATE_SIZE
/** How high the offered weapon floats above the crate's lid. */
const FLOAT_HEIGHT = 0.45
/** Lid rotation about its back hinge when open (positive lifts the front edge). */
const LID_OPEN_ANGLE = 1.9

/**
 * A reinforced supply crate. When spun its lid swings open and weapon silhouettes cycle
 * above it, slowing down before the reveal; the offered weapon hovers and turns. When it
 * moves on it lifts away and fades, then fades in at its new spot.
 * Placeholder art until real models land.
 */
export class CrateRenderer {
  readonly group = new THREE.Group()
  private readonly crate: Crate
  private readonly t: CrateTuning
  private readonly body = new THREE.Group()
  private readonly lid = new THREE.Group()
  private readonly weaponAnchor = new THREE.Group()
  private readonly light = new THREE.PointLight('#8fd8ff', 0, 4)
  private readonly guns = new Map<WeaponId, THREE.Group>()
  private readonly materials: THREE.MeshStandardMaterial[] = []
  private readonly geometries: THREE.BufferGeometry[] = []
  private shown: WeaponId | null = null
  private cycleClock = 0
  private cycleIndex = 0

  constructor(crate: Crate, tuning: CrateTuning) {
    this.crate = crate
    this.t = tuning
    const wood = this.material('#6b4a2b', 0.9)
    const band = this.material('#3b3f45', 0.5, 0.6)
    const inner = this.material('#141210', 1)

    this.add(this.body, new THREE.BoxGeometry(W, H * 0.85, D), wood, 0, (H * 0.85) / 2, 0)
    this.add(this.body, new THREE.BoxGeometry(W * 0.94, 0.02, D * 0.9), inner, 0, H * 0.85, 0)
    for (const x of [-W * 0.35, W * 0.35]) {
      this.add(this.body, new THREE.BoxGeometry(0.08, H * 0.86, D * 1.02), band, x, H * 0.43, 0)
    }
    // Lid hinged along the back edge (+Z is the back, the front faces -Z locally).
    this.lid.position.set(0, H * 0.85, D / 2)
    this.add(
      this.lid,
      new THREE.BoxGeometry(W * 1.02, H * 0.15, D * 1.02),
      wood,
      0,
      H * 0.075,
      -D / 2,
    )
    this.add(
      this.lid,
      new THREE.BoxGeometry(W * 1.04, H * 0.16, 0.06),
      band,
      0,
      H * 0.075,
      -D + 0.06,
    )
    this.body.add(this.lid)

    this.weaponAnchor.position.set(0, H + FLOAT_HEIGHT, 0)
    this.body.add(this.weaponAnchor)
    this.light.position.set(0, H + 0.4, 0)
    this.body.add(this.light)

    this.group.add(this.body)
    this.body.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.castShadow = true
        o.receiveShadow = true
      }
    })
  }

  update(frameDt: number): void {
    const c = this.crate
    let lidTarget = 0
    let lift = 0
    let opacity = 1
    let spot: CrateSpotDef = c.spot
    let weapon: WeaponId | null = null

    switch (c.state) {
      case 'cycling': {
        lidTarget = LID_OPEN_ANGLE
        const progress = 1 - c.stateTimer / this.t.cycleTime
        // Flick through silhouettes, slowing toward the reveal.
        const interval = 0.06 + progress * progress * 0.35
        this.cycleClock += frameDt
        if (this.cycleClock >= interval) {
          this.cycleClock = 0
          this.cycleIndex = (this.cycleIndex + 1 + Math.floor(Math.random() * 3)) % weaponIds.length
        }
        weapon = progress > 0.92 && c.offer ? c.offer : (weaponIds[this.cycleIndex] ?? null)
        break
      }
      case 'offering':
        lidTarget = LID_OPEN_ANGLE
        weapon = c.offer
        break
      case 'relocating': {
        const t = 1 - c.stateTimer / this.t.relocateTime
        if (t < 0.5) {
          lidTarget = LID_OPEN_ANGLE * 0.3
          lift = t * 2 * 1.8
          opacity = 1 - t * 2
        } else {
          spot = c.nextSpot ?? c.spot
          lift = (1 - t) * 2 * 0.6
          opacity = (t - 0.5) * 2
        }
        break
      }
    }

    this.body.position.set(spot.pos[0], spot.pos[1] + lift, spot.pos[2])
    // Local -Z is the crate's front, matching the yaw convention.
    this.body.rotation.y = THREE.MathUtils.degToRad(spot.yaw)
    this.lid.rotation.x += (lidTarget - this.lid.rotation.x) * Math.min(frameDt * 8, 1)
    for (const m of this.materials) {
      m.transparent = opacity < 1
      m.opacity = opacity
    }

    this.showWeapon(weapon)
    this.weaponAnchor.rotation.y += frameDt * (c.state === 'offering' ? 1.2 : 0)
    this.weaponAnchor.position.y = H + FLOAT_HEIGHT + Math.sin(performance.now() / 400) * 0.03
    const glowing = c.state === 'cycling' || c.state === 'offering'
    this.light.intensity += ((glowing ? 1.6 : 0) - this.light.intensity) * Math.min(frameDt * 6, 1)
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose()
    for (const m of this.materials) m.dispose()
    for (const gun of this.guns.values()) disposeBoxGun(gun)
  }

  private showWeapon(id: WeaponId | null): void {
    if (id === this.shown) return
    if (this.shown) {
      const old = this.guns.get(this.shown)
      if (old) this.weaponAnchor.remove(old)
    }
    this.shown = id
    if (!id) return
    let gun = this.guns.get(id)
    if (!gun) {
      gun = buildBoxGun(id)
      // Centre it over the crate, side-on to the player.
      gun.rotation.y = Math.PI / 2
      gun.position.x = -0.2
      this.guns.set(id, gun)
    }
    this.weaponAnchor.add(gun)
  }

  private material(color: string, roughness: number, metalness = 0): THREE.MeshStandardMaterial {
    const m = new THREE.MeshStandardMaterial({ color, roughness, metalness })
    this.materials.push(m)
    return m
  }

  private add(
    parent: THREE.Object3D,
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    x: number,
    y: number,
    z: number,
  ): void {
    this.geometries.push(geo)
    const mesh = new THREE.Mesh(geo, mat)
    mesh.position.set(x, y, z)
    parent.add(mesh)
  }
}
