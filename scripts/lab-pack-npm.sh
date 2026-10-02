#!/usr/bin/env bash
#
# Pack the lab fork's npm tarballs for a GitHub Release, without a registry.
#
# Runs scripts/pack-npm.sh on the bundles in release/, then `npm pack`s each
# per-platform package and the shim. The shim's optionalDependencies are
# rewritten from registry versions to this release's asset URLs, so
#
#   npm install https://github.com/<repo>/releases/download/<tag>/colbymchenry-codegraph-<version>.tgz
#
# installs the shim plus only the host's platform bundle, and package-lock.json
# pins every tarball by integrity hash.
#
# Usage: scripts/lab-pack-npm.sh <tag> [<owner/repo>]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TAG="${1:?usage: lab-pack-npm.sh <tag> [<owner/repo>]}"
REPO="${2:-${GITHUB_REPOSITORY:-Abiud/codegraph}}"
VERSION="$(node -p "require('$ROOT/package.json').version")"
REL="$ROOT/release"
BASE_URL="https://github.com/${REPO}/releases/download/${TAG}"

bash "$ROOT/scripts/pack-npm.sh" "$VERSION"

shopt -s nullglob
for pkgdir in "$REL"/npm/codegraph-*/; do
  ( cd "$REL" && npm pack "$pkgdir" --pack-destination "$REL" >/dev/null )
done

BASE_URL="$BASE_URL" node -e '
  const fs = require("fs");
  const file = process.argv[1];
  const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
  for (const name of Object.keys(manifest.optionalDependencies)) {
    const asset = `${name.replace(/^@/, "").replace("/", "-")}-${manifest.optionalDependencies[name]}.tgz`;
    manifest.optionalDependencies[name] = `${process.env.BASE_URL}/${asset}`;
  }
  fs.writeFileSync(file, JSON.stringify(manifest, null, 2) + "\n");
' "$REL/npm/main/package.json"
( cd "$REL" && npm pack "$REL/npm/main" --pack-destination "$REL" >/dev/null )

ls -lh "$REL"/colbymchenry-codegraph-*.tgz
