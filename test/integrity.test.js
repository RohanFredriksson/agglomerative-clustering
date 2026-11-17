// Damaged stored clusterings. A clustering is untrusted bytes once it has been stored: it may come back truncated, with a
// flipped bit, cut short by a base64 round trip that lost characters, or as other data altogether. Version 3 clusterings
// carry a CRC-32 (from 3.0.0-beta.2), so any such damage is reported; those from 3.0.0-beta.1 have none (zeros), and for
// them the records are checked as they are replayed, so they can never give more than k colours or an error curve of NaN.
import { describe, it, expect } from 'vitest';
import {
    Clustering, getClustering, getPaletteFromClustering, getSwatchesFromClustering, getClusteringInfo, quantizeFromClustering,
    quantizeToIndicesFromClustering,
} from '../dist/index.mjs';

const width = 6, height = 6;   // 36 colours, a clustering of 760 bytes: small enough to flip every bit of
const image = new Uint8Array(width * height * 4);
for (let p = 0; p < width * height; p++) {
    const x = p % width, y = Math.floor(p / width);
    image.set([x * 40, y * 40, (x * y * 7) & 255, 255], p * 4);
}
const clustering = await getClustering(image);
const colors = (await getClusteringInfo(clustering)).maxColors;

const crc32 = (bytes) => {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) {
        crc ^= i >= 17 && i < 21 ? 0 : bytes[i];
        for (let b = 0; b < 8; b++) {crc = crc & 1 ? 0xEDB88320 ^ (crc >>> 1) : crc >>> 1;}
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
};
const storedChecksum = (bytes) => (bytes[17] | (bytes[18] << 8) | (bytes[19] << 16) | (bytes[20] << 24)) >>> 0;

// Every way of using a clustering, each expected to either work within its contract or reject with invalid-clustering.
// Functions, so a caller can start only some of them (a started call that nobody awaits is an unhandled rejection).
const uses = (bytes, k) => [
    () => getPaletteFromClustering(bytes, k).then((palette) => {expect(palette.length / 3).toBeLessThanOrEqual(k);}),
    () => getSwatchesFromClustering(bytes, k).then(({ palette, shares }) => {
        expect(palette.length / 3).toBeLessThanOrEqual(k);
        for (const share of shares) {expect(Number.isFinite(share)).toBe(true);}
    }),
    () => getClusteringInfo(bytes).then(({ mse }) => {for (const value of mse || []) {expect(Number.isFinite(value)).toBe(true);}}),
    () => quantizeFromClustering(image, bytes, k),
    () => quantizeToIndicesFromClustering(image, bytes, k).then(({ palette }) => {expect(palette.length / 3).toBeLessThanOrEqual(k);}),
];

describe('checksums', () => {

    it('every clustering carries the CRC-32 of its bytes', async () => {
        for (const made of [clustering, await getClustering(image, { colorSpace: 'oklab', precision: 5 }), await getClustering(new Uint8Array(0))]) {
            expect(storedChecksum(made)).toBe(crc32(made));
        }
    });

    it('reports every single flipped bit, with or without the Clustering type', async () => {
        for (let at = 0; at < clustering.length; at++) {
            for (let bit = 0; bit < 8; bit++) {
                const damaged = clustering.slice();
                damaged[at] ^= 1 << bit;
                // The checksum catches it, except in the header length (a shorter header has no checksum field), where
                // the records no longer line up and the replay catches it instead.
                let constructed = true;
                try {new Clustering(damaged);} catch (error) {
                    constructed = false;
                    expect(error.code, `byte ${at} bit ${bit}`).toMatch(/^(invalid-clustering|unsupported-version)$/);
                }
                if (constructed) {expect(at, `byte ${at} bit ${bit} was accepted`).toBe(2);}
                await expect(getPaletteFromClustering(damaged, 256), `byte ${at} bit ${bit}`).rejects.toHaveProperty('code', expect.stringMatching(/^(invalid-clustering|unsupported-version)$/));
            }
        }
    });

    it('reports truncated clusterings, at every length', async () => {
        for (let length = 0; length < clustering.length; length++) {
            const short = clustering.slice(0, length);
            expect(() => new Clustering(short), `length ${length}`).toThrow(expect.objectContaining({ code: 'invalid-clustering' }));
        }
    });

    it('reports a base64 round trip that lost its last characters', () => {
        const text = Buffer.from(clustering).toString('base64');
        for (const lost of [1, 2, 3, 4, 7, 12]) {
            const decoded = Buffer.from(text.slice(0, -lost), 'base64');
            // Dropping only `=` padding loses no bytes; everything else must be caught.
            if (decoded.length === clustering.length) {expect(decoded.equals(Buffer.from(clustering))).toBe(true); continue;}
            expect(() => new Clustering(decoded), `${lost} lost`).toThrow(expect.objectContaining({ code: 'invalid-clustering' }));
        }
    });

    it('says the bytes are damaged, and mentions 1.x only for bytes that could be a 1.x clustering', async () => {
        const flipped = clustering.slice();
        flipped[40] ^= 1;
        expect(() => new Clustering(flipped)).toThrow('damaged');
        expect(() => new Clustering(clustering.slice(0, clustering.length - 1))).toThrow('truncated');
        expect(() => new Clustering(clustering.slice(0, clustering.length - 1))).not.toThrow('1.x');
        expect(() => new Clustering(new Uint8Array(5))).not.toThrow('1.x');
        expect(() => new Clustering(new Uint8Array(12))).toThrow('1.x');
    });

});

describe('clusterings without a checksum (3.0.0-beta.1)', () => {

    const unchecked = clustering.slice();
    unchecked.fill(0, 17, 21);

    it('still load', async () => {
        expect(await getPaletteFromClustering(unchecked, 16)).toEqual(await getPaletteFromClustering(clustering, 16));
    });

    // The bug found in exploratory testing: a flipped bit in the root colour cut to 257 colours at k = 256, which broke
    // GIF output, and in about 10% of single-bit flips some cut gave more than k.
    it('never give more than k colours or non-numbers, whatever bit is flipped', async () => {
        const codes = new Set();
        for (let at = 22; at < unchecked.length; at++) {
            for (let bit = 0; bit < 8; bit++) {
                const damaged = unchecked.slice();
                damaged[at] ^= 1 << bit;
                // The cuts only: quantizing cuts the palette the same way (the other tests here quantize), and leaving it
                // out keeps this sweep light enough not to slow the rest of the suite on a small CI runner.
                for (const k of [2, colors]) {
                    for (const result of await Promise.allSettled(uses(damaged, k).slice(0, 3).map((use) => use()))) {
                        if (result.status === 'rejected') {codes.add(result.reason.code);}
                    }
                }
            }
        }
        expect([...codes].sort()).toEqual(['invalid-clustering']);
    }, 120000);

    it('reject a damaged root colour', async () => {
        const damaged = unchecked.slice();
        damaged[22] ^= 1;
        await expect(getPaletteFromClustering(damaged, colors)).rejects.toMatchObject({ code: 'invalid-clustering' });
    });

    it('reject a valid header followed by random bytes', async () => {
        let seed = 7;
        const random = unchecked.slice();
        for (let i = 25; i < random.length; i++) {random[i] = (seed = (seed * 1103515245 + 12345) >>> 0) >>> 24;}
        const results = await Promise.allSettled(uses(random, colors).map((use) => use()));
        expect(results.some((result) => result.status === 'rejected')).toBe(true);
        for (const result of results) {if (result.status === 'rejected') {expect(result.reason.code).toBe('invalid-clustering');}}
    });

});
