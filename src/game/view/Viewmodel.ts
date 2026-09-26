import * as THREE from 'three'
import type { WeaponViewState } from '../systems/WeaponSystem'
import { weaponDefs, type WeaponId } from '../weapons/definitions'
import { buildBoxGun } from './boxGun'
import { createFlashTexture } from './textures'

/** Resting position of the gun relative to the viewmodel camera. */
const BASE_POS = new THREE.Vector3(0.2, -0.19, -0.38)
const KICK_DECAY = 14
/** Seconds a muzzle flash stays up. */
const FLASH_TIME = 0.05
/** Peak intensity of the light a shot throws on the world and on the gun. */
const WORLD_FLASH_INTENSITY = 14
const GUN_FLASH_INTENSITY = 3

/**
 * First-person gun, drawn in its own scene after the world with a cleared depth buffer,
 * so it never clips into walls. Each shot jolts it back (per-weapon `viewmodel.kick`),
 * flashes a muzzle star at the barrel and briefly lights the room.
 * Placeholder box-guns until real models land.
 */
export class Viewmodel {
  readonly scene = new THREE.Scene()
  readonly camera = new THREE.PerspectiveCamera(60, 1, 0.01, 10)
  /**
   * Light thrown on the world by shots. Add it to the world scene; it stays there at zero
   * intensity between shots, so the light count (and every shader) never changes.
   */
  readonly worldLight = new THREE.PointLight('#ffc46b', 0, 9, 2)

  private readonly models = new Map<WeaponId, THREE.Group>()
  private readonly flash = new THREE.Group()
  private readonly flashMaterial: THREE.MeshBasicMaterial
  private readonly flashGeometry = new THREE.PlaneGeometry(1, 1)
  private readonly gunLight = new THREE.PointLight('#ffc46b', 0, 1.5, 2)
  private current: WeaponId | null = null
  private kick = 0
  private flashTimer = 0
  private bobTime = 0
  private bobAmount = 0

  constructor() {
    const hemi = new THREE.HemisphereLight('#9fb0c8', '#2a2420', 1.4)
    const key = new THREE.DirectionalLight('#ffe2b8', 1.2)
    key.position.set(1, 2, 1)
    this.scene.add(hemi, key, this.camera, this.gunLight)

    // A star facing the camera plus two crossed fins along the barrel.
    this.flashMaterial = new THREE.MeshBasicMaterial({
      map: createFlashTexture(),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
    const front = new THREE.Mesh(this.flashGeometry, this.flashMaterial)
    for (const roll of [0, Math.PI / 2]) {
      const fin = new THREE.Mesh(this.flashGeometry, this.flashMaterial)
      fin.rotation.set(0, Math.PI / 2, roll)
      fin.scale.set(1.6, 0.7, 1)
      fin.position.z = -0.45
      this.flash.add(fin)
    }
    this.flash.add(front)
    this.flash.visible = false
  }

  /** Call when a shot is fired. */
  fire(id: WeaponId): void {
    const { kick, flash } = weaponDefs[id].viewmodel
    this.kick = Math.min(this.kick + kick, 2.5)
    this.flashTimer = FLASH_TIME
    this.flashMaterial.color.set(flash.color)
    this.gunLight.color.set(flash.color)
    this.worldLight.color.set(flash.color)
    this.flash.scale.setScalar(flash.size * (0.8 + Math.random() * 0.4))
    this.flash.rotation.z = Math.random() * Math.PI * 2
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect
    this.camera.updateProjectionMatrix()
  }

  /** Puts the world flash light just ahead of the player's eye. */
  placeWorldLight(camera: THREE.Camera): void {
    camera.getWorldDirection(this.worldLight.position)
    this.worldLight.position.multiplyScalar(0.8).add(camera.position)
  }

  /** Poses the gun for this frame. `speed` is the player's horizontal speed in m/s. */
  update(frameDt: number, view: WeaponViewState, speed: number, grounded: boolean): void {
    if (view.weaponId !== this.current) this.show(view.weaponId)

    this.flashTimer = Math.max(this.flashTimer - frameDt, 0)
    const flashing = this.flashTimer > 0
    this.flash.visible = flashing
    const glow = flashing ? this.flashTimer / FLASH_TIME : 0
    this.worldLight.intensity = WORLD_FLASH_INTENSITY * glow
    this.gunLight.intensity = GUN_FLASH_INTENSITY * glow

    const model = this.current ? this.models.get(this.current) : undefined
    if (!model) return

    this.kick *= Math.exp(-KICK_DECAY * frameDt)
    const targetBob = grounded ? Math.min(speed / 7, 1) : 0
    this.bobAmount += (targetBob - this.bobAmount) * Math.min(frameDt * 8, 1)
    this.bobTime += frameDt * (4 + speed * 1.2)

    const reloadDip = Math.sin(view.reload * Math.PI)
    const switchDrop = view.switching
    // Melee: a quick jab forward and across, out and back over the swing.
    const jab = view.melee > 0 ? Math.sin((1 - view.melee) * Math.PI) : 0

    model.position.set(
      BASE_POS.x + Math.sin(this.bobTime) * 0.012 * this.bobAmount - jab * 0.12,
      BASE_POS.y -
        Math.abs(Math.cos(this.bobTime)) * 0.012 * this.bobAmount -
        reloadDip * 0.1 -
        switchDrop * 0.3,
      BASE_POS.z + this.kick * 0.045 - jab * 0.22,
    )
    model.rotation.set(this.kick * 0.1 - reloadDip * 0.35, jab * 0.6, reloadDip * 0.6 - jab * 0.4)
    this.gunLight.position.copy(model.position).add(this.flash.position)
  }

  dispose(): void {
    for (const model of this.models.values()) {
      model.remove(this.flash)
      model.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose()
          ;(obj.material as THREE.Material).dispose()
        }
      })
    }
    this.flashMaterial.map?.dispose()
    this.flashMaterial.dispose()
    this.flashGeometry.dispose()
  }

  private show(id: WeaponId | null): void {
    if (this.current) {
      const old = this.models.get(this.current)
      if (old) this.scene.remove(old)
    }
    this.current = id
    this.flash.removeFromParent()
    if (!id) return
    let model = this.models.get(id)
    if (!model) {
      model = buildBoxGun(id)
      this.models.set(id, model)
    }
    // At the tip of the barrel (see buildBoxGun's layout).
    const [len, h] = weaponDefs[id].viewmodel.size
    this.flash.position.set(0, h * 0.15, -len * 1.3 + 0.06)
    model.add(this.flash)
    this.scene.add(model)
  }
}
