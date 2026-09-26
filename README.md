# Project Holdout

Browser-based, first-person, round-survival game built with three.js, Rapier and React.
See [CLAUDE.md](CLAUDE.md) for the design spec and milestones, and [ASSETS.md](ASSETS.md) for asset licenses.

## Commands

- `npm run dev` — dev server
- `npm run build` — type-check and production build
- `npm test` — unit tests (Vitest)
- `npm run lint` — ESLint + Prettier check
- `npm run format` — apply Prettier

## URL options (dev)

- `?map=<id>` — load `public/maps/<id>/map.json`
- `?debug=nav` — draw the navmesh
- `?lighting=<preset>` — preview a lighting preset (`night-dim`, `bunker-amber`, `overcast-dusk`, `blackout`) in place of the map's own
