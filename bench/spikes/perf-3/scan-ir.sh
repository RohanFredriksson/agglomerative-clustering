#!/usr/bin/env bash
# Instruction counts (callgrind, native) of the pixel scan alone (scandriver, one run) for each variant and image. Output: results/scan-ir.txt
here="$(cd "$(dirname "$0")" && pwd)"; cd "$here"
: > results/scan-ir.txt
for img in ${IMAGES:-fern night pip}; do
  for v in ${VARIANTS:-base scan-a scan-b scan-c}; do
    out=$(./native-run.sh valgrind --tool=callgrind --callgrind-out-file=/dev/null build/$v/scandriver-native data/$img.rgba 0 1 2>&1)
    echo "$img $v Ir $(echo "$out" | grep Collected | awk '{print $4}') hash $(echo "$out" | grep -o 'HASH [0-9a-f]*' | awk '{print $2}')" | tee -a results/scan-ir.txt
  done
done
