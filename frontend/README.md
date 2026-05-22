# adsb-3d frontend

Three.js + TypeScript app, Vite-built.

See `../README.md` for the project-level overview, environment
variables, and architecture notes.

## Layout

- `src/core/` — settings store, filter store, config (HOME etc.),
  coordinate projection, units formatter, URL state, time-context
  (live ↔ historical mode + playback cursor/rate).
- `src/feed/` — `feeds.ts` (multi-feed bootstrap + switcher),
  `live.ts` (WS + HTTP fallback), `history.ts` (live-mode trail
  backfill), `historical.ts` (full-window playback feed with
  interpolation), `routes.ts` (callsign → origin/destination cache),
  `acars.ts` (ACARS WS + HTTP fallback).
- `src/aircraft/` — aircraft store, reconciler (one Group per
  aircraft), acars-store (per-hex messages + OOOI summary), vendored
  tar1090 shape catalog + resolver.
- `src/world/` — scene, camera/orbit controls, label renderer, basemap
  tile layer, heatmap (3D airway-density LineSegments).
- `src/ui/` — aircraft list, aircraft detail card, photo loader,
  panel toggle, feed selector, settings panel, time-controls strip,
  ACARS browser modal, loading overlay, voice scanner panel
  (opt-in via `ENABLE_VOICE`; see [docs/VOICE.md](../docs/VOICE.md)).
- `src/interaction/` — click/tap raycast picking.
- `src/main.ts` — composes the above; owns the FeedSession lifecycle
  for in-place feed switching and the live ↔ historical handover.
- `tests-unit/` — Vitest smoke tests.

## Scripts

```sh
npm install
npm run dev         # Vite dev server with proxy to a running container
npm run typecheck   # tsc strict, no emit
npm run build       # tsc + vite build → dist/
npm run test        # Vitest
```

`npm run dev` proxies backend routes (`/data`, `/api`, `/ws`,
`/acars-api`, `/tiles`, `/config.js`) to
`http://localhost:8080` by default. When using the dev compose (which
maps to `8186`), override with
`DEV_BACKEND=http://localhost:8186 npm run dev`.

## Production build

The repo-root `Dockerfile` runs `npm ci && npm run build` in a Node
build stage and copies `dist/` to nginx's html root. The
`entrypoint.sh` generates `config.js` and dynamic per-feed nginx
proxy blocks at runtime from environment variables.
