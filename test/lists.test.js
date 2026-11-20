// Every option whose value is one of a fixed set of names has that set exported as a frozen list, from both entries:
// errorCodes, colorSpaces, imageFormats, alphaModes, ditherMethods and ditherSteps. Each list holds exactly the names
// the option accepts.
import { describe, it, expect, afterAll } from 'vitest';
import * as ac from '../dist/index.mjs';
import * as workerEntry from '../dist/worker.mjs';

afterAll(() => workerEntry.terminate());

const pixels = new Uint8Array([200, 30, 30, 255, 30, 200, 30, 128, 30, 30, 200, 255, 220, 220, 40, 255]);
const imageIn = (format) => format === 'rgba' ? { data: pixels, format, width: 2 }
    : format === 'bgra' || format === 'bgrx' ? { data: pixels.map((v, i) => i % 4 === 0 ? pixels[i + 2] : i % 4 === 2 ? pixels[i - 2] : v), format, width: 2 }
    : format === 'rgbx' ? { data: pixels, format, width: 2 }
    : { data: pixels.filter((_, i) => i % 4 !== 3), format, width: 2 };

describe('exported lists of names', () => {

    it('lists the colour spaces, image formats and alpha modes, frozen, the same in both entries', () => {
        expect(ac.colorSpaces).toEqual(['rgb', 'oklab']);
        expect(ac.imageFormats).toEqual(['rgb', 'rgba', 'bgra', 'rgbx', 'bgrx']);
        expect(ac.alphaModes).toEqual(['weight', 'ignore']);
        for (const name of ['colorSpaces', 'imageFormats', 'alphaModes', 'ditherMethods', 'ditherSteps', 'errorCodes']) {
            expect(Object.isFrozen(ac[name]), name).toBe(true);
            expect(workerEntry[name], name).toEqual(ac[name]);
        }
    });

    it('holds names the options accept', async () => {
        for (const colorSpace of ac.colorSpaces) {await expect(ac.getPalette(imageIn('rgba'), 2, { colorSpace })).resolves.toBeTruthy();}
        for (const format of ac.imageFormats) {await expect(ac.getPalette(imageIn(format), 2)).resolves.toBeTruthy();}
        for (const alpha of ac.alphaModes) {await expect(ac.getPalette(imageIn('rgba'), 2, { alpha })).resolves.toBeTruthy();}
        for (const method of ac.ditherMethods) {await expect(ac.quantize(imageIn('rgba'), 2, { dither: method })).resolves.toBeTruthy();}
        for (const steps of ac.ditherSteps) {await expect(ac.quantize(imageIn('rgba'), 2, { dither: { method: 'ordered', steps } })).resolves.toBeTruthy();}
    });

});
