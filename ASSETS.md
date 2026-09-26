# Third-party assets

Every third-party asset shipped in the build must be listed here with its source URL and license.
CC-BY items also need a line on the in-game credits screen.

| Asset                       | Path | Source URL | Author | License |
| --------------------------- | ---- | ---------- | ------ | ------- |
| _(none yet — greybox only)_ |      |            |        |         |

## Original, generated in code (not third-party)

These ship in the build but are made by the project itself, so need no license entry:

- **All sound effects and music stings**: synthesised at load time from the recipes in
  `src/game/audio/sounds.ts` (built on `src/engine/synth.ts`). No recorded audio.
- **Blood splat and muzzle-flash textures**: drawn on a canvas at runtime in
  `src/game/view/textures.ts`.
