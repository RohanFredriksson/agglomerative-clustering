// The largest image of all-different colours each allocator can cluster within the 2 GB WebAssembly memory limit:
// pixel i gets colour (i × 2654435761) mod 2^24, a bijection, so every pixel is a new colour. ROADMAP "Smaller
// WebAssembly, further" recorded emmalloc failing at 11 MP where dlmalloc succeeded.
//   node bench/spikes/wasm-size/distinct.mjs <dist dir> <megapixels>...
// MODE=oklab clusters in OKLab, MODE=sliced passes a signal (the sliced path), MODE=quantize maps too, MODE=alpha gives
// every pixel a partial alpha (weights in 1/255 pixel).
const l = await import(new URL(`${process.argv[2].replace(/\/$/, '')}/index.mjs`, `file://${process.cwd()}/`).href);
for (const mp of process.argv.slice(3).map(Number)) {
    const n = Math.round(mp * 1e6), data = new Uint8Array(n * 4);
    const mode = process.env.MODE ?? 'rgb';
    for (let i = 0; i < n; i++) {const c = Math.imul(i, 2654435761) >>> 8; data[4 * i] = c >>> 16; data[4 * i + 1] = (c >>> 8) & 255; data[4 * i + 2] = c & 255; data[4 * i + 3] = mode === 'alpha' ? 1 + (i % 254) : 255;}
    const image = { data, format: 'rgba', width: 1000 };
    const options = mode === 'oklab' ? { colorSpace: 'oklab' } : mode === 'sliced' ? { signal: new AbortController().signal } : {};
    const t = performance.now();
    try {
        if (mode === 'quantize') {await l.quantize(image, 256);} else {await l.buildClustering(image, options);}
        console.log(`${mode} ${mp} MP: ok, ${((performance.now() - t) / 1000).toFixed(0)} s`);
    } catch (e) {console.log(`${mode} ${mp} MP: ${e.code} ${e.message.slice(0, 100)}`);}
}
