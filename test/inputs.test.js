// Inputs that exploratory testing of 3.0.0-beta.1 found handled badly: arrays changed after the call returned, a
// clustering or palette passed as the image, objects from another realm, detached buffers, empty palettes, and widths
// that don't fit the image.
import { describe, it, expect } from 'vitest';
import { resolve, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { runInNewContext } from 'vm';
import * as ac from '../dist/index.mjs';
import { createWorker } from '../dist/worker.mjs';

const dist = resolve(dirname(fileURLToPath(import.meta.url)), '../dist');
let copies = 0;
// A copy of the main entry that hasn't loaded its module yet.
const fresh = () => import(/* @vite-ignore */ `${pathToFileURL(resolve(dist, 'index.mjs')).href}?inputs=${copies++}`);

const solid = (rgb, pixels = 100) => {
    const data = new Uint8Array(pixels * 4);
    for (let p = 0; p < pixels; p++) {data.set([...rgb, 255], p * 4);}
    return data;
};
const red = [255, 0, 0], blue = [0, 0, 255];
const paint = (data, rgb) => {for (let p = 0; p < data.length / 4; p++) {data.set([...rgb, 255], p * 4);}};

describe('bytes are read when the call is made', () => {

    // A frame loop that reuses one buffer changes it right after each call: the result must be of the pixels at the call.
    it.each([
        ['before the module has loaded', fresh],
        ['once it has loaded', async () => {const entry = await fresh(); await entry.init(); return entry;}],
    ])('in the main entry, %s', async (_, entry) => {
        const lib = await entry();
        const image = solid(red);
        const palette = lib.buildPalette(image, 2);
        const indexed = lib.quantizeToIndices({ data: image, format: 'rgba', width: 10 }, 2, { dither: true });
        paint(image, blue);
        expect(Array.from(await palette)).toEqual(red);
        expect(Array.from((await indexed).palette)).toEqual(red);
    });

    it('in the main entry, with a signal (clustering in slices)', async () => {
        const image = solid(red);
        const palette = ac.buildPalette(image, 2, { signal: new AbortController().signal });
        paint(image, blue);
        expect(Array.from(await palette)).toEqual(red);
    });

    it('in the main entry, for clusterings and palettes', async () => {
        const lib = await fresh();
        const clustering = new Uint8Array(await ac.buildClustering(solid(red)));
        const palette = new Uint8Array(red);
        const cut = lib.getPaletteFromClustering(clustering, 2);
        const mapped = lib.quantizeWithPalette(solid(blue, 4), palette);
        clustering.fill(0);
        palette.set(blue);
        expect(Array.from(await cut)).toEqual(red);
        expect(Array.from((await mapped).subarray(0, 3))).toEqual(red);
    });

    // The methods forward to the function forms at once, so they take the bytes when called too.
    it('in the methods on Clustering', async () => {
        const clustering = new ac.Clustering(new Uint8Array(await ac.buildClustering(solid(red))));
        const image = solid(red);
        const mapped = clustering.quantize({ data: image, format: 'rgba', width: 10 }, 2, { dither: true });
        const indexed = clustering.quantizeToIndices(image, 2);
        const cut = clustering.getPalette(2);
        paint(image, blue);
        clustering.fill(0);
        expect(Array.from((await mapped).data.subarray(0, 4))).toEqual([...red, 255]);
        expect(Array.from((await indexed).palette)).toEqual(red);
        expect(Array.from(await cut)).toEqual(red);
    });

    it.each([
        ['a new worker', () => createWorker()],
        ['a new worker with transfer: true', () => createWorker({ transfer: true })],
    ])('in the worker entry, with %s', async (_, make) => {
        const worker = make();
        try {
            const image = solid(red);
            const first = worker.buildPalette(image, 2);
            if (image.length > 0) {paint(image, blue);}
            expect(Array.from(await first)).toEqual(red);
            const again = solid(red);
            const second = worker.buildPalette(again, 2);
            if (again.length > 0) {paint(again, blue);}
            expect(Array.from(await second)).toEqual(red);
        } finally {
            await worker.terminate();
        }
    });

});

describe('arguments in the wrong place', () => {

    it('rejects a clustering or a palette passed as the image', async () => {
        const clustering = await ac.buildClustering(solid(red));
        const palette = await ac.getPalette(solid(red), 2);
        for (const call of [() => ac.buildPalette(clustering, 4), () => ac.quantize(clustering, 4), () => ac.buildClustering(clustering)]) {
            await expect(call()).rejects.toMatchObject({ code: 'invalid-argument', argument: 'image', message: expect.stringContaining('getPaletteFromClustering') });
        }
        await expect(ac.buildPalette(palette, 4)).rejects.toMatchObject({ code: 'invalid-argument', argument: 'image', message: expect.stringContaining('palette') });
    });

});

describe('values from another realm', () => {

    // An iframe's ImageData has another realm's prototype; its tag still says what it is.
    it('takes an ImageData from another realm', async () => {
        const width = 5, height = 4;
        const data = new Uint8ClampedArray(width * height * 4).map((_, i) => (i * 37) & 255);
        const foreign = runInNewContext(`({ data: new Uint8ClampedArray(bytes), width: ${width}, height: ${height}, colorSpace: 'srgb', [Symbol.toStringTag]: 'ImageData' })`, { bytes: data });
        const local = new ImageData(new Uint8ClampedArray(data), width, height);
        expect(await ac.buildPalette(foreign, 3)).toEqual(await ac.buildPalette(local, 3));
        const mapped = await ac.quantize(foreign, 3, { dither: true });
        expect(mapped).toBeInstanceOf(ImageData);
        expect(mapped.data).toEqual((await ac.quantize(local, 3, { dither: true })).data);
        const worker = createWorker();
        try {
            expect(await worker.buildPalette(foreign, 3)).toEqual(await ac.buildPalette(local, 3));
        } finally {
            await worker.terminate();
        }
    });

});

describe('detached buffers', () => {

    const detach = (view) => {structuredClone(view.buffer, { transfer: [view.buffer] }); return view;};

    it('reports pixels whose buffer was transferred away, with a code', async () => {
        for (const make of [
            () => detach(solid(red)),
            () => ({ data: detach(solid(red)), format: 'rgba' }),
            () => {const image = new ImageData(new Uint8ClampedArray(solid(red)), 10, 10); detach(image.data); return image;},
        ]) {
            await expect(ac.getPalette(make(), 2)).rejects.toMatchObject({ code: 'invalid-argument', argument: 'image', message: expect.stringContaining('detached') });
        }
    });

});

describe('empty palettes', () => {

    it('rejects mapping visible pixels to an empty palette', async () => {
        await expect(ac.quantizeWithPalette(solid(red, 4), new Uint8Array(0))).rejects.toMatchObject({ code: 'invalid-argument', argument: 'palette' });
        await expect(ac.quantizeWithPalette({ data: new Uint8Array(6), format: 'rgb' }, [])).rejects.toMatchObject({ code: 'invalid-argument', argument: 'palette' });
    });

    it('still maps an image with no visible pixels, whose palette is empty', async () => {
        const clear = new Uint8Array(16);
        const palette = await ac.buildPalette(clear, 4);
        expect(palette.length).toBe(0);
        expect(Array.from(await ac.quantizeWithPalette(clear, palette))).toEqual(Array.from(clear));
    });

});

describe('width and height', () => {

    it('checks a width or height given alone, and options.width without dithering', async () => {
        const data = new Uint8Array(4 * 6);
        for (const bad of [{ width: 4 }, { width: 500 }, { height: 4 }, { width: 0 }]) {
            await expect(ac.buildPalette({ data, format: 'rgba', ...bad }, 2), JSON.stringify(bad)).rejects.toMatchObject({ code: 'invalid-argument', argument: 'image' });
        }
        for (const width of [4, 0, -5, 1.5]) {
            await expect(ac.quantize(data, 2, { width }), String(width)).rejects.toMatchObject({ code: 'invalid-argument', argument: 'options.width' });
        }
        expect((await ac.quantize({ data, format: 'rgba', width: 3 }, 2)).width).toBe(3);
        await expect(ac.quantize(data, 2, { width: 2 })).resolves.toBeInstanceOf(Uint8Array);
    });

});

describe('small things from the beta.1 testing', () => {

    // The worker entry once let these reach the structured clone, whose error says nothing about what to pass instead.
    it('the worker entry names a canvas, image element or Blob with the main entry\'s hint', async () => {
        const worker = createWorker();
        try {
            const canvas = { getContext: () => null, width: 4, height: 4 };
            for (const entry of [ac, worker]) {
                await expect(entry.buildPalette(canvas, 4)).rejects.toMatchObject({ code: 'invalid-argument', argument: 'image', message: expect.stringContaining('getImageData') });
            }
            await expect(worker.quantize({ nodeName: 'IMG', src: 'x.png' }, 4)).rejects.toMatchObject({ code: 'invalid-argument', argument: 'image', message: expect.stringContaining('canvas') });
        } finally {
            await worker.terminate();
        }
    });

    it('rejects options passed to the functions that read a clustering, in both entries and on handles', async () => {
        const clustering = await ac.buildClustering(solid(red));
        for (const call of [
            () => ac.getPaletteFromClustering(clustering, 4, { colorSpace: 'oklab' }),
            () => ac.getSwatchesFromClustering(clustering, 4, {}),
            () => ac.getClusteringInfo(clustering, { precision: 6 }),
        ]) {
            await expect(call()).rejects.toMatchObject({ code: 'invalid-argument', argument: 'options' });
        }
        expect(await ac.getPaletteFromClustering(clustering, 4, undefined)).toEqual(await ac.getPaletteFromClustering(clustering, 4));
        const worker = createWorker();
        try {
            await expect(worker.getPaletteFromClustering(clustering, 4, { dither: true })).rejects.toMatchObject({ code: 'invalid-argument', argument: 'options' });
            const handle = await worker.cluster(solid(red));
            await expect(handle.getPalette(4, { colorSpace: 'oklab' })).rejects.toMatchObject({ code: 'invalid-argument', argument: 'options' });
            await expect(handle.getSwatches(4, {})).rejects.toMatchObject({ code: 'invalid-argument' });
            expect(Array.from(await handle.getPalette(4))).toEqual(red);
        } finally {
            await worker.terminate();
        }
    });

    it('says when k is a string, and how to convert it', async () => {
        await expect(ac.getPalette(solid(red), '16')).rejects.toMatchObject({ code: 'invalid-argument', argument: 'k', message: expect.stringContaining('Got the string "16"') });
        await expect(ac.getPalette(solid(red), 2.5)).rejects.toThrow('Got 2.5');
        await expect(ac.getPalette(solid(red), null)).rejects.toThrow('Got null');
    });

    it('keeps the WebAssembly glue quiet when the module fails to load', async () => {
        const lib = await fresh();
        const logged = [];
        const original = [console.error, console.warn, console.log];
        console.error = console.warn = console.log = (...args) => logged.push(args.join(' '));
        try {
            await expect(lib.init({ wasm: resolve(dist, 'no-such-file.wasm') })).rejects.toMatchObject({ code: 'wasm-load-failed' });
        } finally {
            [console.error, console.warn, console.log] = original;
        }
        expect(logged).toEqual([]);
    });

});

// Found by the third round of exploratory testing (3.0.0-beta.3): a node-canvas ImageData under jsdom, palettes given as
// [r, g, b] colours, and messages that named the wrong problem.
describe('ImageData from another implementation', () => {

    it("returns a mapped image in the input's own ImageData class", async () => {
        // Like node-canvas's: a class of its own, not the global ImageData (which a DOM in Node may not have at all).
        class ImageData {
            constructor(data, width, height) {Object.assign(this, { data, width, height });}
            get [Symbol.toStringTag]() {return 'ImageData';}
        }
        const input = new ImageData(new Uint8ClampedArray(4 * 16).map((_, i) => (i * 53) & 255), 4, 4);
        for (const mapped of [await ac.quantize(input, 3), await ac.quantizeWithPalette(input, [0, 0, 0, 255, 255, 255])]) {
            expect(mapped).toBeInstanceOf(ImageData);
            expect(mapped.width).toBe(4);
            expect(mapped.data).toBeInstanceOf(Uint8ClampedArray);
        }
        const worker = createWorker();
        try {
            expect(await worker.quantize(input, 3)).toBeInstanceOf(ImageData);
        } finally {
            await worker.terminate();
        }
    });

    // Found by the fourth round (3.0.0-beta.4): skia-canvas's ImageData has no tag (it reads [object Object]) and isn't the
    // global class, so only its class name and shape say what it is.
    it('recognises an ImageData by its class name and shape, without the tag', async () => {
        class ImageData {
            constructor(data, width, height) {Object.assign(this, { data, width, height });}
        }
        const input = new ImageData(new Uint8ClampedArray(4 * 16).map((_, i) => (i * 53) & 255), 4, 4);
        expect(Object.prototype.toString.call(input)).toBe('[object Object]');
        expect(await ac.buildPalette(input, 3)).toEqual(await ac.buildPalette({ data: input.data, format: 'rgba' }, 3));
        expect(await ac.quantize(input, 3)).toBeInstanceOf(ImageData);
        const worker = createWorker();
        try {
            expect(await worker.quantize(input, 3)).toBeInstanceOf(ImageData);
        } finally {
            await worker.terminate();
        }
        // Not just any object of that name: it must have an ImageData's shape.
        class Other {constructor() {this.data = new Uint8Array(4); this.width = 1; this.height = 1;}}
        Object.defineProperty(Other, 'name', { value: 'ImageData' });
        await expect(ac.getPalette(new Other(), 1)).rejects.toMatchObject({ code: 'invalid-argument' });
    });

    // Found by the fifth round (3.0.0-beta.5): Chromium's ImageData can hold float16 pixels (pixelFormat: 'rgba-float16'),
    // which getPalette read as the bytes of the floats and quantize failed on without a code.
    it('rejects an ImageData whose pixels are not 8-bit RGBA, in both entries', async () => {
        class ImageData {
            constructor(width, height) {Object.assign(this, { data: new Float32Array(4 * width * height), width, height, pixelFormat: 'rgba-float16' });}
            get [Symbol.toStringTag]() {return 'ImageData';}
        }
        const input = new ImageData(2, 2);
        for (const call of [() => ac.buildPalette(input, 2), () => ac.quantize(input, 2), () => ac.quantizeToIndices(input, 2)]) {
            await expect(call()).rejects.toMatchObject({ code: 'invalid-argument', argument: 'image', message: expect.stringContaining("pixelFormat: 'rgba-float16'") });
        }
        const worker = createWorker();
        try {
            await expect(worker.buildPalette(input, 2)).rejects.toMatchObject({ code: 'invalid-argument', message: expect.stringContaining('rgba-unorm8') });
            await expect(worker.quantize(input, 2)).rejects.toMatchObject({ code: 'invalid-argument' });
        } finally {
            await worker.terminate();
        }
    });

});

describe('messages', () => {

    it('says to flatten a palette given as [r, g, b] colours, whatever their number', async () => {
        for (const colours of [[[255, 0, 0]], [[255, 0, 0], [0, 0, 255]], [[1, 2, 3], [4, 5, 6], [7, 8, 9], [10, 11, 12]]]) {
            await expect(ac.quantizeWithPalette(new Uint8Array(4), colours)).rejects.toMatchObject({ code: 'invalid-argument', argument: 'palette', message: expect.stringContaining('.flat()') });
        }
    });

    it('starts unsupported-version messages with "Unsupported clustering"', async () => {
        const error = await ac.getPaletteFromClustering(new Uint8Array([0xAC, 99, 0, 0, 0, 0, 0]), 2).catch((caught) => caught);
        expect(error.code).toBe('unsupported-version');
        expect(error.message).toMatch(/^Unsupported clustering:/);
    });

    it('names the .wasm path that could not be loaded, without Emscripten\'s debug advice', async () => {
        const lib = await fresh();
        const missing = resolve(dist, 'no-such-file.wasm');
        const error = await lib.init({ wasm: missing }).catch((caught) => caught);
        expect(error.code).toBe('wasm-load-failed');
        expect(error.message).toContain(missing);
        expect(error.message).toContain('could not be read');
        expect(`${error.message} ${error.cause && error.cause.message}`).not.toContain('ASSERTIONS');
        // Found by the fifth round (3.0.0-beta.5): in Node the advice was a browser's (a CSP, an extension's resources).
        expect(error.message).not.toMatch(/Content-Security-Policy|connect-src|web_accessible_resources/);
        expect(error.message).toContain('working directory');
        expect(error.message).toContain('serverless');
    });

    it('rejects input too large for the module up front, with a code and its size', async () => {
        // 2 GB and more can't be allocated (the allocator's size is 32 bits); from 4 GB it used to wrap around and throw a
        // bare RangeError. A length is enough to show it: the check comes before any copying.
        const huge = { data: new Uint8Array(2 ** 31), format: 'rgba' };
        const error = await ac.buildPalette(huge, 2).catch((caught) => caught);
        expect(error.code).toBe('out-of-memory');
        expect(error.message).toContain('2.00 GB');
        expect(error.message).toContain('1.9 GB');
        expect(await ac.getPalette(solid(red), 1)).toEqual(new Uint8Array(red));
    });

    it('rejects input too large for the module in the worker entry too, before sending it', async () => {
        // Found by the sixth round (3.0.0-beta.6): from 4 GB the buffer couldn't be cloned to send, which gave a different
        // code (invalid-argument) from the main entry's. Now both check the size first, with the same error.
        const worker = createWorker();
        try {
            const error = await worker.getPalette({ data: new Uint8Array(2 ** 31), format: 'rgba' }, 2).catch((caught) => caught);
            expect(error.code).toBe('out-of-memory');
            expect(error.message).toContain('1.9 GB');
            expect(await worker.getPalette(solid(red), 1)).toEqual(new Uint8Array(red));
        } finally {
            await worker.terminate();
        }
    });

    it('fetches an http(s) URL given to init({ wasm }) in Node, and says when the server fails', async () => {
        // Found by the sixth round (3.0.0-beta.6): Node read the URL as a file path, and the message blamed the path.
        const { createServer } = await import('http');
        const { readFile } = await import('fs/promises');
        const wasm = await readFile(resolve(dist, 'clustering.wasm'));
        const server = createServer((request, response) => {
            if (request.url === '/clustering.wasm') {response.writeHead(200, { 'content-type': 'application/wasm' }); response.end(wasm);}
            else {response.writeHead(404); response.end('not found');}
        });
        await new Promise((done) => server.listen(0, '127.0.0.1', done));
        const base = `http://127.0.0.1:${server.address().port}`;
        try {
            const missing = await fresh();
            const error = await missing.init({ wasm: `${base}/missing.wasm` }).catch((caught) => caught);
            expect(error.code).toBe('wasm-load-failed');
            expect(error.message).toContain('could not be fetched');
            expect(error.message).toContain('404');
            expect(error.message).not.toContain('working directory');
            const entry = await fresh();
            await entry.init({ wasm: `${base}/clustering.wasm` });
            expect(await entry.getPalette(solid(red), 1)).toEqual(new Uint8Array(red));
        } finally {
            server.close();
        }
    });

});
