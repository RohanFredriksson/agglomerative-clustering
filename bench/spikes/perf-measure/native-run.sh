#!/usr/bin/env bash
# Runs a command in the spike directory inside the container image (ubuntu with clang and valgrind): native-run.sh <cmd...>
# Env vars ROUNDS_THREADS, PARALLEL_MIN are passed on. --cpus is not limited.
here="$(cd "$(dirname "$0")" && pwd)"
exec podman run --rm -e ROUNDS_THREADS -e PARALLEL_MIN -e DUMP -e NO_CACHE -e CHAIN_REVERSE -v "$here:/spike:Z" -w /spike localhost/ac-native "$@"
