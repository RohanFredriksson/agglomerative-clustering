#!/usr/bin/env bash
# Instruction counts of every variant on a few images (4 callgrind runs at a time). Output results/ir-matrix.txt (one line per run).
# Usage: run-ir-matrix.sh "<variants>" "<images>" [space] [precision]
here="$(cd "$(dirname "$0")" && pwd)"; cd "$here"
for img in $2; do for v in $1; do echo "build/$v/driver-native $img ${3:-0} ${4:-8}"; done; done | xargs -P4 -L1 ./ir.sh >> ${OUT:-results/ir-matrix.txt}
