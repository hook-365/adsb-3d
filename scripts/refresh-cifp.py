#!/usr/bin/env python3
"""Refresh everything generated from the FAA's CIFP, from one download.

The FAA publishes a new CIFP edition every 28 days. This fetches the
current one once and runs both generators against it:

  build-procedures.py -> procedures-index.json, procedures.pack,
                         cifp-edition.json
  build-navdata.py    -> navdata.json

Two uses:

    python3 scripts/refresh-cifp.py
        In the repository: regenerate the committed files, which are what
        a fresh image starts with. Do it before a release.

    refresh-cifp.py --serve DIR --bundled cifp-edition.json
        In the running container (entrypoint.sh, ENABLE_DATA_REFRESH): ask
        the FAA which edition is current and, if it is newer than both the
        image's own copy (--bundled) and what DIR already holds, build it
        into DIR with a manifest.json. The frontend reads DIR in place of
        its bundled copy when the manifest is newer. Exits 0 when there
        was nothing to do; a failure leaves DIR as it was.

The container builds with the same scripts its frontend was built with, so
the files always match what that frontend reads. Stdlib only.
"""

from __future__ import annotations

import argparse
import datetime
import json
import os
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path

API = "https://external-api.faa.gov/apra/cifp/chart?edition=current"
HERE = Path(__file__).resolve().parent
UA = {"User-Agent": os.environ.get("ADSB3D_USER_AGENT", "adsb-3d-refresh-cifp"), "Accept": "application/json"}
FILES = ("procedures-index.json", "procedures.pack", "navdata.json")


def current_url() -> str:
    with urllib.request.urlopen(urllib.request.Request(API, headers=UA), timeout=60) as resp:
        url = json.loads(resp.read().decode("utf-8"))["edition"][0]["product"]["url"]
    # The answer picks what gets downloaded: hold it to the FAA's own hosts.
    host = url.split("/")[2] if url.startswith("https://") else ""
    if not host.endswith(".faa.gov") or not url.endswith(".zip"):
        raise SystemExit(f"unexpected edition url: {url}")
    return url


def effective_of(name: str) -> str | None:
    """'CIFP_261029.zip' -> '2026-10-29'."""
    digits = "".join(c for c in Path(name).stem if c.isdigit())
    try:
        return datetime.date(2000 + int(digits[0:2]), int(digits[2:4]), int(digits[4:6])).isoformat()
    except (ValueError, IndexError):
        return None


def build(url: str, out: Path | None) -> None:
    name = url.rsplit("/", 1)[-1]
    with tempfile.TemporaryDirectory() as tmp:
        zip_path = Path(tmp) / name
        print(f"downloading {url}", file=sys.stderr)
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=600) as resp:
            zip_path.write_bytes(resp.read())
        for script in ("build-procedures.py", "build-navdata.py"):
            cmd = [sys.executable, str(HERE / script), "--zip", str(zip_path)]
            if out:
                cmd += ["--out", str(out)]
            subprocess.run(cmd, check=True)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--serve", type=Path, help="container mode: build a newer edition into this directory")
    ap.add_argument("--bundled", type=Path, help="with --serve: the image's own cifp-edition.json")
    args = ap.parse_args()

    url = current_url()
    name = url.rsplit("/", 1)[-1]
    if not args.serve:
        build(url, None)
        return 0

    effective = effective_of(name)
    if effective is None:
        print(f"cannot read a date from {name}", file=sys.stderr)
        return 1
    have = ""
    for known in (args.bundled, args.serve / "manifest.json"):
        try:
            have = max(have, str(json.loads(known.read_text(encoding="utf-8"))["effective"])) if known else have
        except (OSError, ValueError, KeyError):
            pass
    if effective <= have:
        print(f"edition of {have} is current", file=sys.stderr)
        return 0

    args.serve.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=args.serve.parent) as tmp:
        build(url, Path(tmp))
        edition = json.loads((Path(tmp) / "cifp-edition.json").read_text(encoding="utf-8"))
        # Data first, manifest last: the frontend only reads files a manifest vouches for.
        for f in FILES:
            target = args.serve / f
            os.replace(Path(tmp) / f, target)
            target.chmod(0o644)
        manifest = args.serve / "manifest.json"
        pending = Path(tmp) / "manifest.json"
        pending.write_text(json.dumps({**edition, "source": name}) + "\n", encoding="utf-8")
        os.replace(pending, manifest)
        manifest.chmod(0o644)
    args.serve.chmod(0o755)
    print(f"procedure data is now cycle {edition['cycle']} (effective {edition['effective']})", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
