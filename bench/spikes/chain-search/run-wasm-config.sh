#!/usr/bin/env bash
# WebAssembly timing of base and final at OKLab (space 1, precision 8) and precision 6 (RGB) on a few images, 5 runs each, base/final alternating.
# Output results/wasm-config/<cfg>-<image>-<variant>.txt (with load averages). Run on an idle machine.
here="$(cd "$(dirname "$0")" && pwd)"; cd "$here"; mkdir -p results/wasm-config
for cfg in oklab8:1:8 rgb6:0:6; do IFS=: read name space prec <<<"$cfg"
  for img in k23 mos12 fern night up12; do
    for v in base final base; do
      f=results/wasm-config/$name-$img-$v.txt; [ -s $f ] && f=${f%.txt}-2.txt
      { echo "load before: $(cat /proc/loadavg)"; node build/$v/driver.js data/$img.rgba $space $prec 5; echo "load after: $(cat /proc/loadavg)"; } > $f 2>&1
    done
  done
done
echo done > results/wasm-config/DONE
