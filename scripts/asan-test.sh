#!/usr/bin/env bash
# Runs the test suite against an AddressSanitizer + UBSan build of the WebAssembly (after `npm run build`, with em++ on
# PATH). WebAssembly hides out-of-bounds reads that stay inside the heap, so tests alone can't see them; a sanitizer
# report aborts the run. The sanitized module (and its glue, through patch-glue, as a release build's) is swapped into
# dist/ for the run and the real files put back afterwards, whatever happens. ASan makes everything several times
# slower, so tests get 120 s by default instead of 5, and the memory test is skipped (ASan's overhead changes the 2 GB
# limit). Built at -O2 with --profiling-funcs rather than -g: a report names functions, not lines, but the glue is
# minified like a release build's, which patch-glue needs; for lines, build by hand with -g (CLAUDE.md). Extra arguments
# go to vitest, so `scripts/asan-test.sh test/indices.test.js` checks one file.
#
# Expected failures, none of them findings (last full run, 2026-11-23: about 9 minutes, 606 of 616 passed, no report):
#   - the heaviest tests (golden noise and gradients, large-k, real encoded files) time out at their own 60-120 s
#     limits, which --testTimeout doesn't raise;
#   - init "shares one load ... and the first load wins": ASan's heap starts at 512 MB, above the 256 MB at which the
#     library discards its instance after a call (retireIfLarge), so the module is never "already loaded" there.
# A finding is anything else: the glue's print is silenced, so a sanitizer report shows as a call rejecting with
# "Aborted" (often wasm-load-failed or a RuntimeError) in a test that passes on the release build.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"
out="$root/build/asan"
mkdir -p "$out/keep"

# The exported functions, as the release build lists them in package.json.
exports="$(node -p "require('./package.json').scripts['build:wasm'].match(/EXPORTED_FUNCTIONS=\\\\?\"(\[[^\]]*\])/)[1]")"
em++ src/clustering.cpp -O2 --profiling-funcs -msimd128 -fsanitize=address,undefined -fno-sanitize-recover=undefined \
    -s MODULARIZE=1 -s EXPORT_ES6=1 -s EXPORT_NAME=createWasmModule -s ALLOW_MEMORY_GROWTH=1 -s INITIAL_MEMORY=512MB \
    -s MAXIMUM_MEMORY=2147483648 -s EXPORTED_FUNCTIONS="$exports" -s EXPORTED_RUNTIME_METHODS="['HEAPU8']" \
    -o "$out/clustering.js"

cp dist/clustering.js dist/clustering.cjs dist/clustering.wasm "$out/keep/"
trap 'cp "$out/keep/clustering.js" "$out/keep/clustering.cjs" "$out/keep/clustering.wasm" dist/' EXIT
cp "$out/clustering.js" "$out/clustering.wasm" dist/
node scripts/patch-glue.mjs
npx vitest run --exclude test/memory.test.js --testTimeout=120000 "$@"
