#!/usr/bin/env bash
# Native builds of the driver in a container (clang++, valgrind): build/driver-chain (the shipped merge loop, instrumented),
# build/driver-rounds (chain or rounds by ROUNDS_THREADS) and build/driver-callgrind (chain, STAMP dumps callgrind stats).
# Run from anywhere; needs podman.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
node "$here/instrument.mjs" >/dev/null; node "$here/rounds.mjs" >/dev/null
podman run --rm -v "$here:/spike:Z" -w /spike ubuntu:24.04 bash -c '
  apt-get update -qq && apt-get install -y -qq clang valgrind >/dev/null &&
  clang++ -std=c++17 -O2 -g cpp/driver.cpp -o build/driver-chain &&
  clang++ -std=c++17 -O2 -g -DROUNDS -pthread cpp/driver.cpp -o build/driver-rounds &&
  clang++ -std=c++17 -O2 -g -DSTAMP_CALLGRIND cpp/driver.cpp -o build/driver-callgrind'
