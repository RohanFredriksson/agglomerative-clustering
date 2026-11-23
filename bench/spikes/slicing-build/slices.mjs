// Builds slices.cpp with em++ against master's clustering.cpp (before) and the working tree's (after), and runs both.
//   source ~/.local/share/emsdk/emsdk_env.sh; node bench/spikes/slicing-build/slices.mjs > bench/spikes/slicing-build/results-slices.txt
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';
import { KODAK_IMAGES, ensureImage } from '../../../fixtures/kodak.js';

const root = new URL('../../../', import.meta.url).pathname, out = `${root}build/slicing-build`;
mkdirSync(`${out}/master`, { recursive: true });
for (const f of ['clustering.cpp', 'clustering.hpp', 'colorspace.hpp', 'version.hpp']) {
    writeFileSync(`${out}/master/${f}`, execFileSync('git', ['show', `master:src/${f}`], { cwd: root }));
}
const photo = `${out}/photo.rgba`;
writeFileSync(photo, await sharp(await ensureImage(KODAK_IMAGES[22])).resize(4240, 2832).ensureAlpha().raw().toBuffer());
for (const [label, source] of [['before (master)', `${out}/master/clustering.cpp`], ['after', `${root}src/clustering.cpp`]]) {
    const js = `${out}/${label.split(' ')[0]}.cjs`;
    execFileSync('em++', ['-std=c++17', '-O3', '-msimd128', '-sALLOW_MEMORY_GROWTH=1', '-sMAXIMUM_MEMORY=4GB', '-sNODERAWFS=1', `-DSOURCE="${source}"`, `${root}bench/spikes/slicing-build/slices.cpp`, '-o', js], { stdio: ['ignore', 'ignore', 'inherit'] });
    console.log(`== ${label}`);
    console.log(execFileSync('node', [js, photo], { encoding: 'utf8' }).trimEnd());
}
