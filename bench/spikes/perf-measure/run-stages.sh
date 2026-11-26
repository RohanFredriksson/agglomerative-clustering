#!/usr/bin/env bash
# Question 1: per-stage times of the instrumented WebAssembly build (build-wasm.sh first), raw output in
# results/stages-wasm/<image>-<config>.txt. Configs: rgb8 (RGB, full precision), oklab8, rgb6 (RGB, precision 6).
# Mapping runs only with rgb8 and oklab8 (mapping does not depend on precision). Runs: 5, or 3 for the 50 MP images.
here="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$here/results/stages-wasm"
for img in k23 k03 k20 up12 mos12 up50 mos50; do
  runs=5; case $img in up50|mos50) runs=3;; esac
  w=$(node -e "console.log(require('$here/data/images.json')['$img'].width)")
  for cfg in rgb8:0:8:map oklab8:1:8:map rgb6:0:6:; do
    IFS=: read name space prec map <<<"$cfg"
    f="$here/results/stages-wasm/$img-$name.txt"
    [ -s "$f" ] && continue
    node "$here/build/driver.js" "$here/data/$img.rgba" $space $prec $runs ${map:+map $w} > "$f.tmp" 2>&1 && mv "$f.tmp" "$f"
  done
done
echo done > "$here/results/stages-wasm/DONE"
