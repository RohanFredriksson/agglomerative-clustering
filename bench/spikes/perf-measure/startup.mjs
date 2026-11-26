// Questions 4 and 5: time from process start to first result for a tiny image in Node 24, one fresh process per sample.
// Variants (builds from build-lib.sh): base (the shipped module through its glue), pthread4/pthread8 (the same with
// -pthread and a pool of 4 / 8 workers: the pool is started at load), and dist (the public API: import, init, call).
// Also, in one process, compiling the .wasm from bytes against instantiating a compiled WebAssembly.Module.
// Usage: node startup.mjs [samples]
import { spawnSync } from 'child_process';
import { readFileSync } from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join } from 'path';
const here = dirname(fileURLToPath(import.meta.url));
const [, , mode, variant] = process.argv;
const median = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];
const pixels = new Uint8Array(8 * 8 * 4).map((_, i) => (i * 37) & 255);
const palette = new Uint8Array([0, 0, 0, 255, 255, 255]);
if (mode === 'child') {
    const t0 = performance.now(); // ms since this process's time origin: includes Node's own boot (≈ 30-40 ms, same for all)
    let result;
    if (variant === 'dist') {
        const lib = await import(pathToFileURL(join(here, '../../../dist/index.mjs')).href);
        const t1 = performance.now();
        await lib.init();
        const t2 = performance.now();
        await lib.quantizeWithPalette({ data: pixels, format: 'rgba', width: 8, height: 8 }, palette);
        const t3 = performance.now();
        result = { boot: t0, import: t1 - t0, load: t2 - t1, first: t3 - t2, total: t3 };
    } else {
        const create = (await import(pathToFileURL(join(here, `build/lib-${variant}.mjs`)).href)).default;
        const t1 = performance.now();
        const M = await create();
        const t2 = performance.now();
        const ip = M._malloc(pixels.length); M.HEAPU8.set(pixels, ip);
        const pp = M._malloc(palette.length); M.HEAPU8.set(palette, pp);
        M._free(M._quantize_with_palette(ip, pixels.length, 0, pp, palette.length, 0, 0, 0, 0, 8, 0));
        const t3 = performance.now();
        result = { boot: t0, import: t1 - t0, load: t2 - t1, first: t3 - t2, total: t3 };
    }
    console.log(JSON.stringify(result));
    process.exit(0);
}
if (mode === 'module') {
    // compile from bytes vs instantiate a compiled module, same process, through the glue's instantiateWasm hook
    const create = (await import(pathToFileURL(join(here, 'build/lib-base.mjs')).href)).default;
    const bytes = readFileSync(join(here, 'build/lib-base.wasm'));
    const fromBytes = [], fromModule = [], compile = [];
    let compiled = await WebAssembly.compile(bytes);
    for (let i = 0; i < 15; i++) {
        let s = performance.now();
        await create({ instantiateWasm: (info, ok) => { WebAssembly.instantiate(bytes, info).then((r) => ok(r.instance)); return {}; } });
        fromBytes.push(performance.now() - s);
        s = performance.now();
        await create({ instantiateWasm: (info, ok) => { WebAssembly.instantiate(compiled, info).then((inst) => ok(inst)); return {}; } });
        fromModule.push(performance.now() - s);
        s = performance.now(); compiled = await WebAssembly.compile(bytes); compile.push(performance.now() - s);
    }
    console.log(JSON.stringify({ compileFromBytes_ms_median: median(compile), createFromBytes_ms_median: median(fromBytes), createFromCompiledModule_ms_median: median(fromModule), note: 'same process: V8 may reuse its own compilation cache for identical bytes, so fromBytes is a lower bound for a cold process' }));
    process.exit(0);
}
const samples = +process.argv[2] || 15;
console.log('| variant | wall (spawn to exit, ms) | Node boot | import | load | first call | total in process |');
console.log('|---|---:|---:|---:|---:|---:|---:|');
for (const v of ['base', 'pthread4', 'pthread8', 'dist']) {
    const name = v === 'pthread4' ? 'pthread' : v === 'pthread8' ? 'threaded8' : v;
    const rows = [], walls = [];
    for (let i = 0; i < samples; i++) {
        const s = performance.now();
        const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), 'child', name], { encoding: 'utf8' });
        walls.push(performance.now() - s);
        try { rows.push(JSON.parse(r.stdout.trim().split('\n').pop())); } catch { console.error(v, r.stderr.slice(0, 300)); }
    }
    const m = (k) => median(rows.map((r) => r[k])).toFixed(0);
    console.log(`| ${v} | ${median(walls).toFixed(0)} | ${m('boot')} | ${m('import')} | ${m('load')} | ${m('first')} | ${m('total')} |`);
}
const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), 'module'], { encoding: 'utf8' });
console.log('\nmodule cache:', r.stdout.trim());
