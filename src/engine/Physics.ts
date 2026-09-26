import RAPIER from '@dimforge/rapier3d-compat'

export type Vec3Tuple = readonly [number, number, number]
export interface Vec3Like {
  x: number
  y: number
  z: number
}

/** Collision group bits. A collider/query pair interacts only if each one's filter includes the other's membership. */
export const CollisionGroup = {
  WORLD: 1 << 0,
  PLAYER: 1 << 1,
  /** Solids that stop characters but not bullets, e.g. a target dummy's footprint. */
  CHARACTER_BLOCKER: 1 << 2,
  /** Damage zones (sensors). Only shot queries see them. */
  HITBOX: 1 << 3,
  /** Membership used by weapon ray queries. */
  SHOT: 1 << 4,
} as const

export const ALL_GROUPS = 0xffff

/** Packs membership and filter bits into Rapier's 32-bit InteractionGroups. */
export function interactionGroups(membership: number, filter: number): number {
  return (((membership & 0xffff) << 16) | (filter & 0xffff)) >>> 0
}

export interface RayHit {
  colliderHandle: number
  distance: number
  readonly point: Vec3Like
  readonly normal: Vec3Like
}

export function createRayHit(): RayHit {
  return {
    colliderHandle: -1,
    distance: 0,
    point: { x: 0, y: 0, z: 0 },
    normal: { x: 0, y: 0, z: 0 },
  }
}

/** Thin wrapper around the Rapier world. Create with `Physics.create()` (loads the WASM module). */
export class Physics {
  readonly world: RAPIER.World
  private readonly ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 })

  private constructor(world: RAPIER.World) {
    this.world = world
  }

  static async create(gravityY = -9.81): Promise<Physics> {
    await RAPIER.init()
    return new Physics(new RAPIER.World({ x: 0, y: gravityY, z: 0 }))
  }

  /** Adds a fixed, axis-aligned box collider. */
  addStaticBox(
    center: Vec3Tuple,
    halfExtents: Vec3Tuple,
    groups = interactionGroups(CollisionGroup.WORLD, ALL_GROUPS),
  ): RAPIER.Collider {
    const desc = RAPIER.ColliderDesc.cuboid(...halfExtents)
      .setTranslation(...center)
      .setCollisionGroups(groups)
    return this.world.createCollider(desc)
  }

  /** Adds a fixed triangle-mesh collider (world-space vertices, three indices per triangle). */
  addStaticTrimesh(
    positions: Float32Array,
    indices: Uint32Array,
    groups = interactionGroups(CollisionGroup.WORLD, ALL_GROUPS),
  ): RAPIER.Collider {
    const desc = RAPIER.ColliderDesc.trimesh(positions, indices).setCollisionGroups(groups)
    return this.world.createCollider(desc)
  }

  /**
   * Casts a ray and writes the first hit into `out`. `dir` must be normalised.
   * Returns false (leaving `out` untouched) if nothing was hit within `maxDist`.
   */
  castRay(origin: Vec3Like, dir: Vec3Like, maxDist: number, groups: number, out: RayHit): boolean {
    const { ray } = this
    ray.origin.x = origin.x
    ray.origin.y = origin.y
    ray.origin.z = origin.z
    ray.dir.x = dir.x
    ray.dir.y = dir.y
    ray.dir.z = dir.z
    const hit = this.world.castRayAndGetNormal(ray, maxDist, true, undefined, groups)
    if (!hit) return false
    const t = hit.timeOfImpact
    out.colliderHandle = hit.collider.handle
    out.distance = t
    out.point.x = origin.x + dir.x * t
    out.point.y = origin.y + dir.y * t
    out.point.z = origin.z + dir.z * t
    out.normal.x = hit.normal.x
    out.normal.y = hit.normal.y
    out.normal.z = hit.normal.z
    return true
  }

  /** Calls `visit` for every collider (in `groups`) overlapping a ball at `center`. */
  overlapBall(
    center: Vec3Like,
    radius: number,
    groups: number,
    visit: (collider: RAPIER.Collider) => void,
  ): void {
    this.world.intersectionsWithShape(
      center,
      { x: 0, y: 0, z: 0, w: 1 },
      new RAPIER.Ball(radius),
      (c) => {
        visit(c)
        return true
      },
      undefined,
      groups,
    )
  }

  step(dt: number): void {
    this.world.timestep = dt
    this.world.step()
  }

  /**
   * Makes newly added colliders visible to scene queries (raycasts, character controller).
   * Call once after building a map, before the first simulation step. Safe at load time
   * because nothing dynamic exists yet, so the step moves nothing.
   */
  syncQueries(): void {
    this.world.step()
  }

  dispose(): void {
    this.world.free()
  }
}
