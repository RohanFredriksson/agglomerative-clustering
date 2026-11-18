// Run by test/jest.test.js under Jest's default CommonJS mode (node and jsdom environments).
const { getPalette, getClustering, getPaletteFromClustering, quantize, quantizeToIndicesWithPalette, Clustering, version } = require('agglomerative-clustering');

// Red, blue, green, red.
const image = new Uint8Array([255, 0, 0, 255, 0, 0, 255, 255, 0, 255, 0, 255, 255, 0, 0, 255]);

test('loads the WebAssembly module and clusters', async () => {
    expect(typeof version).toBe('string');
    expect(Array.from(await getPalette(image, 3)).sort()).toEqual([0, 0, 0, 0, 0, 0, 255, 255, 255]);
    const clustering = await getClustering(image);
    expect(new Clustering(clustering)).toBeInstanceOf(Uint8Array);
    expect((await getPaletteFromClustering(clustering, 2)).length).toBe(6);
});

test('maps pixels', async () => {
    expect((await quantize(image, 2)).length).toBe(image.length);
    const { indices } = await quantizeToIndicesWithPalette(image, [255, 0, 0, 0, 0, 255]);
    expect(Array.from(indices)).toEqual([0, 1, 1, 0]);
});

test('gives the coded errors', async () => {
    await expect(getPalette(image, 0)).rejects.toMatchObject({ code: 'invalid-argument', argument: 'k' });
});
