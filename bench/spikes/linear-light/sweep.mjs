import { resolve } from 'path';
import { writeFileSync } from 'fs';
import { dirname } from 'path';
import { fileURLToPath } from 'url';
// Run from the repo root: node bench/spikes/linear-light/sweep.mjs <eink|extracted>  (writes sweep-<palette>.json here)
const repo = process.cwd(), S = dirname(fileURLToPath(import.meta.url)), pname = process.argv[2];
const L = await import(resolve(S, 'linear-lib.mjs'));
const src = await import('fs').then((fs) => fs.readFileSync(resolve(S, 'measure.mjs'), 'utf8'));
const { meanDeltaE } = await import(resolve(repo, 'bench/lib/metrics.js'));
const { buildPalette } = await import(resolve(repo, 'dist/index.mjs'));
const { getImageRgba, IMAGES_DIR, KODAK_IMAGES } = await import(resolve(repo, 'fixtures/kodak.js'));
// blur and lum are not exported; rebuild them from the spike source
const blurLinear = new Function('LIN', 'enc', src.slice(src.indexOf('function blurLinear'), src.indexOf('const lum')) + 'return blurLinear;')(L.LIN, (l) => { l = Math.min(1, Math.max(0, l)); return 255 * (l <= 0.0031308 ? 12.92 * l : 1.055 * l ** (1 / 2.4) - 0.055); });
const eink = [0, 0, 0, 255, 255, 255, 0, 255, 0, 0, 0, 255, 255, 0, 0, 255, 255, 0, 255, 128, 0];
const Y = [0.2126, 0.7152, 0.0722], Cb = [-0.2126 / 1.8556, -0.7152 / 1.8556, 0.9278 / 1.8556], Cr = [0.7874 / 1.5748, -0.7152 / 1.5748, -0.0722 / 1.5748];
const rows = [];
for (const { name } of KODAK_IMAGES) {
    const { rgba, width } = await getImageRgba(resolve(IMAGES_DIR, name + '.png'));
    const data = Uint8Array.from(rgba);
    const palette = pname === 'eink' ? eink : Array.from(await buildPalette({ data, format: 'rgba', width }, 16));
    const ref = blurLinear(data, width);
    for (const w of [1, 1.5, 2, 3, 4, 6]) {
        const M = [Y, Cb.map((v) => v * w), Cr.map((v) => v * w)];
        rows.push({ image: name, w, method: 'fs', dE: meanDeltaE(ref, blurLinear(L.diffuse(data, width, palette, M, 'fs'), width)) });
        rows.push({ image: name, w, method: 'ordered', dE: meanDeltaE(ref, blurLinear(L.ordered(data, width, palette, M, 16), width)) });
    }
    console.error(name);
}
writeFileSync(resolve(S, `sweep-${pname}.json`), JSON.stringify(rows));
