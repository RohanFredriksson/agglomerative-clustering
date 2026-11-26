#!/usr/bin/env bash
# Question 2: chain against rounds (1 thread), native. Per image and config: search counts, round statistics, whether the
# clustering bytes are identical, whether palettes at k=16/256/1024/4096 agree, error ratios. Raw output in results/rounds/.
# Usage: run-rounds-profile.sh [images...]   (default: all). Needs build-native.sh first.
here="$(cd "$(dirname "$0")" && pwd)"
cd "$here"; mkdir -p results/rounds build/dumps
images=${@:-k23 k03 k20 up12 mos12 up50 mos50}
for img in $images; do
  for cfg in rgb8:0:8 oklab8:1:8 rgb6:0:6; do
    IFS=: read name space prec <<<"$cfg"
    case $img in k*) ;; *) [ $name != rgb8 ] && [ $img != up12 ] && continue;; esac
    out=results/rounds/$img-$name.txt; [ -s $out ] && continue
    {
      echo "== $img $name chain"; DUMP=build/dumps/$img-$name-chain.bin ./native-run.sh build/driver-chain data/$img.rgba $space $prec 1
      echo "== $img $name rounds, 1 thread, partner cache"; ROUNDS_THREADS=1 DUMP=build/dumps/$img-$name-rounds.bin ./native-run.sh build/driver-rounds data/$img.rgba $space $prec 1
      echo "== compare"; node compare-clusterings.mjs build/dumps/$img-$name-chain.bin build/dumps/$img-$name-rounds.bin
      node error-curves.mjs build/dumps/$img-$name-chain.bin build/dumps/$img-$name-rounds.bin
      node compare-palettes.mjs build/dumps/$img-$name-chain.bin build/dumps/$img-$name-rounds.bin
    } > $out 2>&1
    cp rounds.csv results/rounds/$img-$name-rounds.csv 2>/dev/null
  done
done
# Control: the shipped chain started from the other end (CHAIN_REVERSE=1) against the shipped chain, same comparisons.
if [ -n "${REVERSE:-}" ]; then
  for img in $images; do
    out=results/rounds/$img-rgb8-chain-reverse.txt; [ -s $out ] && continue
    {
      echo "== $img rgb8 chain, started from the newest cluster"; CHAIN_REVERSE=1 DUMP=build/dumps/$img-rgb8-chainrev.bin ./native-run.sh build/driver-rounds data/$img.rgba 0 8 1
      node compare-clusterings.mjs build/dumps/$img-rgb8-chain.bin build/dumps/$img-rgb8-chainrev.bin
      node error-curves.mjs build/dumps/$img-rgb8-chain.bin build/dumps/$img-rgb8-chainrev.bin
      node compare-palettes.mjs build/dumps/$img-rgb8-chain.bin build/dumps/$img-rgb8-chainrev.bin
    } > $out 2>&1
  done
fi
