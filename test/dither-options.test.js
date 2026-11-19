// The forms the dither option takes: a boolean or a strength (Floyd-Steinberg, as in 3.0), a method name, or an object
// { method, strength, steps }. Every form is validated the same way in both entries.
import { describe, it, expect, afterAll } from 'vitest';
import { quantize, getClustering, ditherMethods, ditherSteps } from '../dist/index.mjs';
import { quantize as workerQuantize, getClustering as workerGetClustering, createWorker, terminate, ditherMethods as workerDitherMethods, ditherSteps as workerDitherSteps } from '../dist/worker.mjs';

afterAll(() => terminate());

const width = 32, height = 32;
const gradient = new Uint8Array(width * height * 4);
for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
        gradient.set([Math.round(x / (width - 1) * 255), Math.round(y / (height - 1) * 255), 96 + ((x * 7 + y * 3) % 64), 255], 4 * (y * width + x));
    }
}
const image = { data: gradient, format: 'rgba', width };
const run = (dither) => quantize(image, 8, { dither }).then((result) => result.data);

describe('dither option forms', () => {

    it('accepts every form of the floyd-steinberg option', async () => {
        const reference = await run(true);
        for (const dither of [1, 'floyd-steinberg', {}, { method: 'floyd-steinberg' }, { strength: 1 }]) {
            expect(await run(dither), JSON.stringify(dither)).toEqual(reference);
        }
        expect(await run({ strength: 0.5 })).toEqual(await run(0.5));
    });

    it('rejects bad dither values with their argument', async () => {
        const cases = [
            ['yes', 'options.dither'],
            [{ method: 'bayer' }, 'options.dither.method'],
            [{ strength: 2 }, 'options.dither.strength'],
            [{ strength: NaN }, 'options.dither.strength'],
            [{ method: 'ordered', steps: 12 }, 'options.dither.steps'],
            [{ method: 'ordered', steps: 128 }, 'options.dither.steps'],
            [{ steps: 8 }, 'options.dither.steps'],
            [{ method: 'atkinson', steps: 8 }, 'options.dither.steps'],
            [{ method: 'ordered', mix: 8 }, 'options.dither.mix'],
            [{ size: 4 }, 'options.dither.size'],
            [new Map(), 'options.dither'],
            [[], 'options.dither'],
            [null, 'options.dither'],
        ];
        for (const [dither, argument] of cases) {
            await expect(run(dither), String(argument)).rejects.toMatchObject({ code: 'invalid-argument', argument });
        }
    });

    it('says what was wrong and how to write it', async () => {
        // The value given is echoed back.
        await expect(run('orderd')).rejects.toThrow("'orderd'");
        await expect(run(1.5)).rejects.toThrow('1.5');
        // A setting of dither written as an option of its own points at the object form.
        for (const key of ['ditherMethod', 'method', 'strength', 'steps']) {
            await expect(quantize(image, 8, { [key]: 'ordered' }), key).rejects.toThrow('dither: {');
        }
        // steps without a method says which method takes it.
        await expect(run({ steps: 8 })).rejects.toThrow("method: 'ordered'");
    });

    it('says how to write the values a form or a slider gives', async () => {
        // 'none' from a <select>: no dithering is false.
        for (const dither of ['none', 'off']) {await expect(run(dither)).rejects.toThrow('Use false for no dithering');}
        // Numbers that arrived as strings (input.value).
        await expect(run({ method: 'ordered', steps: '16' })).rejects.toThrow('Number(');
        await expect(run({ strength: '0.5' })).rejects.toThrow('Number(');
        await expect(run('0.5')).rejects.toThrow('Number(');
    });

    it('lists the methods and step counts it takes', () => {
        expect(ditherMethods).toEqual(['floyd-steinberg', 'atkinson', 'ordered']);
        expect(ditherSteps).toEqual([2, 4, 8, 16, 32, 64]);
        expect(Object.isFrozen(ditherMethods) && Object.isFrozen(ditherSteps)).toBe(true);
        expect(workerDitherMethods).toEqual(ditherMethods);
        expect(workerDitherSteps).toEqual(ditherSteps);
    });

    it('rejects dither given to a function that takes none the same way in both entries', async () => {
        // The key is the mistake there, whatever its value, so the error names the option, as the main entry's does.
        const worker = createWorker();
        try {
            for (const dither of [{ method: 'bogus' }, 'ordered', () => 'ordered']) {
                const main = await getClustering(image, { dither }).catch((error) => error);
                expect(main).toMatchObject({ code: 'invalid-argument', argument: 'options.dither' });
                for (const call of [workerGetClustering(image, { dither }), worker.cluster(image, { dither })]) {
                    const error = await call.catch((e) => e);
                    expect(error).toMatchObject({ code: 'invalid-argument', argument: 'options.dither', message: main.message });
                }
            }
        } finally {
            await worker.terminate();
        }
    });

    it('names the kind of value it got, in a sentence', async () => {
        await expect(run(() => 'ordered')).rejects.toThrow('got a function;');
        await expect(run(Symbol('ordered'))).rejects.toThrow('got a symbol;');
        await expect(run(10n)).rejects.toThrow('got a bigint;');
    });

    it('needs a width for every method', async () => {
        for (const dither of ['ordered', { method: 'atkinson' }]) {
            await expect(quantize(gradient, 8, { dither })).rejects.toMatchObject({ code: 'invalid-argument', argument: 'options.width' });
        }
    });

    it('reads the dither object at call time', async () => {
        const dither = { method: 'floyd-steinberg', strength: 1 };
        const pending = quantize(image, 8, { dither });
        dither.strength = 0;
        expect((await pending).data).toEqual(await run(true));
    });

    it('rejects the same values in the worker entry', async () => {
        for (const [dither, argument] of [[{ method: 'bayer' }, 'options.dither.method'], [{ method: 'ordered', steps: 12 }, 'options.dither.steps'], [{ size: 4 }, 'options.dither.size']]) {
            await expect(workerQuantize(image, 8, { dither })).rejects.toMatchObject({ code: 'invalid-argument', argument });
        }
    });

    it('reads each dither setting once in the worker entry, as the main entry does', async () => {
        // A getter that answers differently on a second read: what is validated must be what is used.
        const changing = () => {let reads = 0; return {get method() {return reads++ === 0 ? 'ordered' : 'bogus';}};};
        expect((await workerQuantize(image, 8, { dither: changing() })).data).toEqual((await quantize(image, 8, { dither: changing() })).data);
    });

    it('reads the dither object the same way in the worker entry', async () => {
        // Inherited keys count, as they do for the options themselves, and a Proxy is read like the object it wraps.
        for (const dither of [Object.create({ method: 'atkinson' }), Object.create({ method: 'ordered', steps: 4 }), new Proxy({ method: 'ordered' }, {})]) {
            expect((await workerQuantize(image, 8, { dither })).data).toEqual((await quantize(image, 8, { dither })).data);
        }
        await expect(workerQuantize(image, 8, { dither: Object.create({ extra: 1 }) })).rejects.toMatchObject({ code: 'invalid-argument', argument: 'options.dither.extra' });
        for (const dither of [() => 'ordered', Symbol('ordered')]) {
            await expect(workerQuantize(image, 8, { dither })).rejects.toMatchObject({ code: 'invalid-argument', argument: 'options.dither' });
        }
    });

});

// The supported engines (Chrome and Edge 91, Firefox 89, Safari 16.4, Node 20.19; see .babelrc) don't all have every
// newer built-in, and Babel doesn't polyfill built-ins. Object.hasOwn arrived in Chrome 93 and Firefox 92.
describe('built-ins the supported engines lack', () => {

    it('parses method names and objects without Object.hasOwn', async () => {
        const saved = Object.hasOwn;
        delete Object.hasOwn;
        try {
            await expect(quantize(image, 8, { dither: 'ordered' })).resolves.toBeTruthy();
            await expect(quantize(image, 8, { dither: { method: 'atkinson' } })).resolves.toBeTruthy();
        } finally {
            Object.hasOwn = saved;
        }
    });

    it('leaves Object.hasOwn out of every built file', async () => {
        const { readdirSync, readFileSync } = await import('node:fs');
        const dist = new URL('../dist/', import.meta.url);
        for (const file of readdirSync(dist).filter((name) => /\.(mjs|cjs|js)$/.test(name))) {
            expect(readFileSync(new URL(file, dist), 'utf8').includes('Object.hasOwn('), file).toBe(false);
        }
    });

});
