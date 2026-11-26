#!/usr/bin/env bash
# The timing runs that need an otherwise idle machine, one after the other (log in results/batch.log).
here="$(cd "$(dirname "$0")" && pwd)"; cd "$here"
node js-boundary.mjs k23 up12 up50 > results-js-boundary.md 2>&1
for img in up12 up50; do
  w=$(node -e "console.log(require('./data/$img.rgba'.replace('rgba','json')||'')||0)" 2>/dev/null); w=$(node -e "console.log(require('./data/images.json')['$img'].width)")
  runs=5; [ $img = up50 ] && runs=3
  node build/mapthreads.js data/$img.rgba $w 0 $runs 1,2,4,8 > results/map-threads/$img-rgb.txt 2>&1
done
node startup.mjs 15 > results-startup.md 2>&1
node q5-flags.mjs base base-o2 base-os base-relaxed > results-q5-flags.md 2>&1
./run-rounds-threads.sh
echo finished > results/batch-done
