// The candidate check, as the library would ship it (used by measure.mjs and evidence.mjs).
export const MIN_BYTES = 192;

export // lags 3 and 4 and the two grey counts only, 512 windows of 96 bytes.
function looksLikeRgb(d) {
    if (d.length < MIN_BYTES) {return false;}
    let e3 = 0, e4 = 0, n = 0, g3 = 0, n3 = 0, g4 = 0, q4 = 0, n4 = 0;
    const windows = d.length <= 96 * 512 ? 1 : 512, size = windows === 1 ? d.length : 96;
    const step = windows === 1 ? 0 : Math.floor((d.length - 96) / 511 / 12) * 12;
    for (let w = 0; w < windows; w++) {
        const start = w * step, end = start + size;
        for (let i = start + 4; i < end; i++) {
            const v = d[i], a = v - d[i - 3], b = v - d[i - 4];
            e3 += a < 0 ? -a : a; e4 += b < 0 ? -b : b;
        }
        n += size - 4;
        for (let i = start + 3; i + 2 < end; i += 3) {
            if (d[i] === d[i - 3] && d[i + 1] === d[i - 2] && d[i + 2] === d[i - 1]) {continue;}
            n3++; if (d[i] === d[i + 1] && d[i] === d[i + 2]) {g3++;}
        }
        for (let i = start + 4; i + 3 < end; i += 4) {
            if (d[i] === d[i - 4] && d[i + 1] === d[i - 3] && d[i + 2] === d[i - 2] && d[i + 3] === d[i - 1]) {continue;}
            n4++; if (d[i] === d[i + 1] && d[i] === d[i + 2]) {g4++; if (d[i] === d[i + 3]) {q4++;}}
        }
    }
    const s3 = (e4 / n + 0.05) / (e3 / n + 0.05);
    return (s3 > 1.25 && q4 < 0.5 * Math.max(1, n4)) || (g3 > 0.9 * Math.max(1, n3) && g4 < 0.6 * Math.max(1, n4));
}
