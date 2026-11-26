#!/usr/bin/env bash
# Builds variant <name>: the shipped src/ with the files of variants/<name>/ laid over it, into build/<name>/.
#   native  clang++ -O2 -g in the container (callgrind-ready)     -> build/<name>/<driver>-native
#   wasm    em++ with the shipped flags, run by node              -> build/<name>/<driver>.js
#   lib     the shipped build:wasm flags, library exports         -> build/<name>/lib/clustering.{js,wasm}
# Usage: build.sh <name> [native] [wasm] [lib]   (default native wasm). Env: DRIVER (driver.cpp | mapdriver.cpp), EMFLAGS (replaces -O3 -msimd128), POST (command run on the .wasm)
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"; cd "$here"
name=$1; shift; targets=${*:-native wasm}
root="$(cd ../../.. && pwd)"
d=${DRIVER:-driver.cpp}; dn=${d%.cpp}
rm -rf build/$name/src; mkdir -p build/$name/src
cp "$root"/src/*.cpp "$root"/src/*.hpp build/$name/src/
[ -d variants/$name ] && cp variants/$name/* build/$name/src/
for t in $targets; do
  case $t in
    native) ./native-run.sh clang++ -std=c++17 -O2 -g ${NATIVEFLAGS:-} -Ibuild/$name/src $d -o build/$name/$dn-native${TAG:-} ;;
    wasm)
      source ~/.local/share/emsdk/emsdk_env.sh >/dev/null 2>&1
      echo '{"type":"commonjs"}' > build/package.json
      em++ $d -Ibuild/$name/src ${EMFLAGS:--O3 -msimd128} -s WASM=1 -s ALLOW_MEMORY_GROWTH=1 -s INITIAL_MEMORY=32MB -s MAXIMUM_MEMORY=2147483648 -s ENVIRONMENT=node -s NODERAWFS=1 -s EXIT_RUNTIME=1 -o build/$name/$dn.js
      ls -l build/$name/$dn.wasm | awk '{print "wasm bytes", $5}' ;;
    lib)
      source ~/.local/share/emsdk/emsdk_env.sh >/dev/null 2>&1
      mkdir -p build/$name/lib
      EXPORTS=$(node exports.mjs)
      em++ build/$name/src/clustering.cpp ${EMFLAGS:--O3 -msimd128} -s WASM=1 -s MODULARIZE=1 -s EXPORT_ES6=1 -s EXPORT_NAME='createWasmModule' -s ALLOW_MEMORY_GROWTH=1 -s INITIAL_MEMORY=32MB -s MAXIMUM_MEMORY=2147483648 -s EXPORTED_FUNCTIONS="$EXPORTS" -s EXPORTED_RUNTIME_METHODS="['HEAPU8']" -o build/$name/lib/clustering.js
      ls -l build/$name/lib/clustering.wasm | awk '{print "wasm bytes", $5}' ;;
  esac
done
