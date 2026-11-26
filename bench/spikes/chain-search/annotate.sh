#!/usr/bin/env bash
# Line-level Ir of the search in a native driver: annotate.sh <variant> <image>  -> build/ann-<variant>-<image>.txt (lines >= 1% of the total)
here="$(cd "$(dirname "$0")" && pwd)"; cd "$here"
./native-run.sh valgrind --tool=callgrind --callgrind-out-file=build/prof-$1-$2.out build/$1/driver-native data/$2.rgba 0 8 1 >/dev/null 2>&1
./native-run.sh callgrind_annotate --auto=yes --show-percs=no build/prof-$1-$2.out > build/ann-$1-$2.txt 2>/dev/null
total=$(grep "PROGRAM TOTALS" build/ann-$1-$2.txt | awk '{gsub(",","",$1); print $1}')
awk '/Auto-annotated source: build\/'$1'\/src\/clustering.hpp/{p=1} /Auto-annotated source: build\/'$1'\/src\/clustering.cpp/{p=0} p' build/ann-$1-$2.txt | grep -E "^ *[0-9]{1,3}(,[0-9]{3})+ " | awk -v t=$total '{ v=$1; gsub(",","",v); if (v+0>=t*0.008) print }' | cut -c1-190
