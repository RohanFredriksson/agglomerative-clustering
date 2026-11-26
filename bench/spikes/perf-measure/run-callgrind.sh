#!/usr/bin/env bash
# Instruction counts per stage (native, clang -O2, callgrind): dumps stats at each STAMP in the instrumented source and
# zeroes them, so each stage's Ir is its own. Usage: run-callgrind.sh <image> [space] [precision]. Output: results/callgrind-<image>-<cfg>.txt
here="$(cd "$(dirname "$0")" && pwd)"; cd "$here"
img=$1; space=${2:-0}; prec=${3:-8}
d=build/cg-$img-$space-$prec; rm -rf $d; mkdir -p $d results
./native-run.sh valgrind --tool=callgrind --callgrind-out-file=$d/out build/driver-callgrind data/$img.rgba $space $prec 1 ${MAP:+map $(node -e "console.log(require(\"./data/images.json\").$img.width)")} > $d/log.txt 2>&1
node -e '
const fs=require("fs");const d=process.argv[1];
const files=fs.readdirSync(d).filter(f=>/^out\.\d+$/.test(f)).sort((a,b)=>+a.slice(4)-+b.slice(4));
const names=[];
let rows=[];
for(const f of files){const t=fs.readFileSync(d+"/"+f,"utf8");const m=t.match(/^desc: Trigger: Client Request: (.+)$/m);const s=t.match(/^(?:summary|totals): (\d+)/m);rows.push([m?m[1]:"?",s?+s[1]:0]);}
const tot=rows.reduce((a,r)=>a+r[1],0);
for(const [n,v] of rows)console.log(n.padEnd(14),String(v).padStart(14),(100*v/tot).toFixed(1)+"%");
console.log("total".padEnd(14),String(tot).padStart(14));
' $d > results/callgrind-$img-rgb$space-p$prec.txt
cat results/callgrind-$img-rgb$space-p$prec.txt
