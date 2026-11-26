#!/usr/bin/env bash
# WebAssembly timing (the shipped flags, run by Node): for each image, every variant's driver.js (build.sh <v> wasm), 5 runs each in one process
# (3 for up12), then base again as a drift check. Raw output results/wasm/<image>/<variant>.txt with the load average before and after.
# Usage: run-wasm-timing.sh "<variants>" "<images>". Run it on an otherwise idle machine.
here="$(cd "$(dirname "$0")" && pwd)"; cd "$here"
for img in $2; do
  mkdir -p results/wasm/$img; runs=5; [ $img = up12 ] && runs=3
  for v in $1 base2; do
    src=${v/base2/base}
    f=results/wasm/$img/$v.txt; [ -s $f ] && continue
    { echo "load before: $(cat /proc/loadavg)"; node build/$src/driver.js data/$img.rgba 0 8 $runs; echo "load after: $(cat /proc/loadavg)"; } > $f.tmp 2>&1 && mv $f.tmp $f
  done
done
