#!/usr/bin/env bash
# Mapping identity: for each image x space (RGB, OKLab) x k (2,16,64,256) x dither (none, floyd-steinberg, atkinson, ordered) x output (colours, indices),
# the output hash of <variant>'s native mapdriver against the shipped 4.1.0's (build/base). Usage: map-identity.sh <variant> [images]
# Output: results/map-identity-<variant>.txt (one line per case, "same"/"DIFFERENT") and a total. Photos are 16 to 24 MP: this takes a few minutes.
cd "$(dirname "$0")"
v=$1; shift; imgs=${*:-"k23 k03 k20 night fern sky wk pip"}
out=results/map-identity-$v.txt; : > $out
./native-run.sh env KS="${KS:-2 16 64 256}" bash -c '
export KS="${KS:-2 16 64 256}"; v='$v'; imgs="'"$imgs"'"
width() { python3 -c "import json;print(json.load(open(\"data/images.json\"))[\"$1\"][\"width\"])"; }
for img in $imgs; do for sp in 0 1; do for k in $KS; do
  export PALFILE=build/prof/pal-id-$img-s$sp-k$k.bin; rm -f $PALFILE
  for m in -1 0 1 2; do for ind in 0 1; do
    a=$(build/base/mapdriver-native data/$img.rgba $(width $img) $sp $k $m 1 $ind | grep HASH)
    b=$(build/$v/mapdriver-native data/$img.rgba $(width $img) $sp $k $m 1 $ind | grep HASH)
    if [ -z "$a" ]; then r=FAILED; elif [ "$a" = "$b" ]; then r=same; else r=DIFFERENT; fi
    echo "$img space$sp k$k method$m indices$ind $r"
  done; done
done; done; done' > $out
echo "$(grep -c " same" $out) same, $(grep -c DIFFERENT $out) different, $(grep -c FAILED $out) failed, of $(wc -l < $out) cases"
