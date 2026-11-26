#!/usr/bin/env bash
# Part A, instruction counts: the previous spike's native instrumented build (/spikes/perf-measure/build/driver-callgrind: it dumps and
# zeroes callgrind's counters at each stage boundary) on one image. Output results/callgrind-stages/<image>-<rgb8|rgb6>.txt
# (stage, Ir, share). Usage: run-callgrind-stages.sh <image> <space> <precision>
here="$(cd "$(dirname "$0")" && pwd)"; cd "$here"
img=$1; space=${2:-0}; prec=${3:-8}; cfg=rgb$prec; [ $space = 1 ] && cfg=oklab$prec
d=build/cgs-$img-$cfg; rm -rf $d; mkdir -p $d results/callgrind-stages
./native-run.sh valgrind --tool=callgrind --callgrind-out-file=$d/out /spikes/perf-measure/build/driver-callgrind data/$img.rgba $space $prec 1 > $d/log.txt 2>&1
node -e '
const fs=require("fs");const d=process.argv[1];
const files=fs.readdirSync(d).filter(f=>/^out\.\d+$/.test(f)).sort((a,b)=>+a.slice(4)-+b.slice(4));
const rows=[];
for(const f of files){const t=fs.readFileSync(d+"/"+f,"utf8");const m=t.match(/^desc: Trigger: Client Request: (.+)$/m);const s=t.match(/^(?:summary|totals): (\d+)/m);rows.push([m?m[1]:"?",s?+s[1]:0]);}
const tot=rows.reduce((a,r)=>a+r[1],0);
for(const [n,v] of rows)console.log(n.padEnd(14),String(v).padStart(14),(100*v/tot).toFixed(1)+"%");
console.log("total".padEnd(14),String(tot).padStart(14));
' $d > results/callgrind-stages/$img-$cfg.txt
