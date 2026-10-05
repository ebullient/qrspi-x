#!/usr/bin/env bash
set -euo pipefail

version="${1:?usage: .github/scripts/package-release.sh VERSION [OUTPUT.zip]}"
output="${2:-tools/release/qrspi-x-${version}.zip}"
if [[ ! "$version" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z.-]+)?$ ]]; then
  echo "invalid semver: $version" >&2
  exit 2
fi

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
if [[ "$output" = /* ]]; then
  output_path="$output"
else
  output_path="$repo_root/$output"
fi
mkdir -p "$(dirname "$output_path")"
manifest_dir="$(mktemp -d "${TMPDIR:-/tmp}/qrspi-manifest.XXXXXX")"
trap 'rm -rf "$manifest_dir"' EXIT
printf '{"version":"%s"}\n' "$version" >"$manifest_dir/qrspi-manifest.json"
(cd "$repo_root" && zip -qr "$output_path" plugin.json .claude-plugin README.md LICENSE skills agents)
(cd "$manifest_dir" && zip -qj "$output_path" qrspi-manifest.json)
printf '%s\n' "$output_path"
