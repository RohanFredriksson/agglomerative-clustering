// WebAssembly timing of dist-like folders (make-dist.sh) in Node: for each image and config, the builds alternate per run; median of RUNS; load average
// before and after; and whether every build's output is byte-identical to the first one's.
// Usage: node time-dist.mjs <mode cluster|quantize|map (mapping only: the clustering is made before the clock, then clustering.quantize)> <runs> <images comma list> <configs comma list> <label=dir> [<label=dir> ...] > results/x.txt
//   configs for cluster: rgb8, rgb6, oklab8. For quantize: none, fs, atkinson, ordered (k=16 in RGB), with ":indices" suffix for quantizeToIndices.
import { readFileSync } from 'fs';
import { loadavg } from 'os';
const [mode, runsArg, imagesArg, configsArg, ...dirArgs] = process.argv.slice(2);
const runs = Number(runsArg);
const builds = await Promise.all(dirArgs.map(async (a) => { const [label, dir] = a.split('='); return {label, lib: await import(dir + '/index.mjs')}; }));
const meta = JSON.parse(readFileSync(new URL('./data/images.json', import.meta.url), 'utf8'));
const median = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];
const load = () => loadavg().map((x) => x.toFixed(2)).join('/');
const cfgs = {rgb8: {}, rgb6: {precision: 6}, oklab8: {colorSpace: 'oklab'}};
const mapcfgs = {none: {dither: false}, fs: {dither: 'floyd-steinberg'}, atkinson: {dither: 'atkinson'}, ordered: {dither: 'ordered'}};
console.log(`mode ${mode} runs ${runs}; load before ${load()}`);
console.log(['image', 'config', ...builds.map((b) => b.label + ' ms'), ...builds.slice(1).map((b) => b.label + ' change'), 'identical'].join('\t'));
let different = 0;
for (const name of imagesArg.split(',')) {
    const raw = readFileSync(new URL(`./data/${name}.rgba`, import.meta.url));
    const image = {data: new Uint8Array(raw.buffer, raw.byteOffset, raw.length), format: 'rgba', width: meta[name].width, height: meta[name].height};
    for (const cfg of configsArg.split(',')) {
        const times = builds.map(() => []); const outs = builds.map(() => null);
        const clusterings = [];
        const [base, indices] = cfg.split(':');
        for (let i = 0; i < runs; i++) {
            for (let b = 0; b < builds.length; b++) {
                const lib = builds[b].lib;
                const cl = mode === 'map' ? (clusterings[b] ??= await lib.buildClustering(image)) : null;
                const t = performance.now();
                let out;
                if (mode === 'map') out = indices ? (await cl.quantizeToIndices(image, 16, mapcfgs[base])).indices : (await cl.quantize(image, 16, mapcfgs[base])).data;
                else if (mode === 'cluster') out = await lib.buildClustering(image, cfgs[base]);
                else if (indices) out = (await lib.quantizeToIndices(image, 16, mapcfgs[base])).indices;
                else out = (await lib.quantize(image, 16, mapcfgs[base])).data;
                times[b].push(performance.now() - t);
                if (i === 0) outs[b] = Buffer.from(out.buffer, out.byteOffset, out.length).toString('base64').length + ':' + (await import('crypto')).createHash('sha256').update(out).digest('hex').slice(0, 16);
            }
        }
        const m = times.map(median);
        const same = outs.every((o) => o === outs[0]);
        if (!same) different++;
        console.log([name, cfg, ...m.map((x) => x.toFixed(0)), ...m.slice(1).map((x) => ((x / m[0] - 1) * 100).toFixed(1) + '%'), same ? 'yes' : 'NO'].join('\t'));
    }
}
console.log(`load after ${load()}; outputs that differ: ${different}`);
