#!/usr/bin/env bash
# Profile-guided optimisation, step 1: the variant's source built natively with -fprofile-instr-generate (build/pgo-<variant>/*-inst) and run on a training
# set: clustering of fern, night, k23 and mos12 (RGB), k23 (precision 6, OKLab), sky (precision 6), and mapping of k23 (k=16 and 256, every dither method,
# RGB and OKLab, colours and indices) and fern (k=16, three dither modes). Raw profiles go to build/pgo-<variant>/raw/ and are merged to
# build/pgo-<variant>/train.profdata with the container's llvm-profdata-18 (the emsdk's newer one rejects the older raw format).
# Step 2: EMFLAGS="-O3 -msimd128 -fprofile-instr-use=$PWD/build/pgo-<variant>/train.profdata" ./make-dist.sh <variant>   (the source must be the same)
# Usage: pgo-train.sh <variant>   (needs build/<variant>/src from build.sh)
here="$(cd "$(dirname "$0")" && pwd)"; cd "$here"; v=$1; d=build/pgo-$v; rm -rf $d; mkdir -p $d/raw
./native-run.sh bash -c "
clang++ -std=c++17 -O2 -fprofile-instr-generate -Ibuild/$v/src driver.cpp -o $d/driver-inst && clang++ -std=c++17 -O2 -fprofile-instr-generate -Ibuild/$v/src mapdriver.cpp -o $d/mapdriver-inst || exit 1
export LLVM_PROFILE_FILE=$d/raw/p-%p.profraw
for a in 'fern 0 8' 'night 0 8' 'k23 0 8' 'mos12 0 8' 'k23 0 6' 'k23 1 8' 'sky 0 6'; do set -- \$a; $d/driver-inst data/\$1.rgba \$2 \$3 1 >/dev/null; done
for sp in 0 1; do for k in 16 256; do for m in -1 0 1 2; do $d/mapdriver-inst data/k23.rgba 768 \$sp \$k \$m 1 >/dev/null; $d/mapdriver-inst data/k23.rgba 768 \$sp \$k \$m 1 1 >/dev/null; done; done; done
for m in -1 0 2; do $d/mapdriver-inst data/fern.rgba 5472 0 16 \$m 1 >/dev/null; done
llvm-profdata-18 merge -o $d/train.profdata $d/raw/*.profraw && ls -l $d/train.profdata"
