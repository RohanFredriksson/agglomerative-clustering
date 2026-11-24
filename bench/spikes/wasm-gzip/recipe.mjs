// The recipe a single-file host (Figma, Obsidian, a VS Code webview) can follow today to embed the module gzipped:
// gzip dist/clustering.wasm at build time, embed it with esbuild's binary loader, decompress it with
// DecompressionStream and pass the bytes to init({ wasm }). Builds the bundle both ways (raw and gzipped .wasm), runs
// each in Node to check it clusters, and reports the bundle sizes (as shipped, as base64, and gzipped) and the time to
// decompress and load.
//   node bench/spikes/wasm-gzip/recipe.mjs > bench/spikes/wasm-gzip/results-recipe.txt
import { build } from 'esbuild';
import { gzipSync } from 'node:zlib';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const root = new URL('../../../', import.meta.url).pathname, out = `${root}build/wasm-gzip`;
mkdirSync(out, { recursive: true });
const wasm = readFileSync(`${root}dist/clustering.wasm`);
// The build step a user adds: one line.
writeFileSync(`${out}/clustering.wasm.gz`, gzipSync(wasm, { level: 9 }));

const entries = {
    raw: `
import wasm from ${JSON.stringify(`${root}dist/clustering.wasm`)};
import { init, buildPalette } from ${JSON.stringify(`${root}dist/index.mjs`)};
const t0 = performance.now();
await init({ wasm });
const ms = performance.now() - t0;
const palette = await buildPalette(new Uint8Array(64 * 64 * 4).map((_, i) => i * 7), 4);
console.log(JSON.stringify({ ms, colours: palette.length / 3 }));`,
    gzipped: `
import gz from ${JSON.stringify(`${out}/clustering.wasm.gz`)};
import { init, buildPalette } from ${JSON.stringify(`${root}dist/index.mjs`)};
const t0 = performance.now();
// The recipe's runtime part: three lines.
const stream = new Blob([gz]).stream().pipeThrough(new DecompressionStream('gzip'));
const wasm = new Uint8Array(await new Response(stream).arrayBuffer());
const decompress = performance.now() - t0;
await init({ wasm });
const ms = performance.now() - t0;
const palette = await buildPalette(new Uint8Array(64 * 64 * 4).map((_, i) => i * 7), 4);
console.log(JSON.stringify({ ms, decompress, colours: palette.length / 3 }));`,
};
const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
console.log('bundle (esbuild --bundle --format=esm --minify, .wasm embedded with the binary loader, so it is base64 in the bundle)');
console.log('                  bundle        bundle gzipped   decompress + init, in a fresh Node process (median of 5 runs)');
for (const [name, code] of Object.entries(entries)) {
    writeFileSync(`${out}/${name}.entry.mjs`, code);
    await build({ entryPoints: [`${out}/${name}.entry.mjs`], bundle: true, format: 'esm', minify: true, platform: 'neutral', target: 'es2022',
        loader: { '.wasm': 'binary', '.gz': 'binary' }, outfile: `${out}/${name}.bundle.mjs`, logLevel: 'error',
        external: ['node:*'], mainFields: ['module', 'main'] });
    const bundle = readFileSync(`${out}/${name}.bundle.mjs`);
    const { execFileSync } = await import('node:child_process');
    const runs = [], unzip = [];
    let colours = 0;
    for (let i = 0; i < 5; i++) {const r = JSON.parse(execFileSync('node', [`${out}/${name}.bundle.mjs`], { encoding: 'utf8' }).trim()); runs.push(r.ms); unzip.push(r.decompress ?? 0); colours = r.colours;}
    runs.sort((a, b) => a - b); unzip.sort((a, b) => a - b);
    console.log(`${name.padEnd(16)}  ${kb(bundle.length).padStart(9)}     ${kb(gzipSync(bundle, { level: 9 }).length).padStart(9)}       ${runs[2].toFixed(1)} ms, of which decompressing ${unzip[2].toFixed(1)} ms (clusters: ${colours === 4 ? 'yes' : 'no'})`);
}
console.log(`\nclustering.wasm ${wasm.length} bytes; gzip -9 ${gzipSync(wasm, { level: 9 }).length} bytes`);
