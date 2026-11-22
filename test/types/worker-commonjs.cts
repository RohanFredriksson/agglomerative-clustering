// The worker entry from CommonJS (require, as Jest's default mode and CommonJS Node code load it): its types come from
// dist/worker.d.cts, which refers to the main entry's CommonJS types.
import { createWorker, buildPalette, terminate, init, isCodedError, errorCodes, Palette, version } from 'agglomerative-clustering/worker';
import type { ErrorCode } from 'agglomerative-clustering';

declare const bytes: Uint8Array;

async function main() {
    await init({ script: './vendor/agglomerative-clustering/worker-thread.mjs' });
    const palette: Palette = await buildPalette(bytes, 8);
    const worker = createWorker({ transfer: true, script: new URL('file:///app/dist/worker-thread.mjs') });
    const mine: Palette = await worker.buildPalette(bytes, 4);
    try { await worker.buildPalette(bytes, 0); } catch (error) { if (isCodedError(error)) {const code: ErrorCode = error.code; void code;} }
    const codes: readonly ErrorCode[] = errorCodes;
    const v: string = version;
    await worker.terminate();
    await terminate();
    void [palette, mine, codes, v];
}
// @ts-expect-error a worker's script is chosen when it is created
createWorker().init({ script: 'x.mjs' });
void main;
