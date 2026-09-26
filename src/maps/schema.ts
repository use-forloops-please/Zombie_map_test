import { z } from 'zod'
import { weaponIds } from '../game/weapons/definitions'
import { lightingPresetIds } from './lighting'

/*
 * Coordinate conventions for map.json:
 * - Units are metres. +Y is up.
 * - `yaw` is in degrees, rotating about +Y. yaw 0 faces -Z, yaw 90 faces -X.
 * - Brush `pos` is the box centre. Spawn `pos` is the player's feet.
 */

const vec3 = z.tuple([z.number(), z.number(), z.number()])
const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'expected a colour like "#0b0d10"')

export const brushMaterials = ['concrete', 'plaster', 'wood', 'metal', 'dirt'] as const

const boxBrushSchema = z.object({
  type: z.literal('box'),
  pos: vec3,
  size: vec3.refine((s) => s.every((n) => n > 0), 'every size component must be > 0'),
  material: z.enum(brushMaterials).default('concrete'),
  walkable: z.boolean().default(false),
})

const playerSpawnSchema = z.object({
  pos: vec3,
  yaw: z.number().default(0),
})

/** Static humanoid targets for testing weapons. `pos` is the dummy's feet. */
const targetDummySchema = z.object({
  pos: vec3,
  yaw: z.number().default(0),
})

/**
 * A boarded-up window zombies enter through. The map must leave a matching gap in its wall
 * brushes, with a sill high enough that agents can't step over it (the inside and outside
 * navmeshes must not connect). `pos` is the centre of the opening; `yaw` is the direction
 * the window faces from inside to outside; `outsideSpawn` is where its zombies appear.
 */
const windowSchema = z.object({
  id: z.string().min(1),
  /** Zone the window belongs to. Only windows in active zones spawn (milestone 6). */
  zone: z.string().min(1),
  pos: vec3,
  yaw: z.number(),
  outsideSpawn: vec3,
  boards: z.number().int().min(1).max(12).default(6),
  width: z.number().positive().default(1.2),
  height: z.number().positive().default(1.2),
})

/** An axis-aligned region of the map. Only windows in active zones spawn zombies. */
const zoneSchema = z.object({
  id: z.string().min(1),
  bounds: z.object({ min: vec3, max: vec3 }),
  activeAtStart: z.boolean().default(false),
})

/**
 * A buyable blocker (debris, a locked door). `pos`/`size` are an axis-aligned box like a
 * brush. Buying it removes it and activates both zones it connects.
 */
const doorSchema = z.object({
  id: z.string().min(1),
  cost: z.number().int().nonnegative(),
  pos: vec3,
  size: vec3.refine((s) => s.every((n) => n > 0), 'every size component must be > 0'),
  connects: z.tuple([z.string().min(1), z.string().min(1)]),
})

/**
 * A weapon for sale on a wall. `pos` is the centre of the sign; `yaw` is the direction the
 * sign faces (toward the player). Prices default to the weapon's in definitions.ts.
 */
const wallBuySchema = z.object({
  weapon: z.enum(weaponIds),
  pos: vec3,
  yaw: z.number(),
  cost: z.number().int().nonnegative().optional(),
  ammoCost: z.number().int().nonnegative().optional(),
})

/**
 * A place the supply crate can sit. `pos` is the floor under its centre; `yaw` is the
 * direction its front faces. With `zone`, it's only used once that zone is active.
 */
const crateSpotSchema = z.object({
  id: z.string().min(1),
  pos: vec3,
  yaw: z.number().default(0),
  zone: z.string().min(1).optional(),
  startsHere: z.boolean().default(false),
})

/** A point light (no shadows) with a small glowing bulb, e.g. a hanging work lamp. */
const lampSchema = z.object({
  pos: vec3,
  color: hexColor.default('#ffc98a'),
  /** Candela, as three.js point lights; 4–10 suits a room. */
  intensity: z.number().positive().default(6),
  /** Metres at which the light fades to nothing. */
  range: z.number().positive().default(8),
})

/** Point lights cost every lit pixel; keep maps within a mid-range laptop's budget. */
export const MAX_LAMPS = 6

const lightingSchema = z.object({
  preset: z.enum(lightingPresetIds),
  lamps: z.array(lampSchema).max(MAX_LAMPS, `at most ${MAX_LAMPS} lamps`).default([]),
  fog: z
    .object({
      color: hexColor,
      near: z.number().nonnegative(),
      far: z.number().positive(),
    })
    .refine((f) => f.far > f.near, 'fog.far must be greater than fog.near')
    .optional(),
})

export const mapSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/, 'use lowercase letters, digits and dashes'),
    name: z.string().min(1),
    version: z.literal(1),
    /** Optional art file in the map's folder (a Blender export); see docs/MAPPING.md. */
    art: z
      .string()
      .regex(/^[\w-]+\.glb$/, 'expected a .glb file name in the map folder, like "level.glb"')
      .optional(),
    brushes: z.array(boxBrushSchema).default([]),
    playerSpawns: z.array(playerSpawnSchema).min(1),
    targetDummies: z.array(targetDummySchema).default([]),
    zones: z.array(zoneSchema).default([]),
    windows: z.array(windowSchema).default([]),
    doors: z.array(doorSchema).default([]),
    wallBuys: z.array(wallBuySchema).default([]),
    crateSpots: z.array(crateSpotSchema).default([]),
    lighting: lightingSchema.default({ preset: 'night-dim', lamps: [] }),
  })
  .superRefine((map, ctx) => {
    const issue = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: 'custom', path, message })

    if (map.brushes.length === 0 && !map.art) {
      issue(['brushes'], 'a map needs at least one brush, or "art" with collide meshes')
    }

    const unique = (items: readonly { id: string }[], key: string, what: string) => {
      const seen = new Set<string>()
      items.forEach((item, i) => {
        if (seen.has(item.id)) issue([key, i, 'id'], `duplicate ${what} id "${item.id}"`)
        seen.add(item.id)
      })
    }
    unique(map.zones, 'zones', 'zone')
    unique(map.windows, 'windows', 'window')
    unique(map.doors, 'doors', 'door')
    unique(map.crateSpots, 'crateSpots', 'crate spot')
    if (map.crateSpots.filter((s) => s.startsHere).length > 1) {
      issue(['crateSpots'], 'only one crate spot can have "startsHere": true')
    }

    const zoneIds = new Set(map.zones.map((z) => z.id))
    if (map.zones.length > 0 && !map.zones.some((z) => z.activeAtStart)) {
      issue(['zones'], 'at least one zone needs "activeAtStart": true')
    }
    map.windows.forEach((w, i) => {
      if (!zoneIds.has(w.zone)) issue(['windows', i, 'zone'], `unknown zone "${w.zone}"`)
    })
    map.crateSpots.forEach((s, i) => {
      if (s.zone !== undefined && !zoneIds.has(s.zone)) {
        issue(['crateSpots', i, 'zone'], `unknown zone "${s.zone}"`)
      }
    })
    map.doors.forEach((d, i) => {
      d.connects.forEach((zone, j) => {
        if (!zoneIds.has(zone)) issue(['doors', i, 'connects', j], `unknown zone "${zone}"`)
      })
      if (d.connects[0] === d.connects[1]) {
        issue(['doors', i, 'connects'], 'a door must connect two different zones')
      }
    })
  })

export type MapDef = z.output<typeof mapSchema>
export type BrushDef = MapDef['brushes'][number]
export type BrushMaterial = (typeof brushMaterials)[number]
export type LightingDef = MapDef['lighting']
export type WindowDef = MapDef['windows'][number]
export type ZoneDef = MapDef['zones'][number]
export type DoorDef = MapDef['doors'][number]
export type WallBuyDef = MapDef['wallBuys'][number]
export type CrateSpotDef = MapDef['crateSpots'][number]

/** Supply crate footprint: width (across its front) × height × depth, metres. */
export const CRATE_SIZE = [1.2, 0.9, 0.7] as const

/** A crate spot as a navmesh obstacle / brush (every spot is always an obstacle). */
export function crateSpotAsBrush(s: CrateSpotDef): BrushDef {
  const [w, h, d] = CRATE_SIZE
  // Spots are expected to sit square to the walls; 90°/270° swap width and depth.
  const sideways = Math.abs(Math.sin((s.yaw * Math.PI) / 180)) > 0.5
  return {
    type: 'box',
    pos: [s.pos[0], s.pos[1] + h / 2, s.pos[2]],
    size: sideways ? [d, h, w] : [w, h, d],
    material: 'wood',
    walkable: false,
  }
}

/** A closed door as a navmesh obstacle / brush. */
export function doorAsBrush(d: DoorDef): BrushDef {
  return { type: 'box', pos: d.pos, size: d.size, material: 'wood', walkable: false }
}

/** One validation problem, with the path to the offending value (e.g. `windows[2].zone`). */
export interface MapIssue {
  path: readonly PropertyKey[]
  message: string
}

/** Like `parseMap`, but keeps each problem's path so an editor can point at the culprit. */
export function checkMap(
  json: unknown,
): { ok: true; map: MapDef } | { ok: false; issues: MapIssue[] } {
  const result = mapSchema.safeParse(json)
  if (result.success) return { ok: true, map: result.data }
  return {
    ok: false,
    issues: result.error.issues.map((i) => ({ path: i.path, message: i.message })),
  }
}

export type ParseMapResult = { ok: true; map: MapDef } | { ok: false; error: string }

/** Validates raw JSON against the map schema. Never throws. */
export function parseMap(json: unknown): ParseMapResult {
  const result = mapSchema.safeParse(json)
  if (result.success) return { ok: true, map: result.data }
  return { ok: false, error: z.prettifyError(result.error) }
}
