// Runs before em++ in `npm run build:wasm`: says how to get Emscripten when em++ isn't on PATH (instead of the shell's
// "em++: command not found"), and warns when its version isn't the one CI pins, since the .wasm then differs from the
// released one (the tests still run, but byte-level differences are possible).
import { execFileSync } from 'child_process';
import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const workflows = join(root, '.github', 'workflows');
const pinned = new Set();
for (const file of readdirSync(workflows).filter((name) => name.endsWith('.yml'))) {
    const text = readFileSync(join(workflows, file), 'utf8');
    for (const match of text.matchAll(/mymindstorm\/setup-emsdk[^\n]*\n(?:[^\n]*\n){0,3}?\s*version:\s*([0-9][0-9.]*)/g)) {pinned.add(match[1]);}
}

let version;
try {
    const output = execFileSync('em++', ['--version'], { encoding: 'utf8', shell: process.platform === 'win32' });
    version = output.match(/\b(\d+\.\d+\.\d+)\b/)?.[1];
} catch {
    console.error([
        'build:wasm needs Emscripten (em++), and it is not on PATH.',
        `Install the version CI uses (${[...pinned].join(', ') || 'see .github/workflows/ci.yml'}) with:`,
        '  scripts/setup-emsdk.sh',
        'then, in this shell:',
        '  source ~/.local/share/emsdk/emsdk_env.sh',
    ].join('\n'));
    process.exit(1);
}

if (version && pinned.size && !pinned.has(version)) {
    console.warn(`Warning: em++ is Emscripten ${version}, CI pins ${[...pinned].join(', ')}. The .wasm may differ from a release build; scripts/setup-emsdk.sh installs the pinned one.`);
}
