import * as THREE from 'three'
import type { WallBuy } from '../entities/WallBuy'
import { weaponDefs } from '../weapons/definitions'

const SIGN_WIDTH = 0.9
const SIGN_HEIGHT = 0.45
/** Lift off the wall to avoid z-fighting. */
const WALL_OFFSET = 0.01

/**
 * Wall-buy signs: a chalk outline of the weapon plus its name and prices, drawn once to
 * a canvas texture. One small mesh per wall-buy.
 */
export class WallBuyRenderer {
  readonly group = new THREE.Group()
  private readonly textures: THREE.Texture[] = []
  private readonly materials: THREE.Material[] = []
  private readonly geometry = new THREE.PlaneGeometry(SIGN_WIDTH, SIGN_HEIGHT)

  constructor(wallBuys: readonly WallBuy[]) {
    for (const wb of wallBuys) {
      const texture = drawSign(wb)
      const material = new THREE.MeshStandardMaterial({
        map: texture,
        roughness: 0.95,
        emissive: '#ffffff',
        emissiveMap: texture,
        emissiveIntensity: 0.25,
      })
      const mesh = new THREE.Mesh(this.geometry, material)
      mesh.position.copy(wb.position).addScaledVector(wb.facing, WALL_OFFSET)
      // PlaneGeometry faces +Z; turn it to face along `facing`.
      mesh.rotation.y = Math.atan2(wb.facing.x, wb.facing.z)
      mesh.receiveShadow = true
      this.group.add(mesh)
      this.textures.push(texture)
      this.materials.push(material)
    }
  }

  dispose(): void {
    this.geometry.dispose()
    for (const t of this.textures) t.dispose()
    for (const m of this.materials) m.dispose()
  }
}

function drawSign(wb: WallBuy): THREE.CanvasTexture {
  const w = 512
  const h = 256
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2D canvas context unavailable')
  const def = weaponDefs[wb.weapon]

  ctx.fillStyle = '#1b1c1e'
  ctx.fillRect(0, 0, w, h)
  ctx.strokeStyle = 'rgba(230, 226, 214, 0.85)'
  ctx.lineWidth = 5
  ctx.setLineDash([14, 6])
  ctx.strokeRect(10, 10, w - 20, h - 20)
  ctx.setLineDash([])

  // Chalk silhouette of the gun, scaled from its viewmodel box.
  const [len, height] = def.viewmodel.size
  const scale = 300 / 0.6
  const gw = len * scale
  const gh = Math.max(height * scale, 34)
  const gx = (w - gw) / 2
  const gy = 60
  ctx.lineWidth = 4
  ctx.strokeRect(gx, gy, gw, gh)
  ctx.strokeRect(gx + gw * 0.12, gy + gh, gh * 0.55, gh * 1.1)
  if (len > 0.3) ctx.strokeRect(gx + gw * 0.5, gy + gh, gh * 0.45, gh * 0.9)

  ctx.fillStyle = 'rgba(230, 226, 214, 0.95)'
  ctx.font = 'bold 34px monospace'
  ctx.textAlign = 'center'
  ctx.fillText(def.name.toUpperCase(), w / 2, 190)
  ctx.font = '24px monospace'
  ctx.fillText(`${wb.cost}  ·  ammo ${wb.ammoCost}`, w / 2, 226)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  return texture
}
