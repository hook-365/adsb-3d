# Upgrading and versioning

Pull the new image and restart; settings and data carry over. From
0.12.2 the settings panel shows an **Update available** badge when a
newer release exists, and the first load after an upgrade shows what
changed.

**Routes (origin / destination) stopped showing?** Releases before
0.12 sent route lookups to [adsb.im](https://adsb.im) one callsign at a
time and may be rate-limited or blocked there. Pull a current image
(`:latest` or `0.12.2`+) and restart; routes come back, and from 0.12.2
the settings panel tells you when a newer release exists. See
[#17](https://github.com/hook-365/adsb-3d/issues/17).

Full detail in [CHANGELOG.md](../CHANGELOG.md).

## Versioning

`VERSION` at the repository root is the single source of truth. Every image
copies it at build time and reports it everywhere a version appears: the
settings panel (`v0.12.1`), the `/api` and `/acars-api` root endpoints, the
nginx `User-Agent` sent to adsb.im and tile providers, and track-service's
`adsb-3d/<version> track-service` agent. Images built from a commit that is
not a release tag carry build metadata (`0.12.1+a1b2c3d`, or `+local` for a
local compose build), so a non-release build can never be mistaken for the
published one. Releases are cut with `scripts/release.sh X.Y.Z`; CI refuses
to publish if `VERSION`, `frontend/package.json` and the tag disagree.

---

Back to the [README](../README.md) or the [documentation index](README.md).
