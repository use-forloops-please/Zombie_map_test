import * as THREE from 'three'
import type { Input } from '../../engine/Input'
import { CollisionGroup, createRayHit, interactionGroups, type Physics } from '../../engine/Physics'
import type { Rng } from '../../engine/rng'
import type { CombatTuning, PlayerTuning } from '../config/balance'
import { addViewKick, viewDirection, type Player } from '../entities/Player'
import type { HitboxEntry, HitboxRegistry, HitZone } from '../entities/hitboxes'
import type { GameEventBus } from '../events'
import { weaponDefs, type WeaponId } from '../weapons/definitions'
import {
  cancelReload,
  createWeaponState,
  damageForZone,
  isReloading,
  reloadProgress,
  spreadDirection,
  stepWeapon,
  type WeaponState,
} from '../weapons/weaponState'

/** Shots see level geometry and hitboxes; never the player or character blockers. */
const SHOT_GROUPS = interactionGroups(
  CollisionGroup.SHOT,
  CollisionGroup.WORLD | CollisionGroup.HITBOX,
)

/** What the HUD needs about the weapon in hand. */
export interface WeaponHudState {
  weaponName: string
  mag: number
  magSize: number
  reserve: number
  reloading: boolean
  reloadProgress: number
  slotNames: string[]
  activeSlot: number
}

/** The slice of Input the weapon system reads (lets tests drive it without a DOM). */
export type WeaponInput = Pick<Input, 'isDown' | 'consumePressed'>

export type DamageCause = 'bullet' | 'melee' | 'splash'

/** Melee checks straight ahead plus this far (radians) either side, so near-misses still connect. */
const MELEE_SWEEP = [0, 0.25, -0.25]
const UP = new THREE.Vector3(0, 1, 0)

/** What the viewmodel needs to pose the gun each frame. */
export interface WeaponViewState {
  weaponId: WeaponId | null
  /** 0 → 1 across a reload; 0 otherwise. */
  reload: number
  /** 1 at the start of a weapon switch → 0 when the new weapon is fully raised. */
  switching: number
  /** 1 at the start of a melee swing → 0 when recovered. */
  melee: number
}

/** Owns the player's weapon slots: switching, firing, reloading, hitscan and recoil. */
export class WeaponSystem {
  private readonly player: Player
  private readonly input: WeaponInput
  private readonly physics: Physics
  private readonly hitboxes: HitboxRegistry
  private readonly events: GameEventBus
  private readonly rng: Rng
  private readonly combat: CombatTuning
  private readonly playerTuning: PlayerTuning

  private readonly slots: WeaponState[] = []
  private active = 0
  private switchTimer = 0
  private meleeTimer = 0

  // Scratch objects, reused every shot.
  private readonly eye = new THREE.Vector3()
  private readonly aim = new THREE.Vector3()
  private readonly shotDir = new THREE.Vector3()
  private readonly hit = createRayHit()

  constructor(
    player: Player,
    input: WeaponInput,
    physics: Physics,
    hitboxes: HitboxRegistry,
    events: GameEventBus,
    rng: Rng,
    combat: CombatTuning,
    playerTuning: PlayerTuning,
  ) {
    this.player = player
    this.input = input
    this.physics = physics
    this.hitboxes = hitboxes
    this.events = events
    this.rng = rng
    this.combat = combat
    this.playerTuning = playerTuning
    for (const id of combat.startingWeapons.slice(0, combat.maxWeaponSlots)) {
      this.slots.push(createWeaponState(weaponDefs[id]))
    }
  }

  update(dt: number): void {
    const { input } = this
    this.handleSwitching(input)

    const current = this.slots[this.active]
    if (!current) return

    const fire = input.consumePressed('fire')
    const reload = input.consumePressed('reload')
    const melee = input.consumePressed('melee')
    if (this.switchTimer > 0) {
      this.switchTimer = Math.max(this.switchTimer - dt, 0)
      return
    }
    if (this.meleeTimer > 0) {
      // Mid-swing: no shooting or reloading until recovered.
      this.meleeTimer = Math.max(this.meleeTimer - dt, 0)
      return
    }
    if (melee) {
      this.meleeAttack(current)
      return
    }

    const wasReloading = isReloading(current)
    const shots = stepWeapon(current, { held: input.isDown('fire'), pressed: fire }, reload, dt)
    for (let i = 0; i < shots; i++) this.fireShot(current)

    const weaponId = current.def.id
    const reloading = isReloading(current)
    if (!wasReloading && reloading) this.events.emit('reloadStarted', { weaponId })
    if (wasReloading && !reloading) this.events.emit('reloadFinished', { weaponId })
    if (fire && shots === 0 && !reloading && current.mag === 0 && current.reserve === 0) {
      this.events.emit('dryFire', { weaponId })
    }
  }

  hudState(): WeaponHudState | null {
    const s = this.slots[this.active]
    if (!s) return null
    return {
      weaponName: s.def.name,
      mag: s.mag,
      magSize: s.def.magazineSize,
      reserve: s.reserve,
      reloading: isReloading(s),
      reloadProgress: reloadProgress(s),
      slotNames: this.slots.map((w) => w.def.name),
      activeSlot: this.active,
    }
  }

  viewState(out: WeaponViewState): WeaponViewState {
    const s = this.slots[this.active]
    out.weaponId = s ? s.def.id : null
    out.reload = s ? reloadProgress(s) : 0
    out.switching = this.combat.switchTime > 0 ? this.switchTimer / this.combat.switchTime : 0
    out.melee = this.combat.meleeCooldown > 0 ? this.meleeTimer / this.combat.meleeCooldown : 0
    return out
  }

  /**
   * Damages whatever owns `entry` and announces it. The single path for all player damage
   * (bullets, melee, debug tools), so points and stats see every hit the same way.
   */
  dealDamage(entry: HitboxEntry, damage: number, cause: DamageCause): void {
    if (!entry.owner.alive) return
    const killed = entry.owner.applyDamage(damage, entry.zone, entry.partIndex)
    this.events.emit('targetHit', {
      targetKind: entry.owner.kind,
      zone: entry.zone,
      damage,
      killed,
      healthLeft: entry.owner.health,
      cause,
    })
  }

  owns(id: WeaponId): boolean {
    return this.slots.some((s) => s.def.id === id)
  }

  /** True if the owned weapon `id` has a full magazine and reserve (or isn't owned). */
  ammoFull(id: WeaponId): boolean {
    const s = this.slots.find((w) => w.def.id === id)
    return !s || (s.mag === s.def.magazineSize && s.reserve === s.def.reserveAmmo)
  }

  /**
   * Adds weapon `id` with full ammo and raises it: into a free slot if there is one,
   * otherwise replacing the weapon in hand. Does nothing if already owned.
   */
  giveWeapon(id: WeaponId): void {
    if (this.owns(id)) return
    const state = createWeaponState(weaponDefs[id])
    if (this.slots.length < this.combat.maxWeaponSlots) {
      this.slots.push(state)
      this.switchTo(this.slots.length - 1, true)
    } else {
      this.slots[this.active] = state
      this.switchTo(this.active, true)
    }
  }

  /** Tops up magazine and reserve for an owned weapon. */
  refillAmmo(id: WeaponId): void {
    const s = this.slots.find((w) => w.def.id === id)
    if (!s) return
    s.mag = s.def.magazineSize
    s.reserve = s.def.reserveAmmo
  }

  private handleSwitching(input: WeaponInput): void {
    let target = this.active
    if (input.consumePressed('slot1')) target = 0
    if (input.consumePressed('slot2')) target = 1
    const n = this.slots.length
    if (input.consumePressed('nextWeapon')) target = (this.active + 1) % n
    if (input.consumePressed('prevWeapon')) target = (this.active - 1 + n) % n
    if (target === this.active || !this.slots[target]) return
    this.switchTo(target, false)
  }

  /** Raises slot `target`. `force` re-raises even if it's already the active slot (new weapon). */
  private switchTo(target: number, force: boolean): void {
    if (target === this.active && !force) return
    const previous = this.slots[this.active]
    if (previous && previous !== this.slots[target]) cancelReload(previous)
    this.active = target
    this.switchTimer = this.combat.switchTime
    const next = this.slots[target]
    if (next) this.events.emit('weaponSwitched', { weaponId: next.def.id })
  }

  private fireShot(weapon: WeaponState): void {
    const { player } = this
    const { def } = weapon
    this.eye.copy(player.position)
    this.eye.y += this.playerTuning.eyeHeight
    viewDirection(player, this.aim)
    const spread = THREE.MathUtils.degToRad(def.spread)

    if (def.projectile) {
      spreadDirection(this.aim, spread, this.rng, this.shotDir)
      this.events.emit('projectileFired', {
        weaponId: def.id,
        origin: [this.eye.x, this.eye.y, this.eye.z],
        direction: [this.shotDir.x, this.shotDir.y, this.shotDir.z],
      })
    } else {
      for (let pellet = 0; pellet < (def.pellets ?? 1); pellet++) {
        spreadDirection(this.aim, spread, this.rng, this.shotDir)
        this.hitscan(def.range, damageForZone.bind(null, def))
      }
    }

    const kickPitch = THREE.MathUtils.degToRad(def.recoil.pitch)
    const kickYaw = THREE.MathUtils.degToRad(def.recoil.yaw) * (this.rng() * 2 - 1)
    addViewKick(player, kickPitch, kickYaw)
    this.events.emit('weaponFired', { weaponId: def.id })
  }

  /** Damages `entry` at the current ray hit (`hit` along `shotDir`) and says where it landed. */
  private strike(entry: HitboxEntry, damage: number, cause: 'bullet' | 'melee'): void {
    if (!entry.owner.alive) return
    this.dealDamage(entry, damage, cause)
    const { point } = this.hit
    const dir = this.shotDir
    this.events.emit('targetStruck', {
      targetKind: entry.owner.kind,
      zone: entry.zone,
      killed: !entry.owner.alive,
      cause,
      point: [point.x, point.y, point.z],
      direction: [dir.x, dir.y, dir.z],
    })
  }

  /** Casts one bullet along `shotDir` from `eye`: damages a hitbox, or marks the wall. */
  private hitscan(range: number, damageFor: (zone: HitZone, t: CombatTuning) => number): void {
    if (!this.physics.castRay(this.eye, this.shotDir, range, SHOT_GROUPS, this.hit)) return
    const entry = this.hitboxes.get(this.hit.colliderHandle)
    if (entry) {
      this.strike(entry, damageFor(entry.zone, this.combat), 'bullet')
      return
    }
    const { point, normal } = this.hit
    this.events.emit('shotImpact', {
      point: [point.x, point.y, point.z],
      normal: [normal.x, normal.y, normal.z],
    })
  }

  /** A short-range swing: flat damage to the first living target in front, blocked by walls. */
  private meleeAttack(weapon: WeaponState): void {
    cancelReload(weapon)
    this.meleeTimer = this.combat.meleeCooldown
    this.events.emit('meleeSwung', {})
    this.eye.copy(this.player.position)
    this.eye.y += this.playerTuning.eyeHeight
    viewDirection(this.player, this.aim)
    for (const angle of MELEE_SWEEP) {
      this.shotDir.copy(this.aim).applyAxisAngle(UP, angle)
      if (
        !this.physics.castRay(this.eye, this.shotDir, this.combat.meleeRange, SHOT_GROUPS, this.hit)
      ) {
        continue
      }
      const entry = this.hitboxes.get(this.hit.colliderHandle)
      if (!entry?.owner.alive) continue
      this.strike(entry, this.combat.meleeDamage, 'melee')
      return
    }
  }
}
