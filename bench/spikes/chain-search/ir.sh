#!/usr/bin/env bash
# Instruction count (callgrind "Collected") of one clustering with a native driver, plus the clustering's hash.
# Usage: ir.sh <driver> <image> [space] [precision]  -> "<driver> <image> <space> <prec> Ir <n> hash <h>"
here="$(cd "$(dirname "$0")" && pwd)"; cd "$here"
out=$(./native-run.sh valgrind --tool=callgrind --callgrind-out-file=/dev/null $1 data/$2.rgba ${3:-0} ${4:-8} 1 2>&1)
ir=$(echo "$out" | grep -E "Collected" | awk '{print $4}')
h=$(echo "$out" | grep -E "^HASH" | awk '{print $2}')
echo "$1 $2 ${3:-0} ${4:-8} Ir $ir hash $h"
