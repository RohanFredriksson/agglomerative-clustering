#!/usr/bin/env bash
# Runs a command inside the container image of the last spike (ubuntu 24.04 with clang 18 and valgrind), in this directory,
# with ../ mounted so the symlinks into ../perf-measure/data resolve. Usage: native-run.sh <cmd...>
here="$(cd "$(dirname "$0")" && pwd)"
exec podman run --rm -e DUMP -e OMP_NUM_THREADS -v "$(dirname "$here"):/spikes:z" -w /spikes/chain-search localhost/ac-native "$@"
