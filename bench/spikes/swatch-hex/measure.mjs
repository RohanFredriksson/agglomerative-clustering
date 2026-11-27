// What the "hex swatches, largest share first" recipe costs a user today, and what the best version of it costs.
//   1. The guides' "Heaviest first" block, copied as it stands: does it run? does it compile in strict TypeScript?
//   2. The best self-contained recipe (JavaScript and TypeScript): lines, correctness on the 24 Kodak photos, speed.
//   3. How often a hand-written toHex without padStart gives a wrong string.
// Usage (from the repo root, after npm run build): node bench/spikes/swatch-hex/measure.mjs > bench/spikes/swatch-hex/results.txt
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { loadavg } from 'node:os';
import sharp from 'sharp';
import { buildClustering, buildSwatches, version } from '../../../dist/index.mjs';
import { KODAK_IMAGES, ensureImage } from '../../../fixtures/kodak.js';

const root = new URL('../../../', import.meta.url).pathname;
const work = `${root}build/swatch-hex`;
rmSync(work, { recursive: true, force: true });
mkdirSync(`${work}/node_modules`, { recursive: true });
execFileSync('ln', ['-s', root, `${work}/node_modules/agglomerative-clustering`]);
console.log(`agglomerative-clustering ${version}, Node ${process.versions.node}`);

// ---------------------------------------------------------------- 1. the guides' block as it stands

// The guides as 4.3.1 shipped them, the broken block this measured (4.3.2 repaired it).
const guides = execFileSync('git', ['show', 'v4.3.1:docs/guides.md'], { cwd: root, encoding: 'utf8' });
const section = guides.slice(guides.indexOf('### Heaviest first'));
const block = section.match(/```js\n([\s\S]*?)```/)[1];
const lines = (code) => code.split('\n').filter((l) => l.trim() && !l.trim().startsWith('//')).length;
const image = `const image = { data: new Uint8Array([255,0,0,255, 0,0,255,255]), format: 'rgba', width: 2, height: 1 };\n`;
const imports = `import { buildSwatches } from 'agglomerative-clustering';\n`;

function run(name, code) {
    writeFileSync(`${work}/${name}.mjs`, code);
    try {
        execFileSync('node', [`${work}/${name}.mjs`], { stdio: ['ignore', 'pipe', 'pipe'] });
        return 'runs';
    } catch (error) {
        return String(error.stderr).split('\n').find((l) => /Error/.test(l)).trim();
    }
}
function compile(name, code, extra = {}) {
    writeFileSync(`${work}/${name}.mts`, code);
    try {
        const compilerOptions = { noEmit: true, strict: true, target: 'es2022', module: 'nodenext', lib: ['es2022', 'dom'], types: [], ...extra };
        writeFileSync(`${work}/tsconfig.json`, JSON.stringify({ compilerOptions, files: [`${name}.mts`] }));
        execFileSync(`${root}node_modules/.bin/tsc`, ['-p', 'tsconfig.json'], { cwd: work, stdio: ['ignore', 'pipe', 'pipe'] });
        return [];
    } catch (error) {
        return String(error.stdout).split('\n').filter((l) => /error TS/.test(l)).map((l) => l.replace(/^.*error /, ''));
    }
}

console.log(`\n1. The first "Heaviest first" block in 4.3.1's docs/guides.md (${lines(block)} lines of code)`);
console.log(`  copied alone, with an image defined:        ${run('alone', image + block)}`);
console.log(`  with the import added:                      ${run('imported', imports + image + block)}`);
const toHexLine = guides.match(/^const toHex = .*$/m)[0];
console.log(`  with the import and toHex (from the section above) added: ${run('complete', imports + image + toHexLine + '\n' + block)}`);
const guideErrors = compile('guide', imports + image.replace(`format: 'rgba'`, `format: 'rgba' as const`) + toHexLine + '\n' + block);
console.log(`  that complete version in strict TypeScript: ${guideErrors.length} errors`);
for (const e of guideErrors) console.log(`    ${e.slice(0, 150)}`);

// ---------------------------------------------------------------- 2. the best self-contained recipe

const body = `  return Array.from(shares, (share, i) => {
    const [r, g, b] = palette.subarray(3 * i, 3 * i + 3);
    const hex = '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
    return { color: [r, g, b], hex, share };
  }).sort((a, b) => b.share - a.share);   // equal shares keep split order
}
`;
const usage = `const ranked = rankSwatches(await buildSwatches(image, 8));\n`;
const bestJs = `import { buildSwatches } from 'agglomerative-clustering';

// Swatches as objects, the largest share first: [{ color: [r, g, b], hex: '#rrggbb', share }]
function rankSwatches({ palette, shares }) {
${body}`;
// TypeScript: the same body, with only the parameter (and its type import) added.
const bestTs = bestJs.replace('import { buildSwatches }', 'import { buildSwatches, type Swatches }').replace('({ palette, shares }) {', '({ palette, shares }: Swatches) {');
const runnable = (code) => code + `export { rankSwatches };\n`;
console.log(`\n2. The repaired block: self-contained, no wrapper`);
console.log(`  JavaScript: ${lines(bestJs)} lines of code with the import; ${run('best', bestJs + image + usage)}`);
console.log(`  TypeScript, the parameter annotated and nothing else:`);
console.log(`    runs (Node's type stripping): ${(() => { writeFileSync(`${work}/best-run.mts`, bestTs + image.replace(`format: 'rgba'`, `format: 'rgba' as const`) + usage); try { execFileSync('node', [`${work}/best-run.mts`], { stdio: ['ignore', 'pipe', 'pipe'] }); return 'yes'; } catch (e) { return String(e.stderr).split('\n').find((l) => /Error/.test(l)); } })()}`);
const typed = bestTs + image.replace(`format: 'rgba'`, `format: 'rgba' as const`) + usage + `export const first: string | undefined = ranked[0]?.hex;\n`;
for (const [label, extra] of [['strict', {}], ['strict + noUncheckedIndexedAccess', { noUncheckedIndexedAccess: true }]]) {
    const errors = compile('best-ts', typed, extra);
    console.log(`    ${label}: ${errors.length} errors ${errors.join('; ').slice(0, 300)}`);
}
const tuple = typed + `export const rgb: [number, number, number] | undefined = ranked[0]?.color;\n`;
const tupleErrors = compile('tuple', tuple);
console.log(`    passing \`color\` where a [number, number, number] is wanted: ${tupleErrors.length} errors ${tupleErrors.join('; ').slice(0, 200)}`);
console.log(`  JSON.stringify of buildSwatches' own result begins: ${JSON.stringify(await buildSwatches({ data: new Uint8Array([255,0,0,255, 0,0,255,255]), format: 'rgba' }, 2)).slice(0, 60)}…`);

writeFileSync(`${work}/best-module.mjs`, runnable(bestJs));
const { rankSwatches } = await import(`${work}/best-module.mjs`);
const ks = [1, 2, 3, 5, 8, 16, 32, 64, 128, 256];
let rankings = 0, swatchCount = 0, wrong = 0, short = 0, shortRankings = 0, firstShort = 0, looksValid = 0, smallK = 0, smallShort = 0;
const photos = [];
for (const name of KODAK_IMAGES) {
    const { data, info } = await sharp(await ensureImage(name)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    photos.push({ data: new Uint8Array(data.buffer, data.byteOffset, data.length), format: 'rgba', width: info.width, height: info.height });
}
for (const photo of photos) {
    const clustering = await buildClustering(photo);
    for (const k of ks) {
        const swatches = await clustering.getSwatches(k);
        const ranked = rankSwatches(swatches);
        rankings++;
        swatchCount += ranked.length;
        // Each entry's own (hex, colour, share), as a set: a ranking that mixed them up would differ.
        const reference = Array.from(swatches.shares, (share, i) => { const rgb = swatches.palette.subarray(3 * i, 3 * i + 3); return `#${Buffer.from(rgb).toString('hex')} ${rgb.join(',')} ${share}`; });
        const sorted = ranked.every((s, i) => i === 0 || ranked[i - 1].share >= s.share);
        const same = ranked.map((s) => `${s.hex} ${s.color.join(',')} ${s.share}`).sort().join('|') === [...reference].sort().join('|');
        if (!sorted || !same || ranked.some((s) => !/^#[0-9a-f]{6}$/.test(s.hex))) wrong++;
        // 3. toHex without padStart: any channel below 16 loses a digit.
        const bad = ranked.filter((s) => s.color.some((v) => v < 16)).length;
        short += bad;
        // Unpadded strings 3 or 4 digits long are still valid CSS colours (#rgb, #rgba), so they show a wrong colour silently.
        looksValid += ranked.filter((s) => [3, 4].includes(s.color.map((v) => v.toString(16)).join('').length)).length;
        if (k <= 8) { smallK += ranked.length; smallShort += bad; }
        if (bad > 0) shortRankings++;
        if (ranked[0].color.some((v) => v < 16)) firstShort++;
    }
}
console.log(`  checked on ${photos.length} Kodak photos, k = ${ks.join(', ')}: ${rankings} rankings, ${swatchCount} swatches; wrong order, or a hex or colour parted from its share: ${wrong}`);

const median = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];
const time = async (f, runs = 21) => { const t = []; for (let i = 0; i < runs; i++) { const s = performance.now(); await f(); t.push(performance.now() - s); } return median(t); };
console.log(`  speed (kodim23, median of 21; load ${loadavg().map((x) => x.toFixed(2)).join('/')})`);
const clustering = await buildClustering(photos[22]);
for (const k of [5, 256, 4096]) {
    const swatches = await clustering.getSwatches(k);
    console.log(`    k = ${k}: rankSwatches ${(await time(() => rankSwatches(swatches))).toFixed(3)} ms; getSwatches ${(await time(() => clustering.getSwatches(k))).toFixed(3)} ms; buildSwatches ${(await time(() => buildSwatches(photos[22], k), 5)).toFixed(1)} ms`);
}

console.log(`\n3. A hand-written toHex without padStart: ${short} of ${swatchCount} swatches (${(100 * short / swatchCount).toFixed(1)}%) would be malformed, in ${shortRankings} of ${rankings} rankings; the largest swatch itself in ${firstShort}. ${looksValid} of them are 3 or 4 digits long, which CSS reads as another colour. At k up to 8: ${smallShort} of ${smallK} (${(100 * smallShort / smallK).toFixed(1)}%).`);
