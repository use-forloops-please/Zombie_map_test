export type HitZone = 'head' | 'neck' | 'torso' | 'limb'
export type TargetKind = 'dummy' | 'zombie'

export type HitboxShape =
  { kind: 'ball'; radius: number } | { kind: 'box'; half: readonly [number, number, number] }

export interface HitboxPart {
  readonly name: string
  readonly zone: HitZone
  readonly shape: HitboxShape
  /** Centre of the part relative to the owner's feet, before yaw rotation. */
  readonly offset: readonly [number, number, number]
}

/**
 * Damage zones for a 1.8 m humanoid, feet at the origin. Shared by target dummies and
 * (from milestone 3) zombies, so hits register the same way on both.
 */
export const humanoidHitboxes: readonly HitboxPart[] = [
  { name: 'head', zone: 'head', shape: { kind: 'ball', radius: 0.13 }, offset: [0, 1.63, 0] },
  {
    name: 'neck',
    zone: 'neck',
    shape: { kind: 'box', half: [0.06, 0.05, 0.06] },
    offset: [0, 1.46, 0],
  },
  {
    name: 'torso',
    zone: 'torso',
    shape: { kind: 'box', half: [0.2, 0.3, 0.12] },
    offset: [0, 1.11, 0],
  },
  {
    name: 'armL',
    zone: 'limb',
    shape: { kind: 'box', half: [0.06, 0.3, 0.06] },
    offset: [-0.27, 1.1, 0],
  },
  {
    name: 'armR',
    zone: 'limb',
    shape: { kind: 'box', half: [0.06, 0.3, 0.06] },
    offset: [0.27, 1.1, 0],
  },
  {
    name: 'legL',
    zone: 'limb',
    shape: { kind: 'box', half: [0.08, 0.4, 0.08] },
    offset: [-0.1, 0.4, 0],
  },
  {
    name: 'legR',
    zone: 'limb',
    shape: { kind: 'box', half: [0.08, 0.4, 0.08] },
    offset: [0.1, 0.4, 0],
  },
]

/**
 * Zombie layout: the humanoid layout with both arms reaching forward (-Z), matching the
 * zombie visuals, so shots at an outstretched arm register as limb hits.
 */
export const zombieHitboxes: readonly HitboxPart[] = humanoidHitboxes.map((part) => {
  if (part.name === 'armL' || part.name === 'armR') {
    const side = part.name === 'armL' ? -1 : 1
    return {
      ...part,
      shape: { kind: 'box', half: [0.06, 0.06, 0.28] },
      offset: [side * 0.25, 1.32, -0.24],
    }
  }
  return part
})

/** Anything that owns hitboxes and can take damage. */
export interface Damageable {
  readonly kind: TargetKind
  readonly alive: boolean
  readonly health: number
  /** Applies damage to the given part. Returns true if this hit killed the target. */
  applyDamage(amount: number, zone: HitZone, partIndex: number): boolean
}

export interface HitboxEntry {
  readonly owner: Damageable
  readonly zone: HitZone
  /** Index into the owner's hitbox part list. */
  readonly partIndex: number
}

/** Maps Rapier collider handles to the target and zone they belong to. */
export class HitboxRegistry {
  private readonly entries = new Map<number, HitboxEntry>()

  register(colliderHandle: number, entry: HitboxEntry): void {
    this.entries.set(colliderHandle, entry)
  }

  unregister(colliderHandle: number): void {
    this.entries.delete(colliderHandle)
  }

  get(colliderHandle: number): HitboxEntry | undefined {
    return this.entries.get(colliderHandle)
  }
}
