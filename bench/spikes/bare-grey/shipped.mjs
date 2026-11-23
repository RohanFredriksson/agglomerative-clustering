// The shipped check (bareLayout in dist/shared.mjs) on the whole corpus, against the spike's rules and 3.5.0's RGB
// check (features.json, recorded with 3.5.0's dist). Run features.mjs first.
//   node bench/spikes/bare-grey/shipped.mjs > bench/spikes/bare-grey/results-shipped.txt
import { readFileSync } from 'node:fs';
import { bareLayout } from '../../../dist/shared.mjs';
import { corpus } from './corpus.mjs';

const recorded = new Map(JSON.parse(readFileSync(new URL('./features.json', import.meta.url))).map((r) => [`${r.kind}|${r.group}|${r.name}`, r]));
const rows = [];
for await (const row of corpus()) {
    if (row.bytes.length % 4 !== 0) {continue;}
    const r = recorded.get(`${row.kind}|${row.group}|${row.name}`);
    rows.push({ kind: row.kind, group: row.group, size: row.bytes.length, now: bareLayout(row.bytes), spike: r ? (r.rgbFlag ? 'rgb' : r.lean) : undefined, was: r ? r.rgbFlag : undefined, harmful: r && r.mse ? r.mse.wrong >= 1.1 * Math.max(1, r.mse.right) : undefined });
}
const want = { rgba: null, rgb: 'rgb', grey1: 'grey', grey2: 'grey-alpha' };
const big = (r) => r.size >= 64 * 64 * { rgba: 4, rgb: 3, grey1: 1, grey2: 2 }[r.kind];
console.log('Shipped bareLayout (jittered windows), by kind; "spike" is the RGB check then check.mjs, as measured before the jitter');
for (const kind of ['rgba', 'rgb', 'grey1', 'grey2']) {
    const rs = rows.filter((r) => r.kind === kind && (r.harmful !== false));
    const count = (f) => {const c = {}; for (const r of rs.filter(f)) {const k = r.now ?? 'none'; c[k] = (c[k] ?? 0) + 1;} return Object.entries(c).map(([k, v]) => `${k} ${v}`).join(', ');};
    console.log(`  ${kind}${kind.startsWith('grey') ? ' (harmful)' : ''}: ${rs.length}: ${count(() => true)} | at 64×64 and above: ${count(big)}`);
}
console.log('\nDecided differently from the spike (before the jitter), by group:');
const diff = {};
for (const r of rows.filter((r) => r.spike !== undefined && r.now !== r.spike)) {const k = `${r.kind} ${r.group}: ${r.spike ?? 'none'} → ${r.now ?? 'none'}`; diff[k] = (diff[k] ?? 0) + 1;}
for (const [k, v] of Object.entries(diff)) {console.log(`  ${k}: ${v}`);}
console.log('\nNew cases with a flat margin (not in the spike):');
for (const group of ['kodak: rgb cutout on black', 'kodak: grey + alpha, cutout, transparent zeroed']) {
    const rs = rows.filter((r) => r.group === group);
    const c = {}; for (const r of rs) {const k = r.now ?? 'none'; c[k] = (c[k] ?? 0) + 1;}
    console.log(`  ${group}: ${Object.entries(c).map(([k, v]) => `${k} ${v}`).join(', ')} of ${rs.length}`);
}
const fp = rows.filter((r) => r.kind === 'rgba' && r.now !== null);
console.log(`\nReal RGBA flagged: ${fp.length} of ${rows.filter((r) => r.kind === 'rgba').length}`);
const rgbAsGrey = rows.filter((r) => r.kind === 'rgb' && r.now && r.now !== 'rgb');
console.log(`RGB called grey: ${rgbAsGrey.length} of ${rows.filter((r) => r.kind === 'rgb').length}`);
