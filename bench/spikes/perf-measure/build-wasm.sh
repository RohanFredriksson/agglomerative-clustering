#!/usr/bin/env bash
# Instrumented driver as a Node program, with the shipped build:wasm flags (-O3 -msimd128, memory growth, 2 GB maximum).
# Usage: build-wasm.sh [extra em++ flags]; output build/driver.js (+ .wasm). Needs em++ on PATH.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
node "$here/instrument.mjs" >/dev/null
echo "{\"type\":\"commonjs\"}" > "$(dirname "${OUT:-$here/build/driver.js}")/package.json"
em++ "$here/cpp/driver.cpp" -O3 -msimd128 -s WASM=1 -s ALLOW_MEMORY_GROWTH=1 -s INITIAL_MEMORY=32MB -s MAXIMUM_MEMORY=2147483648 \
  -s ENVIRONMENT=node -s NODERAWFS=1 -s EXIT_RUNTIME=1 "${@:2}" -o "${OUT:-$here/build/driver.js}"
