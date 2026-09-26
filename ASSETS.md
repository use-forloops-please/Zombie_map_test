# Third-party assets

Every third-party asset shipped in the build must be listed here with its source URL and license.
CC-BY items also need a line on the in-game credits screen.

| Asset                                               | Path                                     | Source URL                                      | Author                         | License |
| --------------------------------------------------- | ---------------------------------------- | ----------------------------------------------- | ------------------------------ | ------- |
| Concrete Wall 003 (colour, normal, roughness)       | `public/assets/textures/concrete-wall/`  | https://polyhaven.com/a/concrete_wall_003       | Dimitrios Savva, Rico Cilliers | CC0 1.0 |
| Concrete Floor Worn 001 (colour, normal, roughness) | `public/assets/textures/concrete-floor/` | https://polyhaven.com/a/concrete_floor_worn_001 | Dimitrios Savva, Rico Cilliers | CC0 1.0 |
| Dirty Concrete (colour, normal, roughness)          | `public/assets/textures/dirty-concrete/` | https://polyhaven.com/a/dirty_concrete          | Rob Tuytel                     | CC0 1.0 |
| Beige Wall 001 (colour, normal, roughness)          | `public/assets/textures/plaster/`        | https://polyhaven.com/a/beige_wall_001          | Dimitrios Savva, Rico Cilliers | CC0 1.0 |
| Weathered Brown Planks (colour, normal, roughness)  | `public/assets/textures/wood-planks/`    | https://polyhaven.com/a/weathered_brown_planks  | Dimitrios Savva, Rico Cilliers | CC0 1.0 |
| Rusty Metal 02 (colour, normal, roughness)          | `public/assets/textures/rusty-metal/`    | https://polyhaven.com/a/rusty_metal_02          | Rob Tuytel                     | CC0 1.0 |
| Dirt (colour, normal, roughness)                    | `public/assets/textures/dirt/`           | https://polyhaven.com/a/dirt                    | Charlotte Baglioni             | CC0 1.0 |
| Red Brick 03 (colour, normal, roughness)            | `public/assets/textures/red-brick/`      | https://polyhaven.com/a/red_brick_03            | Rob Tuytel                     | CC0 1.0 |

The textures are the 1K JPG sets from Poly Haven. Colour maps are kept at 1024 px; normal and
roughness maps were downscaled to 512 px and re-encoded to save download size. CC0 needs
no attribution, but the authors are credited above anyway.

## Original, generated in code (not third-party)

These ship in the build but are made by the project itself, so need no license entry:

- **All sound effects and music stings**: synthesised at load time from the recipes in
  `src/game/audio/sounds.ts` (built on `src/engine/synth.ts`). No recorded audio.
- **Blood splat and muzzle-flash textures**: drawn on a canvas at runtime in
  `src/game/view/textures.ts`.
