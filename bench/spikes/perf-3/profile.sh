#!/usr/bin/env bash
# Callgrind profile of the base (or another) native driver. Usage: profile.sh <variant> clust <image> [space] [precision]
#   or: profile.sh <variant> map <image> <width> <k> <method -1|0|1|2> [space]
# Writes build/prof/<variant>-<tag>.out (callgrind, --dump-instr=no) and results/prof/<variant>-<tag>-{excl,incl}.txt.
here="$(cd "$(dirname "$0")" && pwd)"; cd "$here"; mkdir -p build/prof results/prof
v=$1; kind=$2; shift 2
if [ $kind = clust ]; then
  img=$1; sp=${2:-0}; pr=${3:-8}; tag=clust-$img-s$sp-p$pr
  ./native-run.sh valgrind --tool=callgrind --dump-instr=no --callgrind-out-file=build/prof/$v-$tag.out build/$v/driver-native data/$img.rgba $sp $pr 1 > build/prof/$v-$tag.log 2>&1
else
  img=$1; w=$2; k=$3; m=$4; sp=${5:-0}; tag=map-$img-k$k-m$m-s$sp
  PALFILE=build/prof/pal-$img-s$sp-k$k.bin ./native-run.sh build/$v/mapdriver-native data/$img.rgba $w $sp $k -1 1 > /dev/null 2>&1 || true
  PALFILE=build/prof/pal-$img-s$sp-k$k.bin ./native-run.sh valgrind --tool=callgrind --dump-instr=no --toggle-collect='mapping_call*' --callgrind-out-file=build/prof/$v-$tag.out build/$v/mapdriver-native data/$img.rgba $w $sp $k $m 1 > build/prof/$v-$tag.log 2>&1
fi
./native-run.sh callgrind_annotate --inclusive=no build/prof/$v-$tag.out > results/prof/$v-$tag-excl.txt 2>/dev/null
./native-run.sh callgrind_annotate --inclusive=yes build/prof/$v-$tag.out > results/prof/$v-$tag-incl.txt 2>/dev/null
echo done $v $tag
