// Candidate rules for 1- and 2-channel grey passed bare, scored on features.json (run features.mjs first).
//   node bench/spikes/bare-grey/rules.mjs > bench/spikes/bare-grey/results-rules.txt
// Scores, from E[k] = mean |d[i] - d[i-k]| (eps keeps flat images at 1):
//   s1  = E4 / E1   grey (1 channel) is smoothest between neighbouring bytes; RGBA between pixels (lag 4)
//   s2  = E4 / E2   grey + alpha (2 channels) is smoothest at lag 2
//   c21 = E2 / E1   grey + alpha alternates grey and alpha bytes, so lag 1 is rough and lag 2 smooth
//   quad = share of changing pixels (RGBA reading) with four equal bytes: (g, g, g, g), a premultiplied white mask or
//          grey with alpha = grey, which real RGBA has and 1-channel grey only makes in flat runs of four
// Harmful: the palette of the misread bytes maps the true image at least 1.1× worse (MSE, k = 16, against at least 1).
import { readFileSync } from 'node:fs';

const rows = JSON.parse(readFileSync(new URL('./features.json', import.meta.url)));
const eps = 0.05;
for (const r of rows) {
    const [e1, e2, , e4] = r.E;
    r.s1 = (e4 + eps) / (e1 + eps); r.s2 = (e4 + eps) / (e2 + eps); r.c21 = (e2 + eps) / (e1 + eps);
    r.harmful = r.mse !== null && r.mse.wrong >= 1.1 * Math.max(1, r.mse.right);
    r.ratio = r.mse === null ? null : r.mse.wrong / Math.max(1, r.mse.right);
}
const MIN = 192; // the RGB check's floor
const rules = {
    grey2: (r, t = 1.1, c = 0.5) => r.size >= MIN && r.s2 > t && r.c21 < c,
    grey1: (r, t = 1.25) => r.size >= MIN && r.s1 > t && r.quad < 0.5,
};
const neg = rows.filter((r) => r.kind === 'rgba');
const f2 = (x) => (x === null ? '—' : x.toFixed(2));
const q = (xs, p) => {xs = xs.slice().sort((a, b) => a - b); return xs.length ? xs[Math.min(xs.length - 1, Math.floor(p * (xs.length - 1)))] : null;};

console.log(`Corpus: ${neg.length} real RGBA, ${rows.filter((r) => r.kind === 'grey1').length} grey (1 channel), ${rows.filter((r) => r.kind === 'grey2').length} grey + alpha (2 channels), lengths a multiple of 4 only`);
console.log('\n=== harm: misread palette MSE / correct palette MSE (floored at 1), k = 16 ===');
for (const kind of ['grey1', 'grey2']) {
    for (const g of [...new Set(rows.filter((r) => r.kind === kind).map((r) => r.group))]) {
        const rs = rows.filter((r) => r.group === g && r.kind === kind);
        console.log(`${kind} ${g.padEnd(46)} ${String(rs.length).padStart(4)}  harmful ${String(rs.filter((r) => r.harmful).length).padStart(4)}  ratio min ${f2(q(rs.map((r) => r.ratio), 0))} median ${f2(q(rs.map((r) => r.ratio), 0.5))} max ${f2(q(rs.map((r) => r.ratio), 1))}`);
    }
}
console.log('\n=== real RGBA closest to each rule ===');
console.log('grey2 (by c21 among s2 > 1.1):', neg.filter((r) => r.s2 > 1.1).sort((a, b) => a.c21 - b.c21).slice(0, 5).map((r) => `${r.group} ${r.name} s2 ${f2(r.s2)} c21 ${f2(r.c21)}`).join('; ') || 'none with s2 > 1.1');
console.log('grey2 (by s2 among c21 < 0.5):', neg.filter((r) => r.c21 < 0.5).sort((a, b) => b.s2 - a.s2).slice(0, 5).map((r) => `${r.group} ${r.name} s2 ${f2(r.s2)} c21 ${f2(r.c21)}`).join('; ') || 'none with c21 < 0.5');
console.log('grey1 (by s1 among quad < 0.5):', neg.filter((r) => r.quad < 0.5).sort((a, b) => b.s1 - a.s1).slice(0, 5).map((r) => `${r.group} ${r.name} s1 ${f2(r.s1)} quad ${f2(r.quad)}`).join('; '));
console.log('\n=== sweeps ===');
for (const [t, c] of [[1, 0.5], [1.1, 0.5], [1.1, 0.4], [1.1, 0.3], [1.2, 0.4], [1.25, 0.3]]) {
    const pos = rows.filter((r) => r.kind === 'grey2' && r.harmful);
    const big = pos.filter((r) => r.size >= 64 * 64 * 2);
    console.log(`grey2 s2 > ${t}, c21 < ${c}: false positives ${neg.filter((r) => rules.grey2(r, t, c)).length} of ${neg.length}; harmful caught ${pos.filter((r) => rules.grey2(r, t, c)).length} of ${pos.length}, at 64×64 and above ${big.filter((r) => rules.grey2(r, t, c)).length} of ${big.length}`);
}
for (const t of [1.15, 1.25, 1.5, 2]) {
    const pos = rows.filter((r) => r.kind === 'grey1' && r.harmful);
    const big = pos.filter((r) => r.size >= 64 * 64);
    console.log(`grey1 s1 > ${t}, quad < 0.5: false positives ${neg.filter((r) => rules.grey1(r, t)).length} of ${neg.length}; harmful caught ${pos.filter((r) => rules.grey1(r, t)).length} of ${pos.length}, at 64×64 and above ${big.filter((r) => rules.grey1(r, t)).length} of ${big.length}`);
}
console.log('\n=== each rule on the other kinds (defaults: grey2 s2 > 1.1, c21 < 0.5; grey1 s1 > 1.25, quad < 0.5) ===');
for (const kind of ['grey1', 'grey2']) {
    const rs = rows.filter((r) => r.kind === kind);
    console.log(`${kind}: grey2 rule fires on ${rs.filter((r) => rules.grey2(r)).length}, grey1 rule on ${rs.filter((r) => rules.grey1(r)).length}, the shipped RGB check on ${rs.filter((r) => r.rgbFlag).length} of ${rs.length}`);
}
console.log('\n=== harmful and missed (defaults), at 64×64 and above ===');
for (const kind of ['grey1', 'grey2']) {
    const missed = rows.filter((r) => r.kind === kind && r.harmful && r.size >= 64 * 64 * (kind === 'grey2' ? 2 : 1) && !rules[kind](r));
    const byGroup = {};
    for (const r of missed) {(byGroup[r.group] ??= []).push(r);}
    for (const [g, rs] of Object.entries(byGroup)) {console.log(`${kind} ${g.padEnd(46)} ${rs.length} missed, ratio up to ${f2(Math.max(...rs.map((r) => r.ratio)))}; s1 ${f2(q(rs.map((r) => r.s1), 0.5))} s2 ${f2(q(rs.map((r) => r.s2), 0.5))} c21 ${f2(q(rs.map((r) => r.c21), 0.5))} quad ${f2(q(rs.map((r) => r.quad), 0.5))}`);}
}

// ---- the sampled check (check.mjs), and how it sits beside the shipped RGB check ----
const T1 = 1.5;
console.log(`\n=== the sampled check (check.mjs: grey2 s2 > 1.1, c21 < 0.5; grey1 s1 > ${T1}, quad < 0.5; 512 windows) ===`);
{
    const differ = rows.filter((r) => (r.lean === 'grey-alpha') !== rules.grey2(r) || (r.lean === 'grey') !== (!rules.grey2(r) && rules.grey1(r, T1)));
    console.log(`decides differently from the whole-array rules on ${differ.length} of ${rows.length}` + (differ.length ? `: ${differ.slice(0, 8).map((r) => `${r.kind} ${r.group} ${r.name} → ${r.lean}`).join('; ')}` : ''));
}
console.log(`real RGBA flagged: ${neg.filter((r) => r.lean).length} of ${neg.length}`);
for (const [kind, want] of [['grey2', 'grey-alpha'], ['grey1', 'grey']]) {
    const pos = rows.filter((r) => r.kind === kind && r.harmful), big = pos.filter((r) => r.size >= 64 * 64 * (kind === 'grey2' ? 2 : 1));
    console.log(`${kind} harmful: named right ${pos.filter((r) => r.lean === want).length} of ${pos.length} (at 64×64 and above ${big.filter((r) => r.lean === want).length} of ${big.length}); named as the other grey ${pos.filter((r) => r.lean && r.lean !== want).length}; flagged by the RGB check ${pos.filter((r) => r.rgbFlag).length}; by either ${pos.filter((r) => r.lean || r.rgbFlag).length}`);
}
{
    const rgb = rows.filter((r) => r.kind === 'rgb');
    console.log(`rgb (3 channels): the grey check fires on ${rgb.filter((r) => r.lean).length} of ${rgb.length} (${rgb.filter((r) => r.lean && r.rgbFlag).length} of them also flagged as RGB; grey-alpha ${rgb.filter((r) => r.lean === 'grey-alpha').length}, grey ${rgb.filter((r) => r.lean === 'grey').length})`);
    for (const g of [...new Set(rgb.filter((r) => r.lean).map((r) => r.group))]) {console.log(`  ${g}: ${rgb.filter((r) => r.group === g && r.lean).length}`);}
}
console.log('\nOrder, if the RGB check runs first and the grey check only when it passes:');
for (const kind of ['rgb', 'grey1', 'grey2']) {
    const rs = rows.filter((r) => r.kind === kind && (r.harmful || kind === 'rgb'));
    const said = (r) => (r.rgbFlag ? 'rgb' : r.lean ?? 'none');
    const counts = {};
    for (const r of rs) {counts[said(r)] = (counts[said(r)] ?? 0) + 1;}
    console.log(`  ${kind}${kind === 'rgb' ? '' : ' harmful'} (${rs.length}): ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(', ')}`);
}
console.log('Order, if the grey check runs first:');
for (const kind of ['rgb', 'grey1', 'grey2']) {
    const rs = rows.filter((r) => r.kind === kind && (r.harmful || kind === 'rgb'));
    const said = (r) => r.lean ?? (r.rgbFlag ? 'rgb' : 'none');
    const counts = {};
    for (const r of rs) {counts[said(r)] = (counts[said(r)] ?? 0) + 1;}
    console.log(`  ${kind}${kind === 'rgb' ? '' : ' harmful'} (${rs.length}): ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(', ')}`);
}

// ---- one classifier for all three: which layout do these bytes have? ----
// grey + alpha first (it overlaps nothing); grey RGB by its equal triples; then, of 1 and 3 channels, the step at which
// the bytes are smoothest (E1 for grey, E3 for RGB), each still needing its own score over RGBA.
const classify = (r, t1 = T1) => {
    if (r.size < MIN) {return null;}
    if (rules.grey2(r)) {return 'grey-alpha';}
    const [e1, , e3] = r.E;
    const greyRgb = r.g3 > 0.9 && r.g4 < 0.6;
    if (greyRgb) {return 'rgb';}
    const rgb = r.rgbFlag, grey = rules.grey1(r, t1);
    if (rgb && grey) {return e1 < e3 ? 'grey' : 'rgb';}
    return rgb ? 'rgb' : grey ? 'grey' : null;
};
console.log('\n=== one classifier (grey + alpha; grey RGB by equal triples; else the smoother of lag 1 and lag 3) ===');
for (const t1 of [1.25, 1.5]) {
    console.log(`grey1 threshold s1 > ${t1}:`);
    for (const kind of ['rgba', 'rgb', 'grey1', 'grey2']) {
        const rs = rows.filter((r) => r.kind === kind && (r.harmful || kind === 'rgb' || kind === 'rgba'));
        const counts = {};
        for (const r of rs) {const c = classify(r, t1) ?? 'none'; counts[c] = (counts[c] ?? 0) + 1;}
        const big = rs.filter((r) => r.size >= 64 * 64 * (kind === 'grey2' ? 2 : kind === 'grey1' ? 1 : kind === 'rgb' ? 3 : 4));
        const bigCounts = {};
        for (const r of big) {const c = classify(r, t1) ?? 'none'; bigCounts[c] = (bigCounts[c] ?? 0) + 1;}
        console.log(`  ${(kind + (kind.startsWith('grey') ? ' harmful' : '')).padEnd(14)} (${rs.length}): ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(', ')}   | at 64×64 and above (${big.length}): ${Object.entries(bigCounts).map(([k, v]) => `${k} ${v}`).join(', ')}`);
    }
}
{
    const wrong = rows.filter((r) => r.kind === 'rgb' && classify(r) === 'grey');
    console.log('rgb named grey:', wrong.map((r) => `${r.group} ${r.name}`).join('; ') || 'none');
    const wrong1 = rows.filter((r) => r.kind === 'grey1' && r.harmful && classify(r) === 'rgb');
    const byGroup = {};
    for (const r of wrong1) {byGroup[r.group] = (byGroup[r.group] ?? 0) + 1;}
    console.log('harmful grey named rgb:', Object.entries(byGroup).map(([g, n]) => `${g} ${n}`).join('; ') || 'none');
}
