#!/usr/bin/env bash
# Question 2, measured: the chain (shipped merge loop) against rounds on 1, 2, 4 and 8 std::threads, native (clang -O2, in the
# container), RGB full precision. Per image: runs 5 (0.4 MP), 3 (12 MP), 2 (50 MP; the chain once). Raw output in results/rounds-threads/.
# The machine's 8 "cores" are 4 physical cores with SMT (i7-1185G7).
here="$(cd "$(dirname "$0")" && pwd)"; cd "$here"; mkdir -p results/rounds-threads
for img in ${@:-k23 k03 mos12 up12 mos50 up50}; do
  case $img in k*) runs=5;; up50|mos50) runs=2;; *) runs=3;; esac
  out=results/rounds-threads/$img.txt; [ -s $out ] && continue
  { cruns=$runs; [ $runs = 2 ] && cruns=1
    echo "== chain"; ./native-run.sh build/driver-chain data/$img.rgba 0 8 $cruns
    for t in 1 2 4 8; do echo "== rounds threads=$t"; ROUNDS_THREADS=$t ./native-run.sh build/driver-rounds data/$img.rgba 0 8 $runs; done
  } > $out.tmp 2>&1 && mv $out.tmp $out
done
