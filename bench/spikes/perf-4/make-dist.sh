#!/usr/bin/env bash
# A dist-like folder for a variant: build/dist-<variant>/ is a copy of the repo's dist/ with clustering.js and clustering.wasm built from
# the variant's source with the shipped build:wasm flags and the same glue patch (scripts/patch-glue.mjs, pointed at the copy).
# Usage: make-dist.sh <variant>. Needs em++ (sourced from ~/.local/share/emsdk).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"; cd "$here"; root="$(cd ../../.. && pwd)"
v=$1
./build.sh $v lib
d=build/dist-$v; rm -rf $d; cp -r "$root/dist" $d
cp build/$v/lib/clustering.js build/$v/lib/clustering.wasm $d/
sed -e "s#'../dist/clustering.js'#'./dist-$v/clustering.js'#" -e "s#'../dist/clustering.cjs'#'./dist-$v/clustering.cjs'#" "$root/scripts/patch-glue.mjs" > build/patch-glue-$v.mjs
echo '{"type":"module"}' > $d/package.json
node build/patch-glue-$v.mjs
ls -l $d/clustering.wasm | awk '{print "wasm bytes", $5}'
