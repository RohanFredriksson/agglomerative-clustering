/**
 * Benchmark harness: speed and quality of agglomerative-clustering against other
 * palette quantizers, over the Kodak photos and a set of synthetic images.
 *
 * For each image, library and k it records:
 *   - paletteMs:  time to produce a k-colour palette (median of --runs)
 *   - shared:     MSE / PSNR / mean CIEDE2000 after mapping that palette with one shared
 *                 nearest-colour function, so palettes are compared like for like
 *   - pipelineMs, own: time and quality of the library's own quantize (palette + its own
 *                 pixel mapping), where the library offers one
 * and per image and library:
 *   - sweepMs:    time to get palettes for every k in --k. agglomerative-clustering clusters
 *                 once and cuts the hierarchy at each k; the others start over for each k.
 *
 * Results go to bench/results/<label>.json; a summary is printed at the end.
 * Compare runs with: node bench/compare.js bench/results/a.json bench/results/b.json
 *
 * Options (all optional):
 *   --sets kodak,synthetic       image sets to run
 *   --libs neuquant,wuquant,...  other libraries (default: all; 'none' for agglomerative only)
 *   --k 16,64,128,256            palette sizes
 *   --runs 1                     timed runs per measurement (median is kept)
 *   --kodak-limit 24             only the first N Kodak images
 *   --ac name=path/index.mjs     an agglomerative-clustering build to include (repeatable;
 *                                default: agglomerative=dist/index.mjs)
 *   --no-pipeline                skip the libraries' own quantize
 *   --label name                 results file name (default: timestamp)
 */

import { mkdir, writeFile } from 'fs/promises';
import { execSync } from 'child_process';
import { cpus } from 'os';
import { performance } from 'perf_hooks';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { SETS, loadImages, syntheticImages, countUniqueColours } from './lib/images.js';
import { agglomerative, LIBRARIES } from './lib/quantizers.js';
import { mapToPalette, measure } from './lib/metrics.js';
import { summarise } from './lib/summary.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
    const args = { sets: SETS, libs: Object.keys(LIBRARIES), k: [16, 64, 128, 256], runs: 1, kodakLimit: 24, ac: [], pipeline: true, label: null };
    for (let i = 0; i < argv.length; i++) {
        const flag = argv[i];
        const value = () => argv[++i];
        switch (flag) {
            case '--sets': args.sets = value().split(','); break;
            case '--libs': {const v = value(); args.libs = v === 'none' ? [] : v === 'all' ? Object.keys(LIBRARIES) : v.split(','); break;}
            case '--k': args.k = value().split(',').map(Number); break;
            case '--runs': args.runs = Number(value()); break;
            case '--kodak-limit': args.kodakLimit = Number(value()); break;
            case '--ac': {const [name, path] = value().split('='); args.ac.push({ name, path }); break;}
            case '--no-pipeline': args.pipeline = false; break;
            case '--label': args.label = value(); break;
            default: throw new Error(`Unknown option ${flag}`);
        }
    }
    for (const lib of args.libs) {if (!LIBRARIES[lib]) {throw new Error(`Unknown library ${lib}; known: ${Object.keys(LIBRARIES).join(', ')}`);}}
    for (const set of args.sets) {if (!SETS.includes(set)) {throw new Error(`Unknown set ${set}; known: ${SETS.join(', ')}`);}}
    if (args.ac.length === 0) {args.ac.push({ name: 'agglomerative', path: 'dist/index.mjs' });}
    return args;
}

async function time(fn, runs) {
    const times = [];
    let result;
    for (let i = 0; i < runs; i++) {
        const start = performance.now();
        result = await fn();
        times.push(performance.now() - start);
    }
    times.sort((a, b) => a - b);
    return { ms: times[Math.floor(times.length / 2)], result };
}

function gitCommit() {
    try {return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();} catch {return null;}
}

const args = parseArgs(process.argv.slice(2));
const libraries = [];
for (const { name, path } of args.ac) {libraries.push(await agglomerative(name, path));}
for (const lib of args.libs) {libraries.push(LIBRARIES[lib]());}
for (const lib of libraries) {await lib.init?.();}

// Warm up every library (JIT, WASM compilation, lazy allocations) before timing anything.
const warmup = syntheticImages().filter(image => image.name === 'graphic' || image.name === 'noise-512');
for (const lib of libraries) {
    for (const image of warmup) {
        await lib.palette(image, 16);
        if (args.pipeline && lib.quantize) {await lib.quantize(image, 16);}
    }
}

const results = [];
const sweeps = [];
const started = performance.now();

for await (const image of loadImages(args.sets, { kodakLimit: args.kodakLimit })) {
    const unique = countUniqueColours(image.rgba);
    const imageInfo = { set: image.set, image: image.name, width: image.width, height: image.height, unique };
    process.stdout.write(`${image.set}/${image.name} (${image.width}x${image.height}, ${unique} colours)`);

    for (const lib of libraries) {
        for (const k of args.k) {
            const { ms: paletteMs, result: palette } = await time(() => lib.palette(image, k), args.runs);
            const shared = measure(image.rgba, mapToPalette(image.rgba, palette));
            let pipelineMs = null, own = null;
            if (args.pipeline && lib.quantize) {
                const run = await time(() => lib.quantize(image, k), args.runs);
                pipelineMs = run.ms;
                own = measure(image.rgba, run.result);
            }
            results.push({ ...imageInfo, lib: lib.name, k, paletteSize: palette.length / 3, paletteMs, shared, pipelineMs, own });
        }
        // Libraries without a sweep start over for each k, so their sweep costs the sum of their palettes.
        const sweepMs = lib.paletteSweep
            ? (await time(() => lib.paletteSweep(image, args.k), args.runs)).ms
            : results.filter(r => r.image === image.name && r.set === image.set && r.lib === lib.name).reduce((sum, r) => sum + r.paletteMs, 0);
        sweeps.push({ ...imageInfo, lib: lib.name, ks: args.k, sweepMs, measured: Boolean(lib.paletteSweep) });
        process.stdout.write('.');
    }
    process.stdout.write('\n');
}

const output = {
    meta: {
        date: new Date().toISOString(),
        commit: gitCommit(),
        node: process.version,
        cpu: cpus()[0]?.model ?? null,
        reference: libraries[0].name,
        args,
        elapsedSeconds: Math.round((performance.now() - started) / 1000),
    },
    results,
    sweeps,
};

const resultsDir = join(__dirname, 'results');
await mkdir(resultsDir, { recursive: true });
const file = join(resultsDir, `${args.label ?? output.meta.date.replace(/[:.]/g, '-')}.json`);
await writeFile(file, JSON.stringify(output, null, 2));

summarise(output);
console.log(`\nResults written to ${file}`);
