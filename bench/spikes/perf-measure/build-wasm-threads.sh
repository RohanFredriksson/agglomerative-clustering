#!/usr/bin/env bash
# Question 3 and 4: -pthread WebAssembly builds. build-wasm-threads.sh <source.cpp> <out base name> [extra flags]
# Same flags as build:wasm (-O3 -msimd128, memory growth, 2 GB maximum) plus -pthread and a pool of 8 workers.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
node "$here/instrument.mjs" >/dev/null
mkdir -p "$here/build"
echo '{"type":"commonjs"}' > "$here/build/package.json"
em++ "$1" -O3 -msimd128 -pthread -s PTHREAD_POOL_SIZE=${POOL:-8} -s WASM=1 -s ALLOW_MEMORY_GROWTH=1 -s INITIAL_MEMORY=32MB -s MAXIMUM_MEMORY=2147483648 \
  -s ENVIRONMENT=node -s NODERAWFS=1 -s EXIT_RUNTIME=1 "${@:3}" -o "$here/build/$2.js"
