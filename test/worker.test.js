import { describe, it, expect, afterAll } from 'vitest';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import * as ac from '../dist/index.mjs';
import * as dropIn from '../dist/worker.mjs';
import { createWorker } from '../dist/worker.mjs';

const width = 32, height = 24;
const image = new Uint8Array(width * height * 4);
for (let p = 0; p < width * height; p++) {
    const x = p % width, y = Math.floor(p / width);
    image.set([x * 8, y * 10, (x * y) & 255, x % 9 === 0 ? 0 : x % 4 === 0 ? 100 : 255], p * 4);
}

const worker = createWorker();
afterAll(() => worker.terminate());

describe('a worker gives the same results as the main entry', () => {

    const raw = { data: image, format: 'rgba', width, height };

    it('for clusterings, palettes, weights and info', async () => {
        const options = { colorSpace: 'oklab', precision: 6 };
        const clustering = await worker.getClustering(image, options);
        expect(clustering).toEqual(await ac.getClustering(image, options));
        expect(await worker.getPalette(image, 12, options)).toEqual(await ac.getPalette(image, 12, options));
        expect(await worker.getPaletteFromClustering(clustering, 7)).toEqual(await ac.getPaletteFromClustering(clustering, 7));
        expect(await worker.getPaletteWeights(clustering, 7)).toEqual(await ac.getPaletteWeights(clustering, 7));
        expect(await worker.getClusteringInfo(clustering)).toEqual(await ac.getClusteringInfo(clustering));
    });

    it('for mapped images, in the type they were given', async () => {
        const clustering = await ac.getClustering(image);
        const palette = await ac.getPalette(image, 5);
        expect(await worker.quantize(image, 8)).toEqual(await ac.quantize(image, 8));
        expect(await worker.quantize(raw, 8, { dither: true })).toEqual(await ac.quantize(raw, 8, { dither: true }));
        expect(await worker.quantizeWithClustering(raw, clustering, 6)).toEqual(await ac.quantizeWithClustering(raw, clustering, 6));
        expect(await worker.quantizeWithPalette(image, palette, { colorSpace: 'oklab' })).toEqual(await ac.quantizeWithPalette(image, palette, { colorSpace: 'oklab' }));

        const imageData = new ImageData(new Uint8ClampedArray(image), width, height);
        const result = await worker.quantize(imageData, 8, { dither: 0.5 });
        expect(result).toBeInstanceOf(ImageData);
        expect([result.width, result.height]).toEqual([width, height]);
        expect(new Uint8Array(result.data.buffer)).toEqual(new Uint8Array((await ac.quantize(imageData, 8, { dither: 0.5 })).data.buffer));
    });

    it('for indexed output', async () => {
        const clustering = await ac.getClustering(image);
        const palette = await ac.getPalette(image, 5);
        expect(await worker.quantizeToIndices(raw, 300, { transparentIndex: true })).toEqual(await ac.quantizeToIndices(raw, 300, { transparentIndex: true }));
        expect(await worker.quantizeToIndicesWithClustering(image, clustering, 6)).toEqual(await ac.quantizeToIndicesWithClustering(image, clustering, 6));
        expect(await worker.quantizeToIndicesWithPalette(image, palette)).toEqual(await ac.quantizeToIndicesWithPalette(image, palette));
    });

    it('for many calls at once', async () => {
        const ks = Array.from({ length: 20 }, (_, i) => i + 1);
        const results = await Promise.all(ks.map((k) => worker.getPalette(image, k)));
        for (const [i, k] of ks.entries()) {expect(results[i]).toEqual(await ac.getPalette(image, k));}
    });

    it('and the same errors', async () => {
        await expect(worker.quantize(image, 0)).rejects.toThrow('Invalid k');
        await expect(worker.getClustering({ data: image, format: 'argb' })).rejects.toThrow('Invalid format');
        await expect(worker.getClustering(null)).rejects.toThrow('Invalid image');
        await expect(worker.getPaletteFromClustering(new Uint8Array(5), 2)).rejects.toThrow('Invalid clustering');
        await expect(worker.quantize(image, 4, { colour: 'rgb' })).rejects.toThrow("Invalid option 'colour'");
    });

});

describe('handles', () => {

    it('keep an image and its clustering in the worker', async () => {
        const handle = await worker.cluster(image, { colorSpace: 'oklab' });
        const clustering = await ac.getClustering(image, { colorSpace: 'oklab' });
        expect(await handle.getClustering()).toEqual(clustering);
        expect(await handle.getPalette(9)).toEqual(await ac.getPaletteFromClustering(clustering, 9));
        expect(await handle.getPaletteWeights(9)).toEqual(await ac.getPaletteWeights(clustering, 9));
        expect(await handle.getInfo()).toEqual(await ac.getClusteringInfo(clustering));
        expect(await handle.quantize(9, { dither: true, width })).toEqual(await ac.quantizeWithClustering(image, clustering, 9, { dither: true, width }));
        expect(await handle.quantizeToIndices(9, { transparentIndex: true })).toEqual(await ac.quantizeToIndicesWithClustering(image, clustering, 9, { transparentIndex: true }));
        await handle.release();
        await expect(handle.getPalette(2)).rejects.toThrow('released');
    });

    it('give results in the type of the image they were made from', async () => {
        const imageData = new ImageData(new Uint8ClampedArray(image), width, height);
        const handle = await worker.cluster(imageData);
        const result = await handle.quantize(4, { dither: true });
        expect(result).toBeInstanceOf(ImageData);
        expect(new Uint8Array(result.data.buffer)).toEqual(new Uint8Array((await ac.quantize(imageData, 4, { dither: true })).data.buffer));
        const rawHandle = await worker.cluster({ data: image, format: 'rgba', width });
        expect(await rawHandle.quantize(4)).toEqual(await ac.quantize({ data: image, format: 'rgba', width }, 4));
        await handle.release();
        await rawHandle.release();
    });

    it('report clustering errors when created', async () => {
        await expect(worker.cluster(image, { precision: 9 })).rejects.toThrow('Invalid precision');
    });

});

describe('createWorker', () => {

    it('copies inputs by default, and transfers them with transfer: true', async () => {
        const copy = image.slice();
        await worker.getPalette(copy, 4);
        expect(copy.length).toBe(image.length);
        const moving = createWorker({ transfer: true });
        const transferred = image.slice();
        expect(await moving.getPalette(transferred, 4)).toEqual(await ac.getPalette(image, 4));
        expect(transferred.length).toBe(0);
        await moving.terminate();
    });

    it('validates its options', () => {
        expect(() => createWorker({ transfer: 'yes' })).toThrow('Invalid transfer');
        expect(() => createWorker({ threads: 2 })).toThrow("Invalid option 'threads'");
    });

    it('rejects calls waiting on a terminated worker, and later calls', async () => {
        const doomed = createWorker();
        await doomed.init();
        const waiting = expect(doomed.getPalette(image, 4)).rejects.toThrow('terminated');
        await doomed.terminate();
        await waiting;
        await expect(doomed.getPalette(image, 4)).rejects.toThrow('terminated');
    });

});

describe('the drop-in module', () => {

    it('exports the main entry\'s functions, plus createWorker', () => {
        expect(Object.keys(dropIn).sort()).toEqual([...Object.keys(ac), 'createWorker'].sort());
    });

    it('runs them in a shared worker', async () => {
        expect(await dropIn.quantize(image, 6)).toEqual(await ac.quantize(image, 6));
    });

    it('never keeps a Node process alive while idle', async () => {
        const script = `import { getPalette } from ${JSON.stringify(fileURLToPath(new URL('../dist/worker.mjs', import.meta.url)))};
            console.log((await getPalette(new Uint8Array([1, 2, 3, 255, 200, 100, 0, 255]), 2)).length);`;
        const { stdout } = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', script], { timeout: 20_000 });
        expect(stdout.trim()).toBe('6');
    }, 30_000);

});
