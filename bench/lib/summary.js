/**
 * Prints summary tables for a results object written by bench/run.js.
 *
 * Quality uses the shared palette mapping. Averages: mean PSNR and mean CIEDE2000 across
 * images, plus the geometric mean of each library's per-image MSE ratio to the reference
 * (the first library, normally agglomerative-clustering), so one hard image can't dominate.
 * Times are medians across images.
 */

export const median = (values) => {
    const sorted = values.filter(v => v != null).sort((a, b) => a - b);
    if (sorted.length === 0) {return null;}
    const mid = sorted.length >> 1;
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

export const mean = (values) => {
    const finite = values.filter(v => v != null && Number.isFinite(v));
    return finite.length ? finite.reduce((a, b) => a + b, 0) / finite.length : null;
};

export const geomean = (values) => {
    const positive = values.filter(v => v != null && Number.isFinite(v) && v > 0);
    return positive.length ? Math.exp(positive.reduce((a, b) => a + Math.log(b), 0) / positive.length) : null;
};

const fixed = (v, digits = 2) => (v == null ? '-' : v.toFixed(digits));
const ms = (v) => (v == null ? '-' : v >= 100 ? v.toFixed(0) : v.toFixed(1));

export function summarise({ meta, results, sweeps }) {
    const reference = meta.reference;
    const sets = [...new Set(results.map(r => r.set))];
    const libs = [...new Set(results.map(r => r.lib))];

    console.log(`\nCommit ${meta.commit ?? '?'}, Node ${meta.node}, ${meta.cpu ?? 'unknown CPU'}, ${meta.args.runs} run(s) per timing, ${meta.elapsedSeconds}s total.`);
    console.log(`Ratios and wins are against ${reference}: MSE ratio > 1 and wins < half mean the library is worse.`);

    for (const set of sets) {
        const images = [...new Set(results.filter(r => r.set === set).map(r => r.image))];
        console.log(`\n=== ${set} (${images.length} image${images.length === 1 ? '' : 's'}) ===`);

        for (const k of [...new Set(results.map(r => r.k))]) {
            const rows = results.filter(r => r.set === set && r.k === k);
            const refByImage = new Map(rows.filter(r => r.lib === reference).map(r => [r.image, r]));
            console.log(`\nk = ${k}`);
            console.table(libs.map(lib => {
                const own = rows.filter(r => r.lib === lib);
                const ratios = own.map(r => {const ref = refByImage.get(r.image); return ref && ref.shared.mse > 0 ? r.shared.mse / ref.shared.mse : null;});
                const wins = own.filter(r => {const ref = refByImage.get(r.image); return ref && r.shared.mse < ref.shared.mse;}).length;
                return {
                    library: lib,
                    colours: median(own.map(r => r.paletteSize)),
                    'PSNR dB': fixed(mean(own.map(r => r.shared.psnr))),
                    'ΔE2000': fixed(mean(own.map(r => r.shared.deltaE))),
                    'MSE ratio': lib === reference ? '1.00' : fixed(geomean(ratios)),
                    'wins': lib === reference ? '-' : `${wins}/${own.length}`,
                    'palette ms': ms(median(own.map(r => r.paletteMs))),
                    'quantize ms': ms(median(own.map(r => r.pipelineMs))),
                    'own-map PSNR': fixed(mean(own.map(r => r.own?.psnr))),
                };
            }));
        }

        const setSweeps = sweeps.filter(s => s.set === set);
        if (setSweeps.length) {
            console.log(`\nPalettes for every k in [${setSweeps[0].ks.join(', ')}], median ms per image:`);
            console.table(libs.map(lib => {
                const own = setSweeps.filter(s => s.lib === lib);
                return { library: lib, 'all k ms': ms(median(own.map(s => s.sweepMs))), how: own[0]?.measured ? 'one clustering, cut per k' : 'sum of per-k palettes' };
            }));
        }
    }
}
