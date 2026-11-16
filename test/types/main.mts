// Consumer type tests, compiled by `npm run test:types` against the built declarations (dist/*.d.ts, *.d.cts) with strict mode and
// skipLibCheck off, under nodenext (ESM and CommonJS importers) and bundler resolution. `@ts-expect-error` lines must NOT compile.
import {
    version, formatVersion, init, getClustering, getPalette, getPaletteFromClustering, getSwatches, getSwatchesFromClustering, getClusteringInfo,
    quantize, quantizeFromClustering, quantizeWithPalette,
    quantizeToIndices, quantizeToIndicesFromClustering, quantizeToIndicesWithPalette,
} from 'agglomerative-clustering';
import type { ImageLike, RawImage, ClusteringInfo, IndexedImage, ErrorCode, CodedError, RunOptions, InitOptions, QuantizeIndexOptions, Swatches } from 'agglomerative-clustering';

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

    const clustering: Uint8Array = await getClustering(imageData, { colorSpace: 'oklab', precision: 6, alpha: 'ignore', signal: controller.signal, onProgress: (p: number) => void p });
    const palette: Uint8Array = await getPalette(bytes, 16, { signal: controller.signal });
    const cut: Uint8Array = await getPaletteFromClustering(clustering, 8);
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

    const code: ErrorCode = 'invalid-argument';
    try { await getPalette(bytes, 0); } catch (error) { const coded = error as CodedError; const same: ErrorCode = coded.code; void same; }
    const run: RunOptions = { signal: controller.signal, onProgress(p) { void p; } };
    const initOptions: InitOptions = {};
    const asLike: ImageLike = bytes;
    void [cut, weights, mse, explained, a, b, c, d, e, cutoff, t, bits, idx, code, run, initOptions, asLike];
}

// Things that must not compile.
// @ts-expect-error unknown option
getPalette(bytes, 4, { reserveTransparent: true });
// @ts-expect-error the curve is called mse now
declare const oldInfo: ClusteringInfo; oldInfo.errors;
// transparent is a clustering option (and an indexed-output one), but the functions that only map don't take it
quantize(bytes, 4, { transparent: true });
declare const aClustering: Uint8Array;
// @ts-expect-error transparent is not a mapping option for quantizeFromClustering
quantizeFromClustering(bytes, aClustering, 4, { transparent: true });
// @ts-expect-error wrong signal type
getClustering(bytes, { signal: 'abort' });
// @ts-expect-error cutoff must be boolean or number
quantizeToIndices(bytes, 4, { transparent: 'yes' });
// @ts-expect-error k must be a number
getPalette(bytes, '4');
void main;
