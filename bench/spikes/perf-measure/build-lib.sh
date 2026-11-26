#!/usr/bin/env bash
# Builds the library the way build:wasm does (same flags) into build/lib-<name>.js/.wasm, for sizes and speed.
#   build-lib.sh <name> <source.cpp> [flags that replace -O3 and anything else added, e.g. -O2 -pthread ...]
# The default optimisation is -O3 unless the extra flags contain another -O level. Not patched with patch-glue.mjs,
# so glue sizes are a little different from dist/ (the patch adds a few hundred bytes).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
name=$1; src=$2; shift 2
opt=-O3; extra=()
for f in "$@"; do case "$f" in -O*) opt=$f;; *) extra+=("$f");; esac; done
mkdir -p "$here/build"; echo '{"type":"commonjs"}' > "$here/build/package.json"
EXPORTS="['_library_version','_unpremultiply','_premultiply','_get_clustering','_clustering_job_start','_clustering_job_step','_clustering_job_result','_clustering_job_free','_mapping_job_start','_mapping_job_step','_mapping_job_result','_mapping_job_free','_get_palette','_get_palette_from_clustering','_get_palette_weights','_quantize','_quantize_with_clustering','_quantize_with_palette','_quantize_indices','_quantize_indices_with_clustering','_quantize_indices_with_palette','_malloc','_free'${EXPORT_EXTRA:-}]"
em++ "$src" $opt -msimd128 -s WASM=1 -s MODULARIZE=1 -s EXPORT_ES6=1 -s EXPORT_NAME='createWasmModule' -s ALLOW_MEMORY_GROWTH=1 -s INITIAL_MEMORY=32MB -s MAXIMUM_MEMORY=2147483648 \
  -s EXPORTED_FUNCTIONS="$EXPORTS" -s EXPORTED_RUNTIME_METHODS="['HEAPU8']" "${extra[@]}" -o "$here/build/lib-$name.mjs"
ls -l "$here/build/lib-$name".{mjs,wasm} | awk '{print $5, $9}'
