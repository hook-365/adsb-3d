# Production Readiness Checklist

Use this checklist before publishing a new release of ADS-B 3D.

## Image & Registry

- [ ] GitHub Actions CI passes (typecheck + Vitest + build) on the release commit
- [ ] Multi-arch image built and pushed (`linux/amd64`, `linux/arm64`)
  ```
  ghcr.io/hook-365/adsb-3d:latest
  ghcr.io/hook-365/adsb-track-service:latest
  ghcr.io/hook-365/adsb-acars-service:latest
  ```
- [ ] `docker-compose.example.yml` references the published image tags (not `build:`)
- [ ] `docker pull ghcr.io/hook-365/adsb-3d:latest` succeeds on a clean machine

## Smoke test — bare minimum

```bash
docker run --rm \
  -e LATITUDE=45.0 \
  -e LONGITUDE=-90.0 \
  -e ALTITUDE=1000 \
  -e FEEDER_URL=http://ultrafeeder \
  -e ENABLE_HISTORICAL=false \
  -p 8086:80 \
  ghcr.io/hook-365/adsb-3d:latest

curl http://localhost:8086/health          # → OK
curl http://localhost:8086/config.js | head -5   # → window.ENV_CONFIG = ... (auto-generated config)
```

Open `http://localhost:8086/` in a browser. Aircraft should appear within a
few seconds if the feeder is reachable.

## Browser compatibility

Test with a live feeder attached. Verify:

- [ ] Chrome / Edge (latest) — desktop
- [ ] Firefox (latest) — desktop
- [ ] Safari (latest) — macOS
- [ ] Chrome Mobile (latest Android)
- [ ] Mobile Safari (latest iOS)

Check on each:
- 3D scene renders, aircraft appear, trails draw correctly
- Click an aircraft — detail card opens, route row populates
- Settings panel opens, basemap switcher works
- No errors in the browser console (F12)
- Memory stable after 30+ minutes (no steady climb in Task Manager)

## Deployment scenarios

- [ ] Root domain (`adsb3d.example.com`) — see `docs/REVERSE-PROXY.md`
- [ ] Subdirectory (`example.com/3d`) — entrypoint auto-detects `/3d`, `/adsb`, and `/adsb-3d`; `BASE_PATH` is only needed for non-standard paths (see `docs/REVERSE-PROXY.md`)
- [ ] Behind Nginx Proxy Manager with WebSocket support enabled
- [ ] Container starts cleanly with only required env vars set

Check each:
- `/health` returns `OK`
- Static assets load (no 404s in Network tab)
- WebSocket (`/ws/live`) connects (status pill shows aircraft count)

## Optional features

- [ ] Historical mode: `ENABLE_HISTORICAL=true` + track-service + TimescaleDB
  - Time-controls strip appears; toggle to historical mode works
  - Playback scrubber, speed controls, and presets (1h / 24h / 7d) work
  - Heatmap overlay renders for a 7-day window
- [ ] ACARS: `ENABLE_ACARS=true` + acars-service + external acarshub
  - ACARS chip appears in detail card for aircraft with messages
  - OOOI flight-phase (taxi-out / airborne / taxi-in / at gate) resolves
  - Full ACARS browser opens from HUD chip
- [ ] Voice scanner: `ENABLE_VOICE=true` + voice-services stack
  - Voice panel renders top-right; call list populates with recent clips
  - Scanner ▶ arms and auto-plays the next incoming transmission
  - Live channel-activity strip lights when transmissions occur
  - Panel disappears when switching to a remote feed (local-feed-only)

## ADS-B feeder compatibility

Test aircraft.json ingestion with:

- [ ] Ultrafeeder (`ghcr.io/sdr-enthusiasts/docker-adsb-ultrafeeder`)
- [ ] tar1090 standalone
- [ ] dump1090-fa
- [ ] readsb-protobuf

## Performance targets

| Metric | Target |
|--------|--------|
| Time to first aircraft | < 5 s |
| Frame rate (100 aircraft, desktop) | > 30 FPS |
| Browser memory after 1 h | < 500 MB |
| Cold-load trail backfill (30 aircraft) | < 1 s |

## Release steps

1. Tag the commit: `git tag -a vX.Y.Z -m "Release vX.Y.Z"`
2. Push tag to trigger the publish workflow: `git push origin vX.Y.Z`
3. Confirm packages appear at `https://github.com/orgs/hook-365/packages`
4. Update `CHANGELOG.md` with the release date
5. Create a GitHub Release referencing the tag with the changelog entry
