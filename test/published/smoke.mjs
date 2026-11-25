// The published package, as a stranger gets it: `node test/published/smoke.mjs <version or dist-tag>`.
// Installs agglomerative-clustering from the npm registry into a fresh project (no link to this repository) and checks
// that the ways people load it work: an ES module import, a CommonJS require, the worker entry (in a worker thread),
// the .wasm export, and TypeScript compiling against the shipped declarations. The tests in test/ use dist/ from the
// repository, so they can't see a file left out of the package, a wrong `exports` entry or a broken declaration path.
import { execFileSync } from 'child_process';
import { mkdtempSync, writeFileSync, rmSync, realpathSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const wanted = process.argv[2] || 'next';
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const run = (command, args, cwd) => execFileSync(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', shell: process.platform === 'win32' });
const project = realpathSync(mkdtempSync(join(tmpdir(), 'ac-published-')));
let failed = false;
const check = (name, fn) => {
    try {
        const detail = fn();
        console.log(`  ok    ${name}${detail ? `: ${detail}` : ''}`);
    } catch (error) {
        failed = true;
        console.log(`  FAIL  ${name}\n${String(error.stdout || '') + String(error.stderr || '') || error.message}`);
    }
};

try {
    writeFileSync(join(project, 'package.json'), JSON.stringify({ name: 'published-smoke', private: true, version: '1.0.0' }));
    run(npm, ['install', '--no-audit', '--no-fund', `agglomerative-clustering@${wanted}`, 'typescript@5'], project);
    const installed = JSON.parse(run(npm, ['ls', 'agglomerative-clustering', '--json'], project)).dependencies['agglomerative-clustering'].version;
    console.log(`agglomerative-clustering@${wanted} is ${installed}, on Node ${process.versions.node}, ${process.platform}:`);

    // Pixels with a few distinct colours, the same in every check.
    const pixels = 'const px = new Uint8Array(64 * 4); for (let i = 0; i < 64; i++) px.set([(i * 37) & 255, (i * 91) & 255, (i * 13) & 255, 255], i * 4);';

    writeFileSync(join(project, 'esm.mjs'), `${pixels}
import { version, buildPalette, buildSwatches, quantizeToIndices, Palette, Clustering, buildClustering, init } from 'agglomerative-clustering';
await init();
if (version !== ${JSON.stringify(installed)}) throw new Error('version is ' + version);
const palette = await buildPalette(px, 4, { colorSpace: 'oklab' });
if (!(palette instanceof Palette) || palette.colorSpace !== 'oklab' || palette.length !== 12) throw new Error('palette');
const { shares } = await buildSwatches(px, 4);
if (Math.abs(shares.reduce((a, b) => a + b) - 1) > 1e-9) throw new Error('shares');
if (!((await buildClustering(px)) instanceof Clustering)) throw new Error('clustering');
const indexed = await quantizeToIndices(px, 4);
console.log('version ' + version + ', ' + palette.length / 3 + ' colours, ' + indexed.indices.length + ' indices');
`);
    check('ES module import', () => run(process.execPath, ['esm.mjs'], project).trim());

    writeFileSync(join(project, 'cjs.cjs'), `${pixels}
const ac = require('agglomerative-clustering');
ac.buildPalette(px, 3).then((palette) => console.log(palette.length / 3 + ' colours from require()'));
`);
    check('CommonJS require', () => run(process.execPath, ['cjs.cjs'], project).trim());

    writeFileSync(join(project, 'worker.mjs'), `${pixels}
import { createWorker } from 'agglomerative-clustering/worker';
const worker = createWorker();
const handle = await worker.cluster(px, { colorSpace: 'oklab' });
const palette = await handle.getPalette(4);
await handle.release();
await worker.terminate();
if (palette.colorSpace !== 'oklab') throw new Error('palette lost its colour space in the worker');
console.log(palette.length / 3 + ' colours from a worker thread');
`);
    check('worker entry (a worker thread)', () => run(process.execPath, ['worker.mjs'], project).trim());

    writeFileSync(join(project, 'wasm.mjs'), `
import { readFileSync } from 'fs';
import { createRequire } from 'module';
const path = createRequire(import.meta.url).resolve('agglomerative-clustering/clustering.wasm');
const { init } = await import('agglomerative-clustering');
await init({ wasm: readFileSync(path) });
console.log('loaded from the exported .wasm (' + readFileSync(path).length + ' bytes)');
`);
    check('the exported .wasm', () => run(process.execPath, ['wasm.mjs'], project).trim());

    writeFileSync(join(project, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, module: 'nodenext', moduleResolution: 'nodenext', target: 'es2022', noEmit: true, skipLibCheck: false, lib: ['es2022', 'dom'] }, files: ['types.mts'] }));
    writeFileSync(join(project, 'types.mts'), `
import { buildPalette, buildClustering, Clustering, Palette, type ErrorArgument } from 'agglomerative-clustering';
import { createWorker, type ClusteringHandle } from 'agglomerative-clustering/worker';
declare const bytes: Uint8Array;
const palette: Palette = await buildPalette(bytes, 8);
const clustering: Clustering = await buildClustering(bytes);
const handle: ClusteringHandle = await createWorker().cluster(bytes);
const which: ErrorArgument = 'options.colorSpace';
void [palette, clustering, handle, which];
`);
    check('TypeScript against the shipped declarations', () => {run(npx, ['tsc', '-p', '.'], project); return 'strict, nodenext';});
} finally {
    rmSync(project, { recursive: true, force: true });
}
process.exitCode = failed ? 1 : 0;
