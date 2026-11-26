// OKLab and precision-6 WebAssembly timing table from results/wasm-config/<cfg>-<image>-<variant>[-2].txt (base twice: base, base-2).
import { readFileSync, existsSync } from 'fs';
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const t = (f) => { if (!existsSync(f)) return null; const x = readFileSync(f, 'utf8'); return { ms: med([...x.matchAll(/^RUN \d+ TOTAL ([\d.]+)/gm)].map((m) => +m[1])), hash: [...new Set([...x.matchAll(/^HASH (\w+)/gm)].map((m) => m[1]))].join(), load: [...x.matchAll(/load \w+: ([\d.]+)/g)].map((m) => m[1]).join('/') }; };
console.log('| config | image | base ms | base again | final ms | change (against the mean of the two bases) | identical | load (base, final, base) |'); console.log('|---|---|---:|---:|---:|---:|---|---|');
for (const cfg of ['oklab8', 'rgb6']) for (const img of ['k23', 'mos12', 'fern', 'night', 'up12']) {
    const b = t(`results/wasm-config/${cfg}-${img}-base.txt`), f = t(`results/wasm-config/${cfg}-${img}-final.txt`), b2 = t(`results/wasm-config/${cfg}-${img}-base-2.txt`);
    if (!b || !f || !b2) continue;
    console.log(`| ${cfg === 'oklab8' ? 'OKLab' : 'RGB precision 6'} | ${img} | ${b.ms.toFixed(0)} | ${b2.ms.toFixed(0)} | ${f.ms.toFixed(0)} | ${((f.ms / ((b.ms + b2.ms) / 2) - 1) * 100).toFixed(0)}% | ${b.hash === f.hash && b.hash === b2.hash ? 'yes' : '**NO**'} | ${b.load} ; ${f.load} ; ${b2.load} |`);
}
