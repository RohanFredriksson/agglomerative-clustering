#!/usr/bin/env bash
# Runs a command in the ac-native container (ubuntu 24.04, clang 18, valgrind) from this directory, with ../ mounted at /spikes.
here="$(cd "$(dirname "$0")" && pwd)"
exec podman run --rm -e DUMP -e OMP_NUM_THREADS -v "$(dirname "$here"):/spikes:z" -w /spikes/perf-4 localhost/ac-native "$@"
