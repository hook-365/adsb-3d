# ADS-B 3D: documentation

The repo-root [README](../README.md) has the quick start and the feature
overview. Everything else is here.

| File | Description |
|------|-------------|
| [FEATURES.md](FEATURES.md) | Every layer and panel, with screenshots. |
| [CONFIGURATION.md](CONFIGURATION.md) | The environment variable reference for the main image and the backend services. |
| [FEEDS.md](FEEDS.md) | Multi-feed (`FEEDN_*`) and the Explore providers, their keys, limits and licences. |
| [CONTROLS.md](CONTROLS.md) | Camera modes, mouse and keyboard. |
| [REVERSE-PROXY.md](REVERSE-PROXY.md) | Step-by-step examples for deploying adsb-3d behind nginx, Traefik, Caddy, Apache, and Nginx Proxy Manager (NPM Plus), including subdirectory and root-domain scenarios. |
| [VOICE.md](VOICE.md) | Full setup guide for the optional VHF airband voice scanner: the call-based architecture (rtl_airband per-transmission recording + the voice-events indexer sidecar), NFS wiring, retention, and integration with `ENABLE_VOICE`. |
| [UPGRADING.md](UPGRADING.md) | Upgrade notes and how version numbers are set. |
| [DEVELOPMENT.md](DEVELOPMENT.md) | Architecture, the dev workflow, and the scripts that regenerate the bundled data. |
| [CREDITS.md](CREDITS.md) | Data sources and services, with their licences and terms. |
| [PRODUCTION-CHECKLIST.md](PRODUCTION-CHECKLIST.md) | Pre-release readiness checklist covering browser compatibility, deployment scenarios, feeder compatibility, and performance targets. |
