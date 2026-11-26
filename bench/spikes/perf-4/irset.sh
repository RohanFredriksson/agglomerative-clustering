#!/usr/bin/env bash
# Instruction counts (callgrind, native) of the clustering driver on a set of images, run in parallel, with the hash checked against the
# shipped 4.1.0's (results/ref-hashes.json). Usage: irset.sh <driver binary relative to perf-3> <label> [space 0|1] [precision] [images...]
# Appends "label image config Ir hash same" lines to results/ir.txt
here="$(cd "$(dirname "$0")" && pwd)"; cd "$here"
bin=$1; label=$2; sp=${3:-0}; pr=${4:-8}; shift 4 2>/dev/null || shift $#
imgs=${*:-"fern night sky k23"}
cfg=rgb$pr; [ $sp = 1 ] && cfg=oklab$pr
run() {
  img=$1
  out=$(./native-run.sh valgrind --tool=callgrind --callgrind-out-file=/dev/null $bin data/$img.rgba $sp $pr 1 2>&1)
  ir=$(echo "$out" | grep Collected | awk '{print $4}'); h=$(echo "$out" | grep -E "^HASH" | awk '{print $2}')
  ref=$(python3 -c "import json;print(json.load(open('results/ref-hashes.json')).get('$img',{}).get('$cfg',''))")
  same=NO; [ "$h" = "$ref" ] && same=yes
  echo "$label $img $cfg $ir $h $same" >> results/ir.txt
  echo "$label $img $cfg $ir $h $same"
}
for i in $imgs; do run $i & done; wait
