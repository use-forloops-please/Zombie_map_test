import * as THREE from 'three'

/**
 * Small textures drawn at runtime on a canvas, so the feel pass needs no image files.
 * Each is made once and shared.
 */

/** A splat of blood: a dense core, satellite droplets and a few streaks, on transparent. */
export function createBloodTexture(size = 256): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const g = canvas.getContext('2d')
  if (!g) throw new Error('2D canvas unavailable')
  const c = size / 2
  const blob = (x: number, y: number, r: number, alpha: number) => {
    const grad = g.createRadialGradient(x, y, 0, x, y, r)
    grad.addColorStop(0, `rgba(150, 12, 14, ${alpha})`)
    grad.addColorStop(0.7, `rgba(115, 8, 10, ${alpha * 0.9})`)
    grad.addColorStop(1, 'rgba(80, 4, 6, 0)')
    g.fillStyle = grad
    g.beginPath()
    g.arc(x, y, r, 0, Math.PI * 2)
    g.fill()
  }
  // Fixed layout (not Math.random) so the texture is the same every load.
  let seed = 11
  const rand = () => {
    seed = (seed * 16807) % 2147483647
    return seed / 2147483647
  }
  for (let i = 0; i < 14; i++) {
    const a = rand() * Math.PI * 2
    const d = rand() * size * 0.14
    blob(c + Math.cos(a) * d, c + Math.sin(a) * d, size * (0.1 + rand() * 0.12), 0.95)
  }
  for (let i = 0; i < 40; i++) {
    const a = rand() * Math.PI * 2
    const d = size * (0.18 + rand() * 0.28)
    blob(c + Math.cos(a) * d, c + Math.sin(a) * d, size * (0.008 + rand() * 0.03), 0.9)
  }
  g.lineCap = 'round'
  for (let i = 0; i < 7; i++) {
    const a = rand() * Math.PI * 2
    const d = size * (0.2 + rand() * 0.2)
    g.strokeStyle = 'rgba(120, 8, 10, 0.85)'
    g.lineWidth = size * (0.01 + rand() * 0.02)
    g.beginPath()
    g.moveTo(c + Math.cos(a) * size * 0.1, c + Math.sin(a) * size * 0.1)
    g.lineTo(c + Math.cos(a) * d, c + Math.sin(a) * d)
    g.stroke()
  }
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/** A white four-point star with a hot core, for additive muzzle flashes (tint via material). */
export function createFlashTexture(size = 128): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const g = canvas.getContext('2d')
  if (!g) throw new Error('2D canvas unavailable')
  const c = size / 2
  const core = g.createRadialGradient(c, c, 0, c, c, c)
  core.addColorStop(0, 'rgba(255,255,255,1)')
  core.addColorStop(0.25, 'rgba(255,255,255,0.6)')
  core.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = core
  g.fillRect(0, 0, size, size)
  g.fillStyle = 'rgba(255,255,255,0.8)'
  for (let k = 0; k < 4; k++) {
    g.save()
    g.translate(c, c)
    g.rotate((k * Math.PI) / 2 + 0.3)
    g.beginPath()
    g.moveTo(0, -size * 0.05)
    g.lineTo(c * (0.75 + (k % 2) * 0.2), 0)
    g.lineTo(0, size * 0.05)
    g.fill()
    g.restore()
  }
  return new THREE.CanvasTexture(canvas)
}
