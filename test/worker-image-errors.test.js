// Images that can't be posted (or whose fields change between reads) through both entries: the worker gives the
// main entry's error, without posting, and each field of an image object is read once.
import { describe, it, expect, afterAll, afterEach, vi } from 'vitest';
import { Worker } from 'worker_threads';
import * as ac from '../dist/index.mjs';
import { createWorker } from '../dist/worker.mjs';

const worker = createWorker();
afterEach(() => vi.restoreAllMocks());
afterAll(() => worker.terminate());

const small = () => new Uint8Array(16 * 4).map((_, i) => (i * 37) % 256);

describe('worker entry, images that cannot be sent', () => {
    it('reject with the main entry\'s message, code and argument, without posting', async () => {
        const post = vi.spyOn(Worker.prototype, 'postMessage');
        const cases = {
            'function': () => () => {},
            'Symbol': () => Symbol('x'),
            'thenable': () => ({ then() {} }),
            'Proxy as data': () => ({ data: new Proxy(small(), {}), format: 'rgba' }),
            'Uint16Array with an unknown key': () => ({ data: new Uint16Array(16), format: 'rgba', foo: 1 }),
            'Symbol premultiplied': () => ({ data: small(), format: 'rgba', premultiplied: Symbol() }),
            'function premultiplied with several faults': () => ({ data: small(), format: 'nope', premultiplied: () => true, foo: 1 }),
        };
        for (const [name, make] of Object.entries(cases)) {
            const expected = await ac.quantize(make(), 2).catch((e) => e);
            expect(expected, name).toBeInstanceOf(Error);
            expect(expected.argument, name).toBe('image');
            const error = await worker.quantize(make(), 2).then(() => null, (e) => e);
            expect(error, name).toBeInstanceOf(Error);
            expect(error.message, name).toBe(expected.message);
            expect(error.code, name).toBe(expected.code);
            expect(error.argument, name).toBe(expected.argument);
        }
        expect(post).not.toHaveBeenCalled();
    });

    it('methods reject, they do not throw', async () => {
        const promise = worker.quantize(() => {}, 2);
        expect(promise).toBeInstanceOf(Promise);
        await expect(promise).rejects.toMatchObject({ code: 'invalid-argument', argument: 'image' });
    });
});

// A data getter that counts its reads and, on request, answers with a different array from the second read on.
const getterImage = (counter, later) => {
    const first = small();
    const image = { format: 'rgba', width: 4, height: 4 };
    Object.defineProperty(image, 'data', { enumerable: true, get: () => (++counter.reads > 1 && later ? later : first) });
    return image;
};

describe('an image object is read once', () => {
    for (const [name, call] of [
        ['main entry', (image) => ac.quantize(image, 4)],
        ['worker entry', (image) => worker.quantize(image, 4)],
    ]) {
        it(`${name}: at most one read of data`, async () => {
            const counter = { reads: 0 };
            await call(getterImage(counter));
            expect(counter.reads).toBe(1);
        });
        it(`${name}: a data getter that changes after the first read gives the first array's result`, async () => {
            const counter = { reads: 0 };
            const got = await call(getterImage(counter, new Uint8Array(0)));
            const expected = await ac.quantize({ data: small(), format: 'rgba', width: 4, height: 4 }, 4);
            expect(got.data.length).toBe(64);
            expect(got).toEqual(expected);
        });
    }

    it('format, width, height and premultiplied are read once too', async () => {
        const reads = {};
        const image = { data: small() };
        for (const [key, value] of Object.entries({ format: 'rgba', width: 4, height: 4, premultiplied: false })) {
            reads[key] = 0;
            Object.defineProperty(image, key, { enumerable: true, get: () => { reads[key]++; return value; } });
        }
        await ac.quantizeToIndices(image, 4);
        expect(reads).toEqual({ format: 1, width: 1, height: 1, premultiplied: 1 });
        for (const key of Object.keys(reads)) {reads[key] = 0;}
        await worker.quantize(image, 4);
        expect(reads).toEqual({ format: 1, width: 1, height: 1, premultiplied: 1 });
    });
});
