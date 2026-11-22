// Run from the repo root after measure.mjs: node bench/spikes/linear-light/summarise.mjs <dir holding r2-<palette>.json>
import { readFileSync, existsSync } from 'fs';
const dir = process.argv[2];
const f = (v, d = 2) => v.toFixed(d);
for (const p of ['eink', 'bw', 'extracted']) {
    const path = `${dir}/r2-${p}.json`;
    if (!existsSync(path)) continue;
    const rows = JSON.parse(readFileSync(path, 'utf8'));
    console.log(`\n## ${p}  (24 photos: mean ΔE [min–max] · Y range · photos better than the 8-bit recipe · dark ramp ΔE)`);
    for (const method of ['fs', 'atkinson', 'ordered']) {
        const variants = [...new Set(rows.filter((r) => r.variant.startsWith(method + ' ')).map((r) => r.variant))];
        const recipe = new Map(rows.filter((r) => r.variant === `${method} | 8-bit recipe` && r.image !== 'dark ramp').map((r) => [r.image, r.dE]));
        for (const v of variants) {
            const ph = rows.filter((r) => r.variant === v && r.image !== 'dark ramp');
            const ramp = rows.find((r) => r.variant === v && r.image === 'dark ramp');
            const d = ph.map((r) => r.dE), Y = ph.map((r) => r.Y);
            const wins = ph.filter((r) => r.dE < recipe.get(r.image) - 1e-9).length;
            console.log(`${v.padEnd(32)} ${f(d.reduce((a, b) => a + b) / d.length).padStart(6)} [${f(Math.min(...d))}–${f(Math.max(...d))}]  Y ${f(Math.min(...Y))}–${f(Math.max(...Y))}  better ${String(wins).padStart(2)}/24${ramp ? `  ramp ${f(ramp.dE)}` : ''}`);
        }
    }
}
