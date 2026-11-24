// Builds slices.cpp with em++ against the working tree's clustering.cpp and v3.6.0's (OLD, one-shot only), runs both
// and joins them: the longest 10 ms mapping slice, the sliced total and the one-shot time, against 3.6.0's one-shot.
//   source ~/.local/share/emsdk/emsdk_env.sh; node bench/spikes/slicing-mapping/slices.mjs > bench/spikes/slicing-mapping/results-slices.txt
// --quick runs only the photo at 16 and 256 colours (a few minutes), and --new-only skips rebuilding 3.6.0's.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';
import { KODAK_IMAGES, ensureImage } from '../../../fixtures/kodak.js';

const root = new URL('../../../', import.meta.url).pathname, out = `${root}build/slicing-mapping`;
mkdirSync(`${out}/old`, { recursive: true });
for (const f of ['clustering.cpp', 'clustering.hpp', 'colorspace.hpp', 'version.hpp']) {
    writeFileSync(`${out}/old/${f}`, execFileSync('git', ['show', `v3.6.0:src/${f}`], { cwd: root }));
}
// kodim23 scaled 4x (3072 x 2048, 6.3 MP), as in strips.mjs
const photo = `${out}/photo.rgba`;
writeFileSync(photo, await sharp(await ensureImage(KODAK_IMAGES[22])).resize(3072, 2048).ensureAlpha().raw().toBuffer());
const runs = {}, quick = process.argv.includes('--quick') ? ['quick'] : [];
for (const [label, source, extra] of [['new', `${root}src/clustering.cpp`, []], ['old', `${out}/old/clustering.cpp`, ['-DOLD']]]) {
    const js = `${out}/${label}.cjs`;
    execFileSync('em++', ['-std=c++17', '-O3', '-msimd128', '-sALLOW_MEMORY_GROWTH=1', '-sMAXIMUM_MEMORY=4GB', '-sNODERAWFS=1', `-DSOURCE="${source}"`, ...extra, `${root}bench/spikes/slicing-mapping/slices.cpp`, '-o', js], { stdio: ['ignore', 'ignore', 'inherit'] });
    runs[label] = execFileSync('node', [js, photo, '3072', ...quick], { encoding: 'utf8', maxBuffer: 1 << 24 }).trim().split('\n').map((l) => l.split('|'));
}
console.log('image                  colours  method            slices  longest slice  sliced   one-shot  3.6.0 one-shot');
let worst = 0, mismatches = 0;
runs.new.forEach(([name, colours, method, oneShot, hash, slices, longest, sliced, slicedHash], i) => {
    const old = runs.old[i];
    if (hash !== slicedHash || hash !== old[4]) {mismatches++;}
    worst = Math.max(worst, +longest);
    console.log(`${name.padEnd(22)} ${colours.padStart(5)}    ${method.padEnd(16)} ${slices.padStart(5)}  ${longest.padStart(8)} ms  ${sliced.padStart(6)} ms  ${oneShot.padStart(5)} ms  ${old[3].padStart(5)} ms`);
});
console.log(`\nlongest slice anywhere: ${worst} ms; outputs that differ (sliced, one-shot, 3.6.0): ${mismatches}`);
