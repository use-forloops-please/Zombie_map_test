import * as THREE from 'three'

/** Spring stiffness and damping for the punch returning to rest (critically damped-ish). */
const STIFFNESS = 180
const DAMPING = 22
const SHAKE_DECAY = 6
const SHAKE_FREQUENCY = 31

/**
 * Camera-only jolts layered on top of the player's view: a sharp punch per shot that
 * springs back, a lurch when hit, and shake from nearby blasts. Purely visual: aim comes
 * from the player's view angles (which carry the weapon's real recoil), not from this.
 */
export class ViewPunch {
  /** Current offset in radians: x = pitch, y = yaw, z = roll. Add to the camera's rotation. */
  readonly offset = new THREE.Vector3()
  private readonly velocity = new THREE.Vector3()
  private shake = 0
  private time = 0

  /** Kicks the view (radians per second of angular velocity). */
  punch(pitch: number, yaw: number, roll: number): void {
    this.velocity.x += pitch
    this.velocity.y += yaw
    this.velocity.z += roll
  }

  /** Adds shake (radians of peak wobble); it dies away over about half a second. */
  addShake(amount: number): void {
    this.shake = Math.min(this.shake + amount, 0.08)
  }

  update(frameDt: number): void {
    const dt = Math.min(frameDt, 1 / 30)
    this.time += dt
    // Spring back to rest: a = -k·x - c·v
    this.velocity.addScaledVector(this.offset, -STIFFNESS * dt)
    this.velocity.multiplyScalar(Math.max(1 - DAMPING * dt, 0))
    this.offset.addScaledVector(this.velocity, dt)

    this.shake *= Math.exp(-SHAKE_DECAY * dt)
    if (this.shake < 1e-4) this.shake = 0
  }

  /** Adds the current punch and shake to `rotation` (YXZ order camera). */
  apply(rotation: THREE.Euler): void {
    const s = this.shake
    const t = this.time * SHAKE_FREQUENCY
    rotation.x += this.offset.x + s * Math.sin(t * 1.3)
    rotation.y += this.offset.y + s * Math.sin(t * 0.9 + 1.7)
    rotation.z += this.offset.z + s * 0.6 * Math.sin(t * 1.1 + 0.4)
  }
}
