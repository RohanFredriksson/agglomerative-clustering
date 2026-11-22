// Runs ditherInLight exactly as docs/api.md prints it: quality and brightness on the 24 Kodak photos (against dithering
// the sRGB values), and timing. Run from the repo root: node bench/spikes/linear-light/recipe.mjs > results-recipe.txt
import { readFileSync } from 'fs';
import { resolve } from 'path';
const repo = process.cwd();
const lib = await import(resolve(repo, 'dist/index.mjs'));
const { meanDeltaE } = await import(resolve(repo, 'bench/lib/metrics.js'));
const { getImageRgba, IMAGES_DIR, KODAK_IMAGES } = await import(resolve(repo, 'fixtures/kodak.js'));
const doc = readFileSync(resolve(repo, 'docs/api.md'), 'utf8').split('\n');
const start = doc.findIndex((l) => l.startsWith('async function ditherInLight('));
const end = doc.findIndex((l, i) => i > start && l === '}');
const fn = new Function('quantizeToIndicesWithPalette', doc.slice(start, end + 1).join('\n') + '\nreturn ditherInLight;')(lib.quantizeToIndicesWithPalette);
const src = readFileSync(new URL('./encoded-recipe.mjs', import.meta.url), 'utf8');
const LIN = new Float64Array(256).map((_, i) => { const c = i / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
const enc = (l) => { l = Math.min(1, Math.max(0, l)); return 255 * (l <= 0.0031308 ? 12.92 * l : 1.055 * l ** (1 / 2.4) - 0.055); };
const blurLinear = new Function('LIN', 'enc', src.slice(src.indexOf('function blurLinear'), src.indexOf('const eink')) + 'return blurLinear;')(LIN, enc);
const lum = (d) => {let s = 0; for (let i = 0; i < d.length; i += 4) s += 0.2126 * LIN[d[i]] + 0.7152 * LIN[d[i + 1]] + 0.0722 * LIN[d[i + 2]]; return s / (d.length / 4);};
const eink = [0, 0, 0, 255, 255, 255, 0, 255, 0, 0, 0, 255, 255, 0, 0, 255, 255, 0, 255, 128, 0], bw = [0, 0, 0, 255, 255, 255];
const res = {};
for (const { name } of KODAK_IMAGES) {
    const { rgba, width } = await getImageRgba(resolve(IMAGES_DIR, name + '.png'));
    const data = Uint8Array.from(rgba), ref = blurLinear(data, width), y0 = lum(data);
    const extracted = Array.from(await lib.buildPalette({ data, format: 'rgba', width }, 16));
    for (const [p, inks] of [['eink', eink], ['bw', bw], ['extracted16', extracted]]) for (const dither of [true, 'ordered']) for (const how of ['srgb', 'light']) {
        const { indices } = how === 'light' ? await fn({ data, width }, inks, { dither }) : await lib.quantizeToIndicesWithPalette({ data, format: 'rgba', width }, inks, { dither });
        const out = new Uint8Array(data.length);
        for (let q = 0; q < indices.length; q++) {const j = indices[q]; out.set([inks[3 * j], inks[3 * j + 1], inks[3 * j + 2], 255], 4 * q);}
        const k = `${p} ${dither === true ? 'floyd-steinberg' : dither} ${how}`; (res[k] ||= { dE: [], Y: [] }); res[k].dE.push(meanDeltaE(ref, blurLinear(out, width))); res[k].Y.push(lum(out) / y0);
    }
}
for (const [k, v] of Object.entries(res)) console.log(k.padEnd(34), 'ΔE', (v.dE.reduce((a, b) => a + b) / v.dE.length).toFixed(2), 'Y', Math.min(...v.Y).toFixed(2), '-', Math.max(...v.Y).toFixed(2));
// timing: the conversion alone (the function minus the library call) and the whole call
const time = async (w, h) => {
    const data = new Uint8Array(w * h * 4); for (let i = 0; i < data.length; i++) data[i] = (i * 2654435761) >>> 24;
    await fn({ data, width: w }, eink); // warm
    let t = performance.now(); await fn({ data, width: w }, eink); const whole = performance.now() - t;
    const stub = new Function('quantizeToIndicesWithPalette', doc.slice(start, end + 1).join('\n') + '\nreturn ditherInLight;')(async () => ({ palette: new Uint8Array(21) }));
    await stub({ data, width: w }, eink); t = performance.now(); await stub({ data, width: w }, eink); const conv = performance.now() - t;
    console.log(`${w}x${h}: conversion ${conv.toFixed(0)} ms (${(conv * 1e6 / (w * h)).toFixed(1)} ns a pixel), whole call ${whole.toFixed(0)} ms`);
};
await time(768, 512); await time(3840, 2160);
