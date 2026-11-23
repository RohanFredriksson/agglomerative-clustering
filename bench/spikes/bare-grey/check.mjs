// The candidate check, sampled as the shipped RGB check is (512 windows of 96 bytes, each starting on a multiple of 12,
// whole arrays up to 48 KB): returns 'grey' (1 channel), 'grey-alpha' (2 channels) or null.
export const MIN_BYTES = 192;
export const T2 = 1.1, C21 = 0.5, T1 = 1.5;

export function looksLikeGrey(d) {
    if (d.length < MIN_BYTES) {return null;}
    const whole = d.length <= 96 * 512;
    const windows = whole ? 1 : 512, size = whole ? d.length : 96;
    const step = whole ? 0 : Math.floor((d.length - 96) / 511 / 12) * 12;
    let e1 = 0, e2 = 0, e4 = 0, n = 0, changing = 0, quad = 0;
    for (let w = 0; w < windows; w++) {
        const start = w * step, end = start + size;
        for (let i = start + 4; i < end; i++) {
            const v = d[i], a = v - d[i - 1], b = v - d[i - 2], c = v - d[i - 4];
            e1 += a < 0 ? -a : a; e2 += b < 0 ? -b : b; e4 += c < 0 ? -c : c;
        }
        n += size - 4;
        for (let i = start + 4; i + 3 < end; i += 4) {
            if (d[i] === d[i - 4] && d[i + 1] === d[i - 3] && d[i + 2] === d[i - 2] && d[i + 3] === d[i - 1]) {continue;}
            changing++;
            if (d[i] === d[i + 1] && d[i] === d[i + 2] && d[i] === d[i + 3]) {quad++;}
        }
    }
    const E1 = e1 / n + 0.05, E2 = e2 / n + 0.05, E4 = e4 / n + 0.05;
    if (E4 / E2 > T2 && E2 / E1 < C21) {return 'grey-alpha';}
    if (E4 / E1 > T1 && quad < 0.5 * Math.max(1, changing)) {return 'grey';}
    return null;
}
