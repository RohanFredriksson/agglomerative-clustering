#!/usr/bin/env bash
# WebAssembly time of the pixel scan alone (scandriver.js: ClusteringJob::scan, the histogram fill), median of 5 runs per variant and image,
# the variants alternating image by image, with the load average before and after. Usage: scan-timing.sh "<variants>" "<images>" > results/scan-timing.txt
# (each variant needs `DRIVER=scandriver.cpp ./build.sh <variant> wasm` first). Output: one line per image and variant, the median ms and the histogram hash.
here="$(cd "$(dirname "$0")" && pwd)"; cd "$here"
echo "load before: $(cat /proc/loadavg)"
for img in $2; do
  for v in $1; do
    r=$(node build/$v/scandriver.js data/$img.rgba 0 5)
    med=$(echo "$r" | awk '{print $4}' | sort -n | sed -n 3p); h=$(echo "$r" | tail -1 | awk '{print $NF}')
    echo "$img $v scan_ms $med hash $h"
  done
done
echo "load after: $(cat /proc/loadavg)"
