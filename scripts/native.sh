#!/usr/bin/env bash
# Native builds of the C++ (no Emscripten), for what WebAssembly can't give:
#   scripts/native.sh fuzz [seconds]            build the libFuzzer targets in native/ with ASan and UBSan and run each
#                                               for `seconds` (default 60); a crash, a broken invariant or a clustering
#                                               that differs from the 4.0.0 reference fails
#   scripts/native.sh profile <image> [format] [precision] [color space]
#                                               one clustering under callgrind, printing its instruction count (an
#                                               image .png is converted to raw RGBA first; anything else is raw pixels)
# Needs clang++ with libFuzzer (Ubuntu: apt install clang; CI's ubuntu runners have it), and valgrind for profile.
# Without them locally, run it in a container:
#   podman run --rm -v "$PWD:/src:Z" -w /src ubuntu:24.04 bash -c 'apt-get update -qq && apt-get install -y -qq clang valgrind >/dev/null && scripts/native.sh fuzz 60'
# Corpora are kept in build/native/corpus (gitignored), seeded from fixtures/clusterings and native/seeds
# (Kodak crops in each format, and generated images for fuzz_identical, written by native/make-seeds.mjs).
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
out="$root/build/native"
cxx="${CXX:-clang++}"
mkdir -p "$out"

case "${1:-}" in
    fuzz)
        seconds="${2:-60}"
        flags=(-std=c++17 -O1 -g -fsanitize=fuzzer,address,undefined -fno-sanitize-recover=undefined)
        targets=(fuzz_clustering_bytes fuzz_images fuzz_identical)
        for target in "${targets[@]}"; do
            # fuzz_identical also links the 4.0.0 code it compares against (native/reference/, in its own namespace).
            extra=()
            if [[ "$target" == fuzz_identical ]]; then extra=("$root/native/reference/reference.cpp"); fi
            "$cxx" "${flags[@]}" "$root/native/$target.cpp" "${extra[@]}" -o "$out/$target"
        done
        mkdir -p "${targets[@]/#/$out/corpus/}"
        cp "$root"/fixtures/clusterings/*.bin "$out/corpus/fuzz_clustering_bytes/"
        cp "$root"/native/seeds/fuzz_images/* "$out/corpus/fuzz_images/"
        cp "$root"/fixtures/clusterings/*.bin "$root"/native/seeds/fuzz_images/* "$root"/native/seeds/fuzz_identical/* "$out/corpus/fuzz_identical/"
        for target in "${targets[@]}"; do
            echo "== $target, ${seconds} s"
            "$out/$target" "$out/corpus/$target" -max_total_time="$seconds" -max_len=20000 -rss_limit_mb=2048 -timeout=30 -print_final_stats=1
        done
        ;;
    profile)
        image="${2:?usage: scripts/native.sh profile <image> [format] [precision] [color space]}"
        "$cxx" -std=c++17 -O2 -g "$root/native/profile.cpp" -o "$out/profile"
        raw="$image"
        if [[ "$image" == *.png ]]; then
            raw="$out/$(basename "$image" .png).rgba"
            (cd "$root" && node --input-type=module -e "
                import { getImageRgba } from './fixtures/kodak.js';
                import { writeFileSync } from 'fs';
                writeFileSync(process.argv[2], (await getImageRgba(process.argv[1])).rgba);" "$image" "$raw")
        fi
        valgrind --tool=callgrind --callgrind-out-file="$out/callgrind.out" "$out/profile" "$raw" "${@:3}" 2>&1 | grep -E 'Collected|bytes of pixels'
        echo "Per function: callgrind_annotate $out/callgrind.out | head -30"
        ;;
    *)
        sed -n '2,11p' "$0" | sed 's/^# \{0,1\}//'
        exit 2
        ;;
esac
