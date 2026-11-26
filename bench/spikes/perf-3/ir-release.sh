#!/usr/bin/env bash
# The instruction counts in CLAUDE.md: kodim23 clustered natively under callgrind (scripts/native.sh profile, clang 18 -O2) at full precision,
# precision 6 and OKLab, and WardGrid::search's exclusive share at full precision. Run from the repo root; needs podman and localhost/ac-native.
# Usage: bench/spikes/perf-3/ir-release.sh > bench/spikes/perf-3/results/ir-release.txt
exec podman run --rm -v "$PWD:/src:Z" -w /src localhost/ac-native bash -c '
for args in "0 8 0" "0 6 0" "0 8 1"; do
  echo "kodim23, format/precision/space $args"; scripts/native.sh profile fixtures/images/kodim23.png $args | grep Collected
done
scripts/native.sh profile fixtures/images/kodim23.png 0 8 0 > /dev/null
echo "exclusive, full precision:"; callgrind_annotate build/native/callgrind.out | grep -E "PROGRAM TOTALS|WardGrid::search" | head -2 | cut -c1-110'
