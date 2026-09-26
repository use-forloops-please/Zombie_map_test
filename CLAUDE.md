# CLAUDE.md — Project Holdout (working title)

A browser-based, first-person, round-survival zombies game in the spirit of classic 2008-era "survive the night in a boarded-up bunker" modes. It has one tight gameplay loop and a data-driven map format, so custom maps are a first-class feature.

## Ground rules (read first)

- **Original content only.** Do not use, reference or recreate assets, level layouts, names, sounds or logos from Call of Duty or any other commercial game. That includes map names, wonder-weapon names, perk names, jingles, and ripped or ported models and textures. The gameplay _mechanics_ (rounds, barricades, points, buyable doors, a random weapon crate) are fair game; the _expression_ is ours.
- Use only assets with licenses that allow redistribution in a web build (see **Assets**). Record every third-party asset in `ASSETS.md` with its source URL and license.
- **Work one milestone at a time.** Finish the milestone, run the verification steps listed for it, and stop for review before starting the next one. Don't scaffold future milestones early.
- When editing existing code, match the conventions already in the file or module. Don't introduce new patterns or libraries without flagging it first.
- When showing changes to a method or function, show the complete updated body, not a partial diff.

## Tech stack

| Concern             | Choice                                            | Notes                                                                                           |
| ------------------- | ------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Language            | TypeScript (strict)                               | `noUncheckedIndexedAccess` on                                                                   |
| Build               | Vite                                              | `npm run dev`, `npm run build`, `npm run preview`                                               |
| Rendering           | three.js (plain, imperative)                      | The game world is **not** React. Keep the render loop outside React for performance.            |
| UI / HUD / menus    | React 18                                          | Overlays the canvas. It reads game state through a small store and never drives the simulation. |
| UI state bridge     | zustand                                           | The game writes snapshots and React subscribes. Throttle writes to about 10 Hz for the HUD.     |
| Physics / collision | @dimforge/rapier3d-compat                         | Kinematic character controller for the player; static colliders for the world                   |
| Pathfinding         | recast-navigation-js (`@recast-navigation/three`) | Navmesh built at map load from walkable geometry                                                |
| Audio               | three.js `PositionalAudio` + WebAudio             | One shared `AudioListener` on the camera                                                        |
| Validation          | zod                                               | All map files are validated on load                                                             |
| Tests               | Vitest                                            | Pure game logic is unit-tested, with no DOM or WebGL                                            |

Target: WebGL2, desktop Chrome, Firefox or Edge, keyboard and mouse, pointer lock. Mobile and gamepad are out of scope for v1. Single-player only for v1; keep systems deterministic enough that co-op could be added later.

## Architecture

```
src/
  main.tsx                 # boots React UI + Game instance
  engine/
    Game.ts                # owns renderer, scene, loop, systems; start/stop/dispose
    Loop.ts                # fixed-step simulation (60 Hz) + interpolated render
    Input.ts               # pointer lock, key/mouse state, rebindable actions
    Physics.ts             # Rapier world wrapper
    Audio.ts               # listener, sound bank, positional one-shots
    Assets.ts              # glTF/texture/audio loading + caching
  game/
    config/balance.ts      # ALL tunable numbers live here
    systems/
      RoundSystem.ts
      PointsSystem.ts
      SpawnSystem.ts
      ZombieAISystem.ts
      BarricadeSystem.ts
      WeaponSystem.ts
      InteractSystem.ts    # "hold F to ..." prompts: doors, wall-buys, crate, repair
      DoorSystem.ts
      CrateSystem.ts
      PlayerHealthSystem.ts
    entities/              # Player, Zombie, Window, Door, WallBuy, Crate
    weapons/definitions.ts # data-only weapon table
  maps/
    schema.ts              # zod schema for map.json
    MapLoader.ts           # builds scene, colliders, navmesh, entities from a map
    brushes.ts             # primitive "brush" geometry for greyboxing
  ui/
    Hud.tsx, Menus.tsx, store.ts
public/
  maps/<mapId>/map.json    # required
  maps/<mapId>/level.glb   # optional art pass
  assets/...               # models, textures, sounds (licensed, logged in ASSETS.md)
```

Systems are plain classes with `update(dt: number)`. Entities are plain objects or classes, with no ECS library. Systems talk through a small typed event bus (`events.ts`), for example `zombieKilled`, `roundStarted`, `pointsChanged`, `doorOpened`. Do not reach into another system's internals.

## Core gameplay spec

Every number below is a **default** that lives in `balance.ts`.

**Rounds.** Round 1 starts after a short intro delay. A round ends when every zombie for that round has been killed. There is a pause of about 10 seconds between rounds with an audio sting. The total zombie count starts around 6, ramps to about 24 by round 5, then grows roughly linearly with round number. At most 24 zombies are alive at once; the rest queue. Zombie health is 150 in round 1 and +100 per round through round 9, then ×1.1 per round after that. Movement speed shifts toward more runners as rounds progress, using a per-zombie random roll against a round-based threshold.

**Points.** 10 per bullet hit, 50 per body kill, 60 per neck kill, 100 per headshot kill, 130 per melee kill, 10 per barricade board repaired (capped per round to stop farming). The player starts with 500.

**Barricades and windows.** Each window has 6 boards. A zombie spawns _outside_ a window, walks to it, tears boards off one at a time on a timer, then climbs through onto the navmesh. The player holds the interact key near a window to repair one board per interval.

**Zones and doors.** The map is split into zones. Doors are debris or blockers with a cost. Opening one plays an animation, removes its collider, rebuilds or joins the navmesh region, and activates the spawn windows belonging to the newly connected zone. Spawns only use windows in zones that are active.

**Weapons.** Everything is data-driven in `definitions.ts`: damage, headshot multiplier, fire mode, RPM, magazine size, reserve ammo, reload time, spread, and recoil. Hit detection uses hitscan raycasts against zombie hitboxes (head, neck, torso, limbs). The player starts with a pistol. Wall-buys sell a weapon at a price, and ammo is refilled for a lower price if the player already owns it. The player can hold 2 weapons plus a melee attack.

**Supply crate.** This is our random-weapon box. It costs 950. Spinning it plays a short cycle animation, then offers a weighted-random weapon from a pool that includes one rare original "experimental" weapon we design ourselves (an energy projectile with splash damage). The crate relocates between predefined spots after a random number of uses (not before 4, more likely after 8).

**Player health.** Health regenerates after a delay out of combat. A zombie hit deals a fixed amount of damage. Two quick hits down the player. In single-player a down means game over. The game-over screen shows the round reached, kills and headshots.

**Zombie AI.** States: `spawning` → `approachWindow` → `tearingBoards` → `entering` → `chasing` → `attacking`. Pathfinding runs on the navmesh with the path recomputed at most every 0.25 s per zombie, staggered across zombies. Add simple separation steering so zombies don't stack.

## Map format (custom maps)

Maps must be buildable **without** a 3D tool (greybox via brushes) and **optionally** skinned with a Blender-exported `level.glb`.

`map.json` (validated by `schema.ts`):

```jsonc
{
  "id": "bunker-01",
  "name": "Bunker 01",
  "version": 1,
  "art": "level.glb", // optional
  "brushes": [
    // greybox geometry; each becomes mesh + collider
    {
      "type": "box",
      "pos": [0, 1.5, 0],
      "size": [10, 3, 0.3],
      "material": "concrete",
      "walkable": false,
    },
  ],
  "zones": [
    { "id": "start", "bounds": { "min": [-5, 0, -5], "max": [5, 3, 5] }, "activeAtStart": true },
  ],
  "playerSpawns": [{ "pos": [0, 0, 0], "yaw": 0 }],
  "windows": [
    {
      "id": "w1",
      "zone": "start",
      "pos": [0, 1, 5],
      "yaw": 180,
      "outsideSpawn": [0, 0, 8],
      "boards": 6,
    },
  ],
  "doors": [
    {
      "id": "d1",
      "cost": 1000,
      "pos": [5, 1.5, 0],
      "size": [0.3, 3, 2],
      "connects": ["start", "hall"],
    },
  ],
  "wallBuys": [{ "weapon": "rifle_bolt", "pos": [-4.8, 1.5, 2], "yaw": 90 }],
  "crateSpots": [{ "id": "c1", "pos": [3, 0, -4], "yaw": 0, "startsHere": true }],
  "lighting": { "preset": "night-dim", "fog": { "color": "#0b0d10", "near": 5, "far": 40 } },
}
```

**Blender route.** If `art` is set, entity placeholders may instead come from glTF empties that carry custom properties (exported as glTF `extras`), for example an empty named `window_w1` with `{ "zone": "start", "boards": 6 }`. Meshes with the custom property `nav: true` feed the navmesh, and meshes with `collide: true` get trimesh colliders. The JSON wins on conflicts. Document this convention in `docs/MAPPING.md` once milestone 9 lands.

Loading a map must: validate → build brushes and art → build colliders → build the navmesh → instantiate entities → report errors in an on-screen overlay (never fail silently).

## Assets

Allowed sources (check each item's license and log it in `ASSETS.md`):

- Quaternius and Kenney: CC0 characters (including zombies with animations), props and weapons
- Poly Haven: CC0 textures and HDRIs
- Freesound: CC0 or CC-BY only; CC-BY needs attribution in `ASSETS.md` and the credits screen
- Mixamo animations: allowed inside the built game, but never commit the raw downloaded files as a redistributable pack

Until real assets land, use capsule zombies and box-gun viewmodels, so no milestone is ever blocked on art.

## Performance budget

60 fps on a mid-range laptop iGPU with 24 zombies alive. Clone skinned zombies with `SkeletonUtils.clone` so geometry and materials are shared. Keep draw calls under about 150. Pool zombies, projectiles, decals and audio one-shots, with no allocations in the hot loop. Show a toggleable stats overlay (fps, draw calls, zombies alive) on backtick.

## Milestones

Each milestone ends with: `npm run build` passes, `npm test` passes, and a manual check described below. Then stop for review.

0. **Scaffold.** Vite + TS + React + three + Rapier + zustand + Vitest. Canvas with an empty lit scene and a React HUD placeholder. _Check:_ the dev server shows the scene and HUD text.
1. **Map loader (brushes only) + player controller.** Load `bunker-01` greybox from `map.json`. FPS movement, mouse look, pointer lock, collision, jump and sprint. _Check:_ walk around the greybox without clipping through walls.
2. **Weapons.** Pistol plus one rifle from `definitions.ts`, hitscan, ammo and reloads, and HUD ammo display. Place target dummies. _Check:_ the dummies register body and head hits correctly.
3. **Zombies + navmesh.** Navmesh from walkable brushes, capsule zombies that chase and attack, and hitboxes and damage. _Check:_ zombies path around obstacles and die to gunfire.
4. **Windows and barricades.** Outside spawns, board tearing, entering, and player repair. _Check:_ zombies only enter via windows, and repair works and awards points.
5. **Rounds + points + HUD.** RoundSystem, PointsSystem, round counter, point popups, and the game-over screen. Unit tests for round scaling and points. _Check:_ play to round 5 and confirm the numbers match `balance.ts`.
6. **Zones, doors, wall-buys.** Buying opens doors and activates new windows. _Check:_ new-zone windows only spawn after their door opens.
7. **Supply crate.** Weighted pool, relocation, and the experimental weapon. Unit tests for weights and relocation odds. _Check:_ the crate moves after enough spins.
8. **Feel pass.** Audio, muzzle flash, recoil, hit markers, blood decals (pooled), and fog and lighting presets. _Check:_ the stats overlay stays within budget at 24 zombies.
9. **glTF art route.** Load `level.glb`, read placeholders from empties' extras, and write `docs/MAPPING.md`. _Check:_ a Blender-authored test map plays identically to its JSON twin.
10. **(Stretch) In-browser map editor.** Place brushes and entities with gizmos and export `map.json`.

## Commands

- `npm run dev`: dev server
- `npm run build`: type-check and production build
- `npm test`: Vitest
- `npm run lint`: ESLint + Prettier check
