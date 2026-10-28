#!/usr/bin/env bash
# Cut a release: scripts/release.sh X.Y.Z
#
# VERSION at the repo root is the single source of truth for the project
# version. This script is the only thing that should ever change it. It
#   1. writes VERSION and frontend/package.json (+ lock) to X.Y.Z,
#   2. moves CHANGELOG.md's [Unreleased] section under [X.Y.Z] - today,
#   3. commits "release: vX.Y.Z" and creates the annotated tag vX.Y.Z.
# You then review and `git push origin master vX.Y.Z`; the publish workflow
# re-checks VERSION == package.json == tag and builds the images, which
# report exactly X.Y.Z (non-release builds carry "+<sha>" build metadata).
set -euo pipefail

ver=${1:-}
[[ "$ver" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "usage: $0 X.Y.Z" >&2; exit 2; }
root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"

[[ -z "$(git status --porcelain --untracked-files=no)" ]] || { echo "working tree has uncommitted changes — commit or stash first" >&2; exit 1; }
git rev-parse -q --verify "refs/tags/v$ver" >/dev/null && { echo "tag v$ver already exists" >&2; exit 1; }
cur=$(tr -d '[:space:]' < VERSION)
[[ "$ver" != "$cur" ]] || { echo "VERSION is already $ver" >&2; exit 1; }
grep -q '^## \[Unreleased\]' CHANGELOG.md || { echo "CHANGELOG.md has no [Unreleased] section" >&2; exit 1; }

today=$(date +%F)
printf '%s\n' "$ver" > VERSION
(cd frontend && npm version "$ver" --no-git-tag-version --allow-same-version >/dev/null)

# [Unreleased] -> fresh empty [Unreleased] + [ver] - today
python3 - "$ver" "$today" <<'PY'
import re, sys
ver, today = sys.argv[1:3]
p = 'CHANGELOG.md'
s = open(p, encoding='utf-8').read()
new = f"## [Unreleased]\n\n---\n\n## [{ver}] - {today}"
s, n = re.subn(r'## \[Unreleased\]\s*\n(?:\s*---\s*\n)?', new + "\n\n", s, count=1)
assert n == 1
open(p, 'w', encoding='utf-8').write(s)
PY

echo "== release v$ver =="
echo "VERSION:          $(cat VERSION)"
echo "package.json:     $(node -p "require('./frontend/package.json').version")"
git add VERSION frontend/package.json frontend/package-lock.json CHANGELOG.md
git commit -q -m "release: v$ver"
git tag -a "v$ver" -m "Release v$ver"
echo "committed $(git rev-parse --short HEAD) and tagged v$ver"
echo "next: review 'git show', then: git push origin $(git rev-parse --abbrev-ref HEAD) v$ver"
