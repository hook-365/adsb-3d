# ADS-B 3D — Documentation Index

Supplementary documentation for the ADS-B 3D project. See the repo-root
`README.md` for the quick-start, environment variable reference, and
architecture overview.

## Documents

| File | Description |
|------|-------------|
| [PRODUCTION-CHECKLIST.md](PRODUCTION-CHECKLIST.md) | Pre-release readiness checklist covering browser compatibility, deployment scenarios, feeder compatibility, and performance targets. |
| [REVERSE-PROXY.md](REVERSE-PROXY.md) | Step-by-step examples for deploying adsb-3d behind nginx, Traefik, Caddy, Apache, and Nginx Proxy Manager (NPM Plus), including subdirectory and root-domain scenarios. |
| [VOICE.md](VOICE.md) | Full setup guide for the optional VHF airband voice scanner: the call-based architecture (rtl_airband per-transmission recording + the voice-events indexer sidecar), NFS wiring, retention, and integration with `ENABLE_VOICE`. |
