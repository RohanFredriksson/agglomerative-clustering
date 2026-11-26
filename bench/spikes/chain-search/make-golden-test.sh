#!/usr/bin/env bash
# The repo's golden test (test/golden.test.js, unchanged) copied here with its imports pointed at build/dist-<variant>/ and the repo's
# fixtures, then run with the repo's vitest against test/golden.json. Usage: make-golden-test.sh <variant>
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"; cd "$here"; root="$(cd ../../.. && pwd)"
v=$1
sed -e "s#'../dist/index.mjs'#'./build/dist-$v/index.mjs'#" -e "s#'../fixtures/kodak.js'#'../../../fixtures/kodak.js'#" -e "s#'./timeout.js'#'../../../test/timeout.js'#" -e "s#resolve(__dirname, 'golden.json')#resolve(__dirname, '../../../test/golden.json')#" "$root/test/golden.test.js" > build/golden-$v.test.js
cp build/golden-$v.test.js ./golden-$v.test.js
cat > build/vitest.golden.config.mjs <<CFG
import { defineConfig } from 'vitest/config';
export default defineConfig({ root: '$root', test: { include: ['bench/spikes/chain-search/golden-$v.test.js'], setupFiles: ['./test/setup.js'] } });
CFG
cd "$root" && npx vitest run --config bench/spikes/chain-search/build/vitest.golden.config.mjs 2>&1 | tail -15
rm -f "$here/golden-$v.test.js"
