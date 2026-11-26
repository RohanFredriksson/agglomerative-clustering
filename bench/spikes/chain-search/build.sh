#!/usr/bin/env bash
# Builds variant <name> (the shipped src/ with the files of variants/<name>/ laid over it) into build/<name>/:
#   native (clang++ -O2 in the container; callgrind-ready) -> build/<name>/driver-native
#   count  (same, with -DCOUNTERS)                         -> build/<name>/driver-count
#   wasm   (em++ with the shipped flags, run in node)      -> build/<name>/driver.js (+ .wasm)
#   lib    (the shipped build:wasm flags, library exports)  -> build/<name>/lib/clustering.{js,wasm} (+ patched glue)
# Usage: build.sh <name> [native] [count] [wasm] [lib]   (default: native wasm)
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"; cd "$here"
name=$1; shift; targets=${*:-native wasm}
root="$(cd ../../.. && pwd)"
mkdir -p build/$name/src
spec=$(grep "^$name:" variants.txt | head -1 | cut -d: -f2)
[ "$(grep -c "^$name:" variants.txt)" = 0 ] && { echo "unknown variant $name" >&2; exit 1; }
rm -rf build/$name/src; mkdir -p build/$name/src
cp "$root"/src/*.cpp "$root"/src/*.hpp build/$name/src/
python3 make-variant.py $name build/$name/src $spec
for t in $targets; do
  case $t in
    native) ./native-run.sh clang++ -std=c++17 -O2 -g -Ibuild/$name/src driver.cpp -o build/$name/driver-native ;;
    tune) ./native-run.sh clang++ -std=c++17 -O2 -g $DEFS -Ibuild/$name/src driver.cpp -o build/$name/driver-${TAG:-x} ;;
    count) ./native-run.sh clang++ -std=c++17 -O2 -g -DCOUNTERS -Ibuild/$name/src driver.cpp -o build/$name/driver-count ;;
    wasm)
      source ~/.local/share/emsdk/emsdk_env.sh >/dev/null 2>&1
      echo '{"type":"commonjs"}' > build/package.json
      em++ driver.cpp -Ibuild/$name/src -O3 -msimd128 -s WASM=1 -s ALLOW_MEMORY_GROWTH=1 -s INITIAL_MEMORY=32MB -s MAXIMUM_MEMORY=2147483648 -s ENVIRONMENT=node -s NODERAWFS=1 -s EXIT_RUNTIME=1 -o build/$name/driver.js ;;
    lib)
      source ~/.local/share/emsdk/emsdk_env.sh >/dev/null 2>&1
      mkdir -p build/$name/lib
      EXPORTS=$(node exports.mjs)
      em++ build/$name/src/clustering.cpp -O3 -msimd128 -s WASM=1 -s MODULARIZE=1 -s EXPORT_ES6=1 -s EXPORT_NAME='createWasmModule' -s ALLOW_MEMORY_GROWTH=1 -s INITIAL_MEMORY=32MB -s MAXIMUM_MEMORY=2147483648 -s EXPORTED_FUNCTIONS="$EXPORTS" -s EXPORTED_RUNTIME_METHODS="['HEAPU8']" -o build/$name/lib/clustering.js
      ls -l build/$name/lib/clustering.wasm | awk '{print "wasm bytes", $5}' ;;
  esac
done
