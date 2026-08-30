#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$repo_root"

source "$repo_root/node-check.sh" || exit 1

package_name="$(node -p "require('./package.json').name")"
bin_names="$(node -p "Object.keys(require('./package.json').bin).join('\n')")"
npm_global_root="$(npm root -g)"
global_package_path="${npm_global_root}/${package_name}"

if [[ -e "$global_package_path" && ! -L "$global_package_path" ]]; then
  echo "Error: ${package_name} is already installed globally via npm." >&2
  echo "Run 'npm uninstall -g ${package_name}' first, then retry linking." >&2
  exit 1
fi

npm install
npm test
npm run build
npm link

echo "${package_name} linked. Verifying package executables:"
while IFS= read -r bin_name; do
  command -v "$bin_name" || true
  "$bin_name" --version || true
done <<< "$bin_names"
