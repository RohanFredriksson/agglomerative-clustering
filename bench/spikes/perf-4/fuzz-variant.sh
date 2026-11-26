#!/usr/bin/env bash
# Runs the repo's native/fuzz_identical.cpp (libFuzzer + ASan + UBSan; compares a clustering from src/ with the 4.0.0 reference, byte for byte) on a
# variant's source: the target is built in build/fuzz-<variant>/ with the variant's files laid over a copy of src/. Usage: fuzz-variant.sh <variant> [seconds=300]
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"; cd "$here"; root="$(cd ../../.. && pwd)"
v=$1; secs=${2:-300}
d=build/fuzz-$v; rm -rf $d/src $d/native; mkdir -p $d/src $d/native $d/corpus
cp "$root"/src/*.cpp "$root"/src/*.hpp $d/src/; [ -d variants/$v ] && cp variants/$v/* $d/src/
cp -r "$root"/native/fuzz_identical.cpp "$root"/native/reference $d/native/
cp "$root"/fixtures/clusterings/*.bin "$root"/native/seeds/fuzz_images/* "$root"/native/seeds/fuzz_identical/* $d/corpus/ 2>/dev/null || true
./native-run.sh bash -c "cd build/fuzz-$v && clang++ -std=c++17 -O1 -g -fsanitize=fuzzer,address,undefined -fno-sanitize-recover=undefined native/fuzz_identical.cpp native/reference/reference.cpp -o fuzz_identical && ./fuzz_identical corpus -max_total_time=$secs -max_len=20000 -rss_limit_mb=2048 -timeout=30 -print_final_stats=1" 2>&1 | tail -25 | tee results/fuzz-$v.txt
