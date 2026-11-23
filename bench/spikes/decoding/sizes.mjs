// Sizes of the decoders a built-in could bundle, raw and gzipped (level 9), against the library's own module.
// node sizes.mjs > results-sizes.txt
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { createRequire } from 'node:module';
import { buildSync } from 'esbuild';

const require = createRequire(import.meta.url);
const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
const report = (name, bytes) => console.log(`${name.padEnd(40)} ${kb(bytes.length).padStart(10)} raw  ${kb(gzipSync(bytes, { level: 9 }).length).padStart(9)} gzipped`);

report('agglomerative-clustering .wasm', readFileSync(new URL('../../../dist/clustering.wasm', import.meta.url)));
for (const [name, path] of [['@jsquash/png decoder .wasm', '@jsquash/png/codec/pkg/squoosh_png_bg.wasm'], ['@jsquash/jpeg decoder .wasm', '@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm'],
    ['@jsquash/webp decoder .wasm', '@jsquash/webp/codec/dec/webp_dec.wasm'], ['@jsquash/avif decoder .wasm', '@jsquash/avif/codec/dec/avif_dec.wasm']]) {
    report(name, readFileSync(require.resolve(path)));
}
for (const name of ['fast-png', 'jpeg-js', 'omggif', 'pngjs']) {
    try {
        const out = buildSync({ stdin: { contents: `import * as m from '${name}'; globalThis.m = m;`, resolveDir: process.cwd() }, bundle: true, minify: true, platform: 'browser', format: 'esm', write: false, logLevel: 'silent' });
        report(`${name} (bundled for the browser, minified)`, out.outputFiles[0].contents);
    } catch (error) {console.log(`${name.padEnd(40)} doesn't bundle for the browser: ${error.errors?.[0]?.text}`);}
}
