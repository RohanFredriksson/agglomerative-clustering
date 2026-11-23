// Builds resume.cpp with em++ (-fsanitize=address,undefined) and runs it.
//   source ~/.local/share/emsdk/emsdk_env.sh; node bench/spikes/slicing-build/resume.mjs > bench/spikes/slicing-build/results-resume.txt
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const root = new URL('../../../', import.meta.url).pathname, out = `${root}build/slicing-build`;
mkdirSync(out, { recursive: true });
execFileSync('em++', ['-std=c++17', '-O1', '-g', '-msimd128', '-fsanitize=address,undefined', '-sALLOW_MEMORY_GROWTH=1', '-sMAXIMUM_MEMORY=4GB', '-sINITIAL_MEMORY=512MB',
    `${root}bench/spikes/slicing-build/resume.cpp`, '-o', `${out}/resume.cjs`], { stdio: ['ignore', 'ignore', 'inherit'] });
process.stdout.write(execFileSync('node', [`${out}/resume.cjs`], { encoding: 'utf8' }));
