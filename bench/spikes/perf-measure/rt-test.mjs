// Question 4, other runtimes: what threads need (SharedArrayBuffer, shared WebAssembly.Memory, workers) and whether the
// -pthread build starts and gives the same bytes as the single-threaded call. Run with node, deno (run -A) and bun.
// Usage: <runtime> rt-test.mjs
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join } from 'path';
import { readFileSync } from 'fs';
const here = dirname(fileURLToPath(import.meta.url));
const out = {
    runtime: globalThis.Deno ? 'deno ' + Deno.version.deno : globalThis.Bun ? 'bun ' + Bun.version : 'node ' + process.version,
    SharedArrayBuffer: typeof SharedArrayBuffer, Worker: typeof Worker, crossOriginIsolated: String(globalThis.crossOriginIsolated),
};
try { new WebAssembly.Memory({ initial: 1, maximum: 2, shared: true }); out.sharedMemory = 'constructs'; } catch (e) { out.sharedMemory = String(e).slice(0, 80); }
const pixels = new Uint8Array(64 * 64 * 4).map((_, i) => (i * 7) & 255);
const palette = new Uint8Array([0, 0, 0, 255, 255, 255, 255, 0, 0, 0, 0, 255]);
async function run(file, threads) {
    const t0 = performance.now();
    try {
        const create = (await import(pathToFileURL(join(here, 'build', file)).href)).default;
        const M = await Promise.race([create(), new Promise((_, r) => setTimeout(() => r(new Error('timeout after 10 s')), 10000))]);
        const ip = M._malloc(pixels.length); M.HEAPU8.set(pixels, ip);
        const pp = M._malloc(palette.length); M.HEAPU8.set(palette, pp);
        const r = M._quantize_with_palette_threaded ? M._quantize_with_palette_threaded(ip, pixels.length, 0, pp, palette.length, 0, 0, 0, 0, 64, threads) : M._quantize_with_palette(ip, pixels.length, 0, pp, palette.length, 0, 0, 0, 0, 64);
        const bytes = M.HEAPU8.slice(r + 4, r + 4 + pixels.length);
        return { ok: true, ms: Math.round(performance.now() - t0), sum: bytes.reduce((a, b) => (a * 31 + b) >>> 0, 7) };
    } catch (e) { return { ok: false, error: String(e && e.message || e).slice(0, 160) }; }
}
out.single = await run('lib-base.mjs', 1);
out.threaded = await run('lib-threaded.mjs', 4);
out.sameBytes = out.single.ok && out.threaded.ok ? out.single.sum === out.threaded.sum : null;
console.log(JSON.stringify(out));
process.exit?.(0);
