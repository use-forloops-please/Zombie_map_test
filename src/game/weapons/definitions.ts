import type { SoundId } from '../audio/sounds'

/**
 * Data-only weapon table. Every weapon stat lives here; systems never hard-code them.
 * Names and designs are original to this project.
 */

export const weaponIds = [
  'pistol_service',
  'rifle_carbine',
  'smg_compact',
  'shotgun_pump',
  'rifle_bolt',
  'pulse_caster',
] as const
export type WeaponId = (typeof weaponIds)[number]

export type FireMode = 'semi' | 'auto'

export interface WeaponDef {
  id: WeaponId
  name: string
  /**
   * Hitscan: damage per bullet (per pellet) to the torso; other zones scale from this.
   * Projectile weapons use `projectile.splashDamage` instead.
   */
  damage: number
  headshotMultiplier: number
  fireMode: FireMode
  /** Rounds per minute (maximum rate for semi-auto). */
  rpm: number
  magazineSize: number
  /** Maximum spare rounds carried outside the magazine. */
  reserveAmmo: number
  /** Seconds. */
  reloadTime: number
  /** Hip-fire cone half-angle, degrees. */
  spread: number
  /** Hitscan rays per shot, each with its own spread (shotguns). Default 1. */
  pellets?: number
  recoil: {
    /** Upward view kick per shot, degrees. */
    pitch: number
    /** Maximum random sideways kick per shot, degrees. */
    yaw: number
  }
  /** Maximum hitscan distance, metres. */
  range: number
  /** Fires a travelling projectile that explodes, instead of hitscan. */
  projectile?: {
    /** Metres per second. */
    speed: number
    /** Seconds before it detonates in mid-air. */
    lifetime: number
    splashRadius: number
    /** Dealt to every target in the radius. */
    splashDamage: number
    /** Colour of the projectile and its blast. */
    color: string
  }
  /** Default wall-buy price (a map can override it per wall-buy). */
  wallBuyCost: number
  /** Default price to refill ammo at a wall-buy for a weapon already owned. */
  ammoCost: number
  /** Played (in the player's head) for every shot. */
  fireSound: SoundId
  /** Placeholder box-gun viewmodel, until real models land. */
  viewmodel: {
    /** Body length × height × width, metres. */
    size: readonly [number, number, number]
    color: string
    /** Optional emissive colour (the experimental weapon glows). */
    glow?: string
    /** How hard the gun jolts back in the hands per shot (1 = pistol). */
    kick: number
    /** Muzzle flash size (metres) and colour. */
    flash: { size: number; color: string }
  }
}

const defs = {
  pistol_service: {
    id: 'pistol_service',
    name: 'Warden P9',
    damage: 40,
    headshotMultiplier: 2.5,
    fireMode: 'semi',
    rpm: 400,
    magazineSize: 10,
    reserveAmmo: 60,
    reloadTime: 1.6,
    spread: 0.8,
    recoil: { pitch: 1.2, yaw: 0.4 },
    range: 80,
    wallBuyCost: 500,
    ammoCost: 250,
    fireSound: 'shot_pistol',
    viewmodel: {
      size: [0.2, 0.09, 0.05],
      color: '#2b2d31',
      kick: 1,
      flash: { size: 0.12, color: '#ffc46b' },
    },
  },
  rifle_carbine: {
    id: 'rifle_carbine',
    name: 'Harrow AC-7',
    damage: 55,
    headshotMultiplier: 2.5,
    fireMode: 'auto',
    rpm: 650,
    magazineSize: 30,
    reserveAmmo: 180,
    reloadTime: 2.4,
    spread: 1.6,
    recoil: { pitch: 0.7, yaw: 0.5 },
    range: 120,
    wallBuyCost: 1200,
    ammoCost: 600,
    fireSound: 'shot_carbine',
    viewmodel: {
      size: [0.55, 0.1, 0.06],
      color: '#3a3328',
      kick: 0.8,
      flash: { size: 0.16, color: '#ffc46b' },
    },
  },
  smg_compact: {
    id: 'smg_compact',
    name: 'Kestrel SMG-9',
    damage: 34,
    headshotMultiplier: 2,
    fireMode: 'auto',
    rpm: 850,
    magazineSize: 32,
    reserveAmmo: 192,
    reloadTime: 2,
    spread: 2.2,
    recoil: { pitch: 0.5, yaw: 0.6 },
    range: 60,
    wallBuyCost: 1000,
    ammoCost: 500,
    fireSound: 'shot_smg',
    viewmodel: {
      size: [0.36, 0.1, 0.06],
      color: '#2e3a33',
      kick: 0.6,
      flash: { size: 0.13, color: '#ffcf80' },
    },
  },
  shotgun_pump: {
    id: 'shotgun_pump',
    name: 'Tallow 12 Pump',
    damage: 30,
    headshotMultiplier: 1.5,
    fireMode: 'semi',
    rpm: 70,
    magazineSize: 6,
    reserveAmmo: 42,
    reloadTime: 2.8,
    spread: 5,
    pellets: 8,
    recoil: { pitch: 4, yaw: 1 },
    range: 25,
    wallBuyCost: 1500,
    ammoCost: 750,
    fireSound: 'shot_shotgun',
    viewmodel: {
      size: [0.62, 0.11, 0.07],
      color: '#4a3524',
      kick: 2.2,
      flash: { size: 0.24, color: '#ffb55c' },
    },
  },
  rifle_bolt: {
    id: 'rifle_bolt',
    name: 'Ostler Mk2',
    damage: 220,
    headshotMultiplier: 3,
    fireMode: 'semi',
    rpm: 50,
    magazineSize: 5,
    reserveAmmo: 40,
    reloadTime: 3.2,
    spread: 0.2,
    recoil: { pitch: 3, yaw: 0.5 },
    range: 150,
    wallBuyCost: 1400,
    ammoCost: 700,
    fireSound: 'shot_bolt',
    viewmodel: {
      size: [0.72, 0.09, 0.05],
      color: '#3d3226',
      kick: 2,
      flash: { size: 0.2, color: '#ffc46b' },
    },
  },
  pulse_caster: {
    id: 'pulse_caster',
    name: 'Halcyon Pulse Caster',
    damage: 1200,
    headshotMultiplier: 1,
    fireMode: 'semi',
    rpm: 100,
    magazineSize: 4,
    reserveAmmo: 24,
    reloadTime: 3,
    spread: 0.3,
    recoil: { pitch: 2.5, yaw: 0.8 },
    range: 120,
    projectile: {
      speed: 38,
      lifetime: 3,
      splashRadius: 2.5,
      splashDamage: 1200,
      color: '#7fe8ff',
    },
    // Crate-only in practice; priced high in case a map puts it on a wall.
    wallBuyCost: 6000,
    ammoCost: 3000,
    fireSound: 'shot_pulse',
    viewmodel: {
      size: [0.42, 0.13, 0.09],
      color: '#2a2f45',
      glow: '#3fc4ff',
      kick: 1.4,
      flash: { size: 0.2, color: '#7fe8ff' },
    },
  },
} as const satisfies { [K in WeaponId]: WeaponDef & { id: K } }

export const weaponDefs: Readonly<Record<WeaponId, WeaponDef>> = defs

export function isWeaponId(id: string): id is WeaponId {
  return Object.hasOwn(weaponDefs, id)
}
