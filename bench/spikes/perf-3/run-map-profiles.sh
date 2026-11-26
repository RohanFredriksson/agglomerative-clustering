#!/usr/bin/env bash
# Callgrind profiles of the mapping (quantize at k=16: no dither, Floyd-Steinberg, ordered) on night, fern, sky and k23. 4 jobs at a time.
cd "$(dirname "$0")"
declare -A W=([night]=3648 [fern]=5472 [sky]=5610 [k23]=768)
for m in -1 0 2; do
  for i in night fern sky k23; do ./profile.sh ${1:-base} map $i ${W[$i]} 16 $m 0 & done; wait
done
