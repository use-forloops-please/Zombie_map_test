# Making maps for Project Holdout

A map is a folder in `public/maps/<map-id>/`:

| File        | Required | What it is                                                                                    |
| ----------- | -------- | --------------------------------------------------------------------------------------------- |
| `map.json`  | yes      | The map's definition: geometry (brushes), entities and lighting.                              |
| `level.glb` | no       | Art exported from Blender. It can also supply collision, the navmesh and entity placeholders. |

You can build a whole map in `map.json` with no 3D tool (the **greybox route**), most easily
with the **in-browser editor**, build it in Blender (the **Blender route**), or mix the two. Either way the game validates the map on
load and shows any problem on screen, naming the entity or Blender object at fault.

Play a map with `?map=<map-id>`, for example `http://localhost:5173/?map=bunker-01-art`.
Add `&debug=nav` to see the navmesh zombies walk on, and `&lighting=<preset>` to try a
lighting preset.

## Units and axes

- Units are **metres**.
- In the game and in `map.json`, **+Y is up**. A **yaw** is in degrees about the up axis:
  `0` faces −Z, `90` faces −X, `180` faces +Z.
- Blender is Z-up. The glTF exporter converts: a Blender location `(x, y, z)` becomes game
  `(x, z, −y)`, and a rotation about Blender's Z axis becomes the same yaw in the game.

| In Blender                    | In the game / map.json   |
| ----------------------------- | ------------------------ |
| Location `(x, y, z)`          | `pos: [x, z, −y]`        |
| Rotation Z = `r`°             | `yaw: r`                 |
| An empty's green **+Y** arrow | The way it faces         |
| Scale `(sx, sy, sz)` of a box | Half-size `[sx, sz, sy]` |

## The in-browser editor

Open `http://localhost:5173/?editor` for a new map, or `?editor=<map-id>` to open an existing one.
The editor writes `map.json`; it doesn't touch `level.glb`.

- **Add** items from the left panel. Each lands where the camera is looking. The list below
  it shows everything in the map; click an entry to select it (handy for things inside walls).
- **Select** by clicking in the 3D view. Orbit with the left mouse, pan with the right, zoom
  with the wheel.
- **Gizmo:** **W** moves, **E** turns (anything that faces a direction), **R** resizes
  (brushes, zones and doors). **G** toggles snapping to 0.25 m and 15°. A window's zombie
  spawn point is its own handle: click the sphere at the end of its line.
- **Properties** on the right set everything else: ids, materials, zones, costs, weapons and
  exact numbers. Renaming a zone updates every window, door and crate spot that uses it.
- **Undo / redo** with Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z. **Ctrl/Cmd+D** duplicates, **Delete**
  removes, **F** focuses the camera on the selection.
- The bar along the bottom lists **problems** as you work; click one to select the item it's
  about. **Check navmesh** runs the game's own window and navmesh checks, and **Show
  navmesh** draws the result.
- **Play test** opens the map in the game in a new tab, straight from the editor.
- **Download map.json** saves the file; put it in `public/maps/<map-id>/`, where
  `<map-id>` is the map's Id. **Copy JSON** puts it on the clipboard instead.

The file comes out in the same layout as the hand-written maps. Opening a map and exporting it
without changes gives back the same file byte for byte.

## The greybox route (`map.json`)

`map.json` is checked against [`src/maps/schema.ts`](../src/maps/schema.ts), which documents
every field. The top-level keys:

| Key                     | What it holds                                                                                                                                                                                                                      |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`, `name`, `version` | `id` must match the folder name. `version` is `1`.                                                                                                                                                                                 |
| `art`                   | Optional: the Blender export's file name in this folder, like `"level.glb"`.                                                                                                                                                       |
| `brushes`               | Boxes: `pos` (centre), `size`, `material` (`concrete`, `plaster`, `wood`, `metal`, `dirt`), optional `texture` (see below) and `walkable`. Every brush is solid. Only `walkable` brushes can be stood on (floors, crates, stairs). |
| `playerSpawns`          | Where the player starts: `pos` (feet) and `yaw`.                                                                                                                                                                                   |
| `zones`                 | Axis-aligned areas (`bounds.min`/`max`). At least one needs `activeAtStart: true`.                                                                                                                                                 |
| `windows`               | Boarded windows zombies enter through: `id`, `zone`, `pos` (centre of the opening), `yaw` (facing outside), `outsideSpawn`, and optionally `boards`, `width`, `height`.                                                            |
| `doors`                 | Buyable blockers: `id`, `cost`, `pos`, `size`, and `connects` (two zone ids).                                                                                                                                                      |
| `wallBuys`              | `weapon`, `pos`, `yaw` (the way the sign faces), and optionally `cost` and `ammoCost`.                                                                                                                                             |
| `crateSpots`            | Where the supply crate can sit: `id`, `pos` (floor under its centre), `yaw` (its front), and optionally `zone` and `startsHere`.                                                                                                   |
| `targetDummies`         | Practice targets: `pos` and `yaw`.                                                                                                                                                                                                 |
| `lighting`              | `preset` (`night-dim`, `bunker-amber`, `overcast-dusk`, `blackout`), optional `fog` (`color`, `near`, `far`), and up to 6 `lamps` (`pos`, `color`, `intensity`, `range`).                                                          |

### Brush textures

Each material has a default texture, and a brush can name a different one with `texture`
(the editor's **Texture** picker). Textures tile at their real-world size, however big the
brush is:

| `texture`        | Looks like          | Tile size | Default for |
| ---------------- | ------------------- | --------- | ----------- |
| `concrete-wall`  | Stained concrete    | 3 m       | `concrete`  |
| `concrete-floor` | Worn concrete floor | 3 m       |             |
| `dirty-concrete` | Dirty concrete      | 3 m       |             |
| `plaster`        | Beige plaster       | 3 m       | `plaster`   |
| `wood-planks`    | Weathered planks    | 1.8 m     | `wood`      |
| `rusty-metal`    | Rusty metal         | 1 m       | `metal`     |
| `dirt`           | Dirt ground         | 2 m       | `dirt`      |
| `red-brick`      | Red brick           | 1 m       |             |

A map downloads only the textures it uses. To add a texture, put `color.jpg`, `normal.jpg`
(OpenGL style) and `rough.jpg` in `public/assets/textures/<id>/`, add it to
[`src/maps/textures.ts`](../src/maps/textures.ts) with its real-world size, and log it in
[`ASSETS.md`](../ASSETS.md).

A window needs a real gap in the wall brushes, with a sill high enough that zombies can't
step over it. The loader checks that the only way in is climbing through, and says which
window is wrong if not. [`public/maps/bunker-01/map.json`](../public/maps/bunker-01/map.json)
is a complete example.

### Upper floors

[`public/maps/test-1/map.json`](../public/maps/test-1/map.json) adds a second storey to
bunker-01. The rules that matter:

- **Floors and stairs are `walkable` brushes.** Keep each step's rise at 0.35 m or less,
  the most the player climbs without jumping.
- **Put a buyable door at the top of the stairs**, and give each upper room its own zone, so
  zombies and players can't go upstairs until it's opened. Wall off the sides of the stairs
  so a player can't step off them around the door.
- **An upper window needs a ledge outside it:** a `walkable` brush at floor height, with
  `outsideSpawn` on it. Zombies appear on the ledge, so it doesn't have to connect to the
  ground.
- **Doors, windows and wall-buys can be stacked on different floors.** The player can only use
  things from 0.5 m below their feet to 2.5 m above them.

## The Blender route (`level.glb`)

Everything in the greybox route can come from Blender instead: meshes for the geometry,
and **empties** for the entities. Information the game needs goes in **custom properties**
(Object Properties → Custom Properties), which the exporter writes as glTF `extras`.

### Meshes

Every mesh in the file is drawn. Three custom properties control what else it does:

| Property  | Value  | Effect                                                                                        |
| --------- | ------ | --------------------------------------------------------------------------------------------- |
| `collide` | `true` | Solid to the player, zombies and bullets, and an obstacle for zombie pathfinding.             |
| `nav`     | `true` | Ground zombies can walk on. Give floors, stairs and walkable crates both `collide` and `nav`. |
| `hidden`  | `true` | Not drawn. Use it for invisible blockers or simplified collision shapes.                      |

A mesh with neither `collide` nor `nav` is decoration only; you and the zombies pass
through it. Like a non-walkable brush, a `collide`-only mesh has no walkable top, so zombies
never path along the top of a wall. Put the properties on the **object**, not the mesh
data. On an object with several materials, the property covers all of its parts.

Keep collision meshes simple: fine detail costs physics and navmesh time for no gain. A
common pattern is a detailed visible mesh with no properties, plus a simple box with
`collide`, `nav` and `hidden`.

### Empties (entity placeholders)

Name an empty `<kind>_<id>`. Blender's `.001`-style suffixes on duplicates are ignored, so
give every entity a unique id. Its location, rotation and scale set the entity's placement.
Its custom properties set the rest.

| Name            | Empty type (suggested) | Placement                                                | Custom properties                                               |
| --------------- | ---------------------- | -------------------------------------------------------- | --------------------------------------------------------------- |
| `spawn_<any>`   | Arrows                 | Player's feet; +Y is the way they face                   | none                                                            |
| `zone_<id>`     | Cube, display size 1   | The cube is the zone: scale it to fit                    | `activeAtStart` (bool)                                          |
| `window_<id>`   | Arrows                 | Centre of the opening; +Y points **outside**             | `zone` (required), `boards`, `width`, `height`                  |
| `outside_<id>`  | Sphere                 | Where zombies for window `<id>` spawn, out on the ground | none                                                            |
| `door_<id>`     | Cube, display size 1   | The cube is the door: scale it to fit, don't rotate it   | `cost` (required), `connects` (required, like `"start,hall"`)   |
| `wallbuy_<any>` | Arrows                 | On the wall; +Y is the way the sign faces                | `weapon` (required, like `"rifle_carbine"`), `cost`, `ammoCost` |
| `crate_<id>`    | Arrows                 | Floor under the crate's centre; +Y is its front          | `zone`, `startsHere` (bool)                                     |
| `dummy_<any>`   | Arrows                 | Target's feet; +Y is the way it faces                    | none                                                            |
| `lamp_<any>`    | Sphere                 | Where the light hangs                                    | `color` (like `"#ffc98a"`), `intensity`, `range`                |

Weapon ids are listed in [`src/game/weapons/definitions.ts`](../src/game/weapons/definitions.ts).
Cube empties must keep the default **display size of 1**: the game reads the box from the
empty's scale, and the display size isn't exported.

The game orders entities by name. Window order matters to spawning, so naming decides
which window a given random roll picks. Rename to reorder.

### When map.json and level.glb disagree

`map.json` wins:

- An entity in `map.json` with the same `id` as a Blender empty (a zone, window, door or
  crate spot) **replaces it completely**. Any problems with that empty are then ignored.
- If `map.json` has a non-empty `playerSpawns`, `wallBuys`, `targetDummies` or
  `lighting.lamps` list, it **replaces** the Blender list of that kind. Otherwise the
  Blender one is used.
- `brushes` in `map.json` are added alongside the Blender meshes.
- Lighting preset and fog always come from `map.json`.

A Blender map needs only a small `map.json`:

```json
{
  "id": "my-map",
  "name": "My Map",
  "version": 1,
  "art": "level.glb",
  "lighting": { "preset": "bunker-amber" }
}
```

### Exporting

File → Export → glTF 2.0, then:

- **Format:** glTF Binary (`.glb`), saved as `public/maps/<map-id>/level.glb`
- **Include → Custom Properties:** on (without this, the game sees no properties)
- **Transform → +Y Up:** on (the default)
- Cameras and punctual lights can be left out; use `lamp_` empties for lights.

Materials and textures export as usual and are drawn with the game's lighting.

### Example: the bunker-01 twin

[`public/maps/bunker-01-art/`](../public/maps/bunker-01-art/) is `bunker-01` rebuilt in
Blender: every brush is a mesh and every entity an empty. It was authored by the script
[`tools/blender/build_twin.py`](../tools/blender/build_twin.py), which is a useful
reference for the conventions. It can turn any JSON map into a Blender map to start from:

```sh
blender -b --factory-startup -P tools/blender/build_twin.py -- \
  public/maps/bunker-01/map.json public/maps/bunker-01-art/level.glb bunker-01.blend
```

The third argument is optional and saves the `.blend` for editing by hand.
[`src/maps/twin.test.ts`](../src/maps/twin.test.ts) checks that the twin plays identically
to the original: the same entities, collision, navmesh and a scripted session.

## When a map won't load

The error screen names the problem. The common ones:

| Message says                                  | Fix                                                                                  |
| --------------------------------------------- | ------------------------------------------------------------------------------------ |
| `window "w1": needs a "zone" property`        | Add the `zone` custom property to `window_w1`.                                       |
| `has no "outside_w1" empty`                   | Add an empty named `outside_w1` where its zombies should spawn.                      |
| `the ground inside and outside are connected` | The window's sill is too low or the wall has a gap: zombies could walk in.           |
| `no walkable ground outside the opening`      | Nothing with `nav` (or a `walkable` brush) under the window's outside.               |
| `has no meshes with "collide" set`            | Custom Properties weren't exported, or no mesh has `collide`.                        |
| `unknown zone "hall"`                         | A window, door or crate names a zone that no `zone_` empty or `zones` entry defines. |
