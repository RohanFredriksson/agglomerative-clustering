#!/usr/bin/env bash
# Part A, WebAssembly: the previous spike's instrumented build (../perf-measure/build/driver.js, from build-wasm.sh there; the
# shipped flags) on every image in data/, 5 runs each (3 for 50 MP), RGB full precision and precision 6. Records the load average
# before and after each run set. Raw output in results/stages-wasm/<image>-<rgb8|rgb6>.txt. Run it with nothing else running.
here="$(cd "$(dirname "$0")" && pwd)"; cd "$here"
imgs=${IMAGES:-"k23 mos12 up12 birch city fern komar night pip sky sp wk old"}
for img in $imgs; do
  for cfg in rgb8:0:8 rgb6:0:6; do
    IFS=: read name space prec <<<"$cfg"
    f=results/stages-wasm/$img-$name.txt
    [ -s $f ] && continue
    { echo "load before: $(cat /proc/loadavg)"; node ../perf-measure/build/driver.js data/$img.rgba $space $prec 5; echo "load after: $(cat /proc/loadavg)"; } > $f.tmp 2>&1 && mv $f.tmp $f
  done
done
echo done > results/stages-wasm/DONE
