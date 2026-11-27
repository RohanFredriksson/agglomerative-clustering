#!/usr/bin/env bash
# Native slice spike in the ac-native container: ./run.sh <raw dir>
here="$(cd "$(dirname "$0")" && pwd)"
"$here/make-inst.sh"
exec podman run --rm -v "$here:/w:z" -v "$1:/raw:z" -w /w localhost/ac-native bash -c 'clang++ -std=c++17 -O2 driver.cpp -o /tmp/drv && for i in block dark noise; do for cs in 0 1; do echo $i cs=$cs; /tmp/drv /raw/$i.rgba $cs; done; done'
