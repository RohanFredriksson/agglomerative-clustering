#!/usr/bin/env bash
# Question 2 in WebAssembly: the rounds merge loop with 1/2/4/8 threads in a -pthread build run by Node 24, against the
# chain (ROUNDS_THREADS unset) in the same build. Raw output in results/rounds-wasm/. Needs build-wasm-threads.sh cpp/driver.cpp driver-rounds-mt -DROUNDS.
here="$(cd "$(dirname "$0")" && pwd)"; cd "$here"; mkdir -p results/rounds-wasm
for img in k23 mos12 up12 up50; do
  case $img in k*) runs=5;; up50) runs=1;; *) runs=3;; esac
  out=results/rounds-wasm/$img.txt; [ -s $out ] && continue
  { echo "== chain"; node build/driver-rounds-mt.js data/$img.rgba 0 8 $runs
    for t in 1 2 4 8; do echo "== rounds threads=$t"; ROUNDS_THREADS=$t node build/driver-rounds-mt.js data/$img.rgba 0 8 $runs; done
  } > $out.tmp 2>&1 && mv $out.tmp $out
done
