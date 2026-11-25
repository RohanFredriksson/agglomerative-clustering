import { describe, it, expect } from 'vitest';
import { quantize, buildClustering } from '../dist/index.mjs';

const data = new Uint8Array(64).map((_, i) => (i * 37) % 256);
const unknown = (key, hint = '') => ({
    code: 'invalid-argument', argument: 'image',
    message: `Invalid image: unknown key '${key}'. An image object has data, format, width, height and premultiplied: build it from those rather than spreading a decoder's result.${hint}`,
});

describe('unknown image keys', () => {
    it('hints', async () => {
        await expect(buildClustering({ data, format: 'rgba', premultiply: true })).rejects.toMatchObject(unknown('premultiply', ' Did you mean premultiplied: true?'));
        await expect(buildClustering({ data, format: 'rgba', widht: 4 })).rejects.toMatchObject(unknown('widht', " Did you mean 'width'?"));
    });
    it('near misses', async () => {
        await expect(buildClustering({ data, format: 'rgba', wdth: 4 })).rejects.toMatchObject(unknown('wdth', " Did you mean 'width'?"));
        await expect(buildClustering({ data, format: 'rgba', widthh: 4 })).rejects.toMatchObject(unknown('widthh', " Did you mean 'width'?"));
        await expect(buildClustering({ data, format: 'rgba', Format: 'rgba' })).rejects.toMatchObject(unknown('Format', " Did you mean 'format'?"));
        await expect(buildClustering({ data, format: 'rgba', hieght: 4 })).rejects.toMatchObject(unknown('hieght', " Did you mean 'height'?"));
    });
    it('decoder keys', async () => {
        for (const key of ['channels', 'size', 'depth']) {
            await expect(buildClustering({ data, format: 'rgba', [key]: 4 })).rejects.toMatchObject(unknown(key, " Spread only width and height from a decoder's result."));
        }
    });
    it('an undefined-valued key is rejected', async () => {
        await expect(buildClustering({ ...{ data, format: 'rgba', foo: undefined } })).rejects.toMatchObject(unknown('foo'));
    });
    it('inherited keys, ImageData and bare arrays are fine', async () => {
        class Img { constructor() {this.data = data; this.format = 'rgba';} get extra() {return 1;} }
        await expect(buildClustering(new Img())).resolves.toBeDefined();
        await expect(buildClustering(new ImageData(new Uint8ClampedArray(data), 4, 4))).resolves.toBeDefined();
        await expect(buildClustering(data)).resolves.toBeDefined();
    });
    it('shape checks come first', async () => {
        await expect(buildClustering({ data, format: 'nope', foo: 1 })).rejects.toMatchObject({ message: expect.stringMatching(/^Invalid format/) });
    });
    it('a result carries premultiplied, copied as given', async () => {
        const base = { data: data.slice(), format: 'rgba', width: 4 };
        const a = await quantize({ ...base, premultiplied: true }, 4);
        expect(Object.keys(a)).toEqual(['data', 'format', 'width', 'premultiplied']);
        expect(a.premultiplied).toBe(true);
        const b = await quantize({ ...base, premultiplied: false }, 4);
        expect(b.premultiplied).toBe(false);
        expect('premultiplied' in await quantize(base, 4)).toBe(false);
    });
    it('a result fed back in is accepted', async () => {
        const first = await quantize({ data: data.slice(), format: 'rgba', width: 4, height: 4, premultiplied: true }, 8);
        const second = await quantize(first, 4);
        expect(second.premultiplied).toBe(true);
    });
});
