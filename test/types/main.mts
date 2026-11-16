// Consumer type tests, compiled by `npm run test:types` against the built declarations (dist/*.d.ts, *.d.cts) with strict mode and
// skipLibCheck off, under nodenext (ESM and CommonJS importers) and bundler resolution. `@ts-expect-error` lines must NOT compile.
import {
    version, formatVersion, Palette, Clustering, init, getClustering, getPalette, getPaletteFromClustering, getSwatches, getSwatchesFromClustering, getClusteringInfo,
    quantize, quantizeFromClustering, quantizeWithPalette,
    quantizeToIndices, quantizeToIndicesFromClustering, quantizeToIndicesWithPalette,
} from 'agglomerative-clustering';
import type { ImageLike, RawImage, ClusteringInfo, IndexedImage, ErrorCode, CodedError, RunOptions, InitOptions, QuantizeIndexOptions, Swatches, ColorSpace, ErrorArgument } from 'agglomerative-clustering';

declare const bytes: Uint8Array;
declare const imageData: ImageData;
declare const raw: RawImage;
const controller = new AbortController();

async function main() {
    await init();
    await init({ wasm: 'https://cdn.example.com/clustering.wasm' });
    await init({ wasm: new URL('https://x.test/c.wasm') });
    await init({ wasm: new ArrayBuffer(8) });
    await init({ wasm: new Uint8Array(8) });
    declare_module: {
        const m = null as unknown as WebAssembly.Module;
        await init({ wasm: m });
    }

    const clustering: Clustering = await getClustering(imageData, { colorSpace: 'oklab', precision: 6, alpha: 'ignore', signal: controller.signal, onProgress: (p: number) => void p });
    const palette: Palette = await getPalette(bytes, 16, { signal: controller.signal });
    const cut: Palette = await getPaletteFromClustering(clustering, 8);
    const swatches: Swatches = await getSwatchesFromClustering(clustering, 8);
    const weights: Float64Array = swatches.weights;
    const shares: Float64Array = (await getSwatches(imageData, 8, { signal: controller.signal })).shares;
    void shares;
    const info: ClusteringInfo = await getClusteringInfo(clustering);
    const libraryVersion: string = version;
    const stored: 3 = formatVersion;
    // The format version is the one a fresh clustering reports, so it narrows the info the same way.
    if (info.formatVersion === formatVersion) {const total: number = info.totalWeight; void total;}
    // @ts-expect-error the version is a constant
    version = '0';
    void libraryVersion; void stored;
    const mse: Float64Array | null = info.mse;
    const explained: Float64Array | null = info.explained;

    // Overloads: the result type follows the input type.
    const a: Uint8Array = await quantize(bytes, 8, { dither: true, width: 10, onProgress: () => {} });
    const b: ImageData = await quantize(imageData, 8, { colorSpace: 'oklab' });
    const c: RawImage = await quantize(raw, 8);
    const d: Uint8Array = await quantizeFromClustering(bytes, clustering, 8, { signal: controller.signal });
    const e: ImageData = await quantizeWithPalette(imageData, palette);

    const indexed: IndexedImage = await quantizeToIndices(imageData, 255, { transparent: true });
    const cutoff: IndexedImage = await quantizeToIndices(bytes, 255, { transparent: 200, signal: controller.signal });
    const t: number | null = indexed.transparentIndex;
    const bits: 8 | 16 | 32 = indexed.indexBits;
    const idx: Uint8Array | Uint16Array | Uint32Array = indexed.indices;
    await quantizeToIndicesFromClustering(imageData, clustering, 8, { transparent: false });
    await quantizeToIndicesWithPalette(raw, palette, { transparent: 1 });

    // A palette knows its colour space and is a Uint8Array; stored bytes become a Clustering by construction
    const space: ColorSpace = palette.colorSpace;
    const withEntry = await quantizeToIndices(bytes, 8, { transparent: true });
    const reusable: Palette = withEntry.colors;
    await quantizeToIndicesWithPalette(bytes, reusable, { transparent: true });
    const recorded: false | number = (await getClusteringInfo(clustering)).transparent;
    void [reusable, recorded];
    const asBytes: Uint8Array = palette;
    const typed: Clustering = new Clustering(plainBytes);
    const slice: Uint8Array = palette.slice(0, 3);
    const made: Palette = new Palette(plainBytes, 'oklab');
    await quantizeWithPalette(imageData, made);
    await quantizeWithPalette(imageData, plainBytes);
    await quantizeWithPalette(imageData, [0, 0, 0, 255, 255, 255]);
    await getPaletteFromClustering(typed, 4);
    void [space, asBytes, slice];
    const code: ErrorCode = 'invalid-argument';
    try { await getPalette(bytes, 0); } catch (error) { const coded = error as CodedError; const same: ErrorCode = coded.code; const which: ErrorArgument | undefined = coded.argument; if (which === 'options.colorSpace' || which === 'k') {void which;} void same; }
    const run: RunOptions = { signal: controller.signal, onProgress(p) { void p; } };
    const initOptions: InitOptions = {};
    const asLike: ImageLike = bytes;
    void [cut, weights, mse, explained, a, b, c, d, e, cutoff, t, bits, idx, code, run, initOptions, asLike];
}

// Things that must not compile.
// Palettes and clusterings are different types: a plain Uint8Array is not a Clustering, and neither is a Palette
declare const plainBytes: Uint8Array;
// @ts-expect-error stored bytes need `new Clustering(bytes)` to be typed as a clustering
getPaletteFromClustering(plainBytes, 4);
// @ts-expect-error a palette is not a clustering
getPaletteFromClustering(await getPalette(bytes, 4), 4);
// @ts-expect-error a clustering is not a palette
quantizeWithPalette(bytes, aClustering);
// @ts-expect-error nor in the indexed form
quantizeToIndicesWithPalette(bytes, aClustering);
// @ts-expect-error unknown option
getPalette(bytes, 4, { reserveTransparent: true });
// @ts-expect-error the curve is called mse now
declare const oldInfo: ClusteringInfo; oldInfo.errors;
// transparent is a clustering option (and an indexed-output one), but the functions that only map don't take it
quantize(bytes, 4, { transparent: true });
declare const aClustering: Clustering;
// @ts-expect-error transparent is not a mapping option for quantizeFromClustering
quantizeFromClustering(bytes, aClustering, 4, { transparent: true });
// @ts-expect-error wrong signal type
getClustering(bytes, { signal: 'abort' });
// @ts-expect-error cutoff must be boolean or number
quantizeToIndices(bytes, 4, { transparent: 'yes' });
// @ts-expect-error k must be a number
getPalette(bytes, '4');
void main;
