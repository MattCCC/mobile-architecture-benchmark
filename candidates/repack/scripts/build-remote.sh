#!/bin/sh
# Builds one version of the Insights remote (Module Federation 2 container + chunks, Hermes bytecode, code-signed)
# for one platform. Output: candidates/repack/build/remote/<platform>/<version>/ (mf-manifest.json,
# MbInsights.container.js.bundle, chunks), registered with the local server at
# /v1/modules/repack/<platform>/<version>/; the server's current/manifest.json names the active version (§15.2).
# Usage: sh candidates/repack/scripts/build-remote.sh <android|ios> [version]
set -eu
platform="$1"
version="${2:-1}"
case "$platform" in android|ios) ;; *) echo "build-remote: platform must be android or ios" >&2; exit 64 ;; esac
case "$version" in ''|*[!A-Za-z0-9._-]*) echo "build-remote: version must match [A-Za-z0-9._-]+" >&2; exit 64 ;; esac
here=$(cd "$(dirname "$0")/.." && pwd)
shared="$here/../_rn-shared"
keys="${MB_REMOTE_KEYS_DIR:-$shared/.keys}"
out="build/remote/$platform/$version"
cd "$here"
node "$shared/tools/gen-assets.mjs" .mb-assets
node "$shared/tools/ensure-signing-keys.mjs" "$keys"
rm -rf "$out" "build/remote-bundle/$platform"
mkdir -p "$out" "build/remote-bundle/$platform"
MB_REMOTE_VERSION="$version" npx react-native bundle --platform "$platform" --config rspack.insights.config.mjs \
  --entry-file insights-remote/index.js --dev false \
  --bundle-output "build/remote-bundle/$platform/index.bundle" </dev/null
cp "build/remote-bundle/$platform/mf-manifest.json" "$out/mf-manifest.json"
# Every served chunk must be Hermes bytecode with a signature that verifies against the host's public key.
node scripts/verify-remote.mjs "$out" "$keys/repack-code-signing.pub"
ls -l "$out"
