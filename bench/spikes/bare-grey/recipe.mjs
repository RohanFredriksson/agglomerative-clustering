// The best recipe today: turn fast-png results into images the library takes (what the guides leave the user to write
// "use a decoder that expands" leaves the user to write when they want fast-png). Checked on the decoders.mjs files
// through dist/, and timed.
//   node bench/spikes/bare-grey/recipe.mjs > bench/spikes/bare-grey/results-recipe.txt
import { createRequire } from 'node:module';
import { buildPalette } from '../../../dist/index.mjs';

const require = createRequire(new URL('../decoding/package.json', import.meta.url));
const fastPng = await import(require.resolve('fast-png'));
const sharp = (await import(require.resolve('sharp'))).default;

// The recipe, as the spec puts it in the guides: any fast-png result the library takes, as an image; palette, 16-bit and
// packed PNGs refused.
function fastPngToImage({ data, width, height, channels, depth, palette }) {
    if (palette || depth !== 8) {throw new Error('needs a decoder that expands palette, 16-bit and packed PNGs (pngjs)');}
    if (channels === 4) {return { data, format: 'rgba', width, height };}
    if (channels === 3) {return { data, format: 'rgb', width, height };}
    const out = new Uint8Array(width * height * 4);
    for (let p = 0; p < width * height; p++) {
        out[4 * p] = out[4 * p + 1] = out[4 * p + 2] = data[p * channels];
        out[4 * p + 3] = channels === 2 ? data[p * 2 + 1] : 255;
    }
    return { data: out, format: 'rgba', width, height };
}

const src = new URL('../../../fixtures/images/kodim23.png', import.meta.url).pathname;
for (const [label, size] of [['768×512', null], ['12 MP (4240×2832)', [4240, 2832]]]) {
    let img = sharp(src).greyscale();
    if (size) {img = img.resize(...size);}
    const { data: g, info } = await img.raw().toBuffer({ resolveWithObject: true });
    const ga = new Uint8Array(g.length * 2);
    for (let p = 0; p < g.length; p++) {ga[2 * p] = g[p]; ga[2 * p + 1] = Math.round(255 * (1 - (p % info.width) / (info.width - 1)));}
    for (const [kind, data, channels] of [['grey', g, 1], ['grey + alpha', ga, 2]]) {
        const decoded = fastPng.decode(fastPng.encode({ width: info.width, height: info.height, data, channels, depth: 8 }));
        let rgba;
        const t0 = performance.now(); for (let i = 0; i < 20; i++) {rgba = fastPngToImage(decoded).data;} const ms = (performance.now() - t0) / 20;
        const t1 = performance.now(); const palette = await buildPalette({ data: rgba, format: 'rgba', width: info.width, height: info.height }, 16); const pms = performance.now() - t1;
        const greys = [...Array(palette.length / 3).keys()].every((i) => palette[3 * i] === palette[3 * i + 1] && palette[3 * i] === palette[3 * i + 2]);
        console.log(`${label.padEnd(18)} ${kind.padEnd(13)} expand ${ms.toFixed(1)} ms; buildPalette ${pms.toFixed(0)} ms; palette all grey: ${greys}`);
    }
}

// Every kind of fast-png result: taken (and palettes equal to the image passed correctly) or refused.
{
    const { data: rgb, info } = await sharp(src).raw().toBuffer({ resolveWithObject: true });
    const { width, height } = info;
    const rgba = new Uint8Array(width * height * 4);
    for (let p = 0; p < width * height; p++) {rgba.set(rgb.subarray(3 * p, 3 * p + 3), 4 * p); rgba[4 * p + 3] = 255;}
    const enc = (o) => fastPng.decode(fastPng.encode({ width, height, depth: 8, ...o }));
    const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
    const cases = {
        'rgba (channels 4)': [enc({ data: rgba, channels: 4 }), { data: rgba, format: 'rgba' }],
        'rgb (channels 3)': [enc({ data: new Uint8Array(rgb), channels: 3 }), { data: new Uint8Array(rgb), format: 'rgb' }],
    };
    for (const [name, [decoded, truth]] of Object.entries(cases)) {
        const a = await buildPalette(fastPngToImage(decoded), 16), b = await buildPalette({ ...truth, width, height }, 16);
        console.log(`${name.padEnd(20)} palette identical to the image passed correctly: ${same(a, b)}`);
    }
    const refused = {
        'palette PNG': fastPng.decode(await sharp(src).png({ palette: true, colours: 256 }).toBuffer()),
        '16-bit grey': fastPng.decode(fastPng.encode({ width, height, data: new Uint16Array(width * height), channels: 1, depth: 16 })),
        '1-bit grey': fastPng.decode(fastPng.encode({ width, height, data: new Uint8Array(Math.ceil(width / 8) * height), channels: 1, depth: 1 })),
    };
    for (const [name, decoded] of Object.entries(refused)) {
        try {fastPngToImage(decoded); console.log(`${name.padEnd(20)} ACCEPTED (wrong)`);} catch (e) {console.log(`${name.padEnd(20)} refused: ${e.message}`);}
    }
}
