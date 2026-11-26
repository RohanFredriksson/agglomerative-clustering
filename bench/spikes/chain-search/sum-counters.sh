#!/usr/bin/env bash
# One line of totals from a counters driver's output: sum-counters.sh <driver> <image> [space prec]  (image name in data/)
./native-run.sh $1 data/$2.rgba ${3:-0} ${4:-8} 1 | awk -v n="$1 $2" '/^RUN/{t=$4} /^HASH/{h=$2} /^C cat .* limit/{ex+=$7; cv+=$11; cs+=$15; ce+=$17} END{printf "%-32s ms %8s hash %s examined %11d cells %10d chunks %10d exact %9d\n", n, t, h, ex, cv, cs, ce}'
