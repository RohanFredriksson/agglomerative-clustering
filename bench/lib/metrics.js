/**
 * Quality metrics and a shared palette mapping.
 *
 * Every library's palette is mapped to pixels with the same function (`mapToPalette`:
 * nearest colour by squared RGB distance) so the metrics compare palettes, not each
 * library's own pixel-mapping choices. All buffers are RGBA; alpha is ignored.
 */

/** Unpacks a palette given as flat RGB bytes into an array of [r, g, b]. */
export function paletteColours(palette) {
    const colours = [];
    for (let i = 0; i + 2 < palette.length; i += 3) {colours.push([palette[i], palette[i + 1], palette[i + 2]]);}
    return colours;
}

/** Maps every pixel to its nearest palette colour (squared RGB distance; first colour wins ties). */
export function mapToPalette(rgba, palette) {
    const colours = paletteColours(palette);
    const out = new Uint8Array(rgba.length);
    const cache = new Map();
    for (let i = 0; i < rgba.length; i += 4) {
        const r = rgba[i], g = rgba[i + 1], b = rgba[i + 2];
        const key = (r << 16) | (g << 8) | b;
        let best = cache.get(key);
        if (best === undefined) {
            let bestDistance = Infinity;
            for (let j = 0; j < colours.length; j++) {
                const c = colours[j];
                const dr = r - c[0], dg = g - c[1], db = b - c[2];
                const d = dr * dr + dg * dg + db * db;
                if (d < bestDistance) {bestDistance = d; best = j;}
            }
            cache.set(key, best);
        }
        const c = colours[best];
        out[i] = c[0]; out[i + 1] = c[1]; out[i + 2] = c[2]; out[i + 3] = rgba[i + 3];
    }
    return out;
}

/** Mean squared error per channel over RGB. */
export function mse(original, quantized) {
    let sum = 0;
    for (let i = 0; i < original.length; i += 4) {
        const dr = original[i] - quantized[i];
        const dg = original[i + 1] - quantized[i + 1];
        const db = original[i + 2] - quantized[i + 2];
        sum += dr * dr + dg * dg + db * db;
    }
    return sum / (original.length / 4 * 3);
}

export function psnr(mseValue) {
    return mseValue === 0 ? Infinity : 10 * Math.log10(255 * 255 / mseValue);
}

// sRGB (D65) -> CIELAB
const linear = new Float64Array(256).map((_, i) => {
    const c = i / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
});

function labFromKey(key) {
    const r = linear[key >> 16], g = linear[(key >> 8) & 255], b = linear[key & 255];
    const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
    const fx = f((0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047);
    const fy = f(0.2126729 * r + 0.7151522 * g + 0.0721750 * b);
    const fz = f((0.0193339 * r + 0.1191920 * g + 0.9503041 * b) / 1.08883);
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

const deg = Math.PI / 180;

/** CIEDE2000 colour difference between two CIELAB colours (kL = kC = kH = 1). */
export function ciede2000([L1, a1, b1], [L2, a2, b2]) {
    const C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2);
    const Cbar7 = ((C1 + C2) / 2) ** 7;
    const G = 0.5 * (1 - Math.sqrt(Cbar7 / (Cbar7 + 25 ** 7)));
    const a1p = (1 + G) * a1, a2p = (1 + G) * a2;
    const C1p = Math.hypot(a1p, b1), C2p = Math.hypot(a2p, b2);
    const h1p = C1p === 0 ? 0 : (Math.atan2(b1, a1p) / deg + 360) % 360;
    const h2p = C2p === 0 ? 0 : (Math.atan2(b2, a2p) / deg + 360) % 360;

    const dLp = L2 - L1;
    const dCp = C2p - C1p;
    let dhp = 0;
    if (C1p * C2p !== 0) {
        dhp = h2p - h1p;
        if (dhp > 180) {dhp -= 360;} else if (dhp < -180) {dhp += 360;}
    }
    const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(dhp / 2 * deg);

    const Lbarp = (L1 + L2) / 2;
    const Cbarp = (C1p + C2p) / 2;
    let hbarp = h1p + h2p;
    if (C1p * C2p !== 0) {
        if (Math.abs(h1p - h2p) <= 180) {hbarp /= 2;}
        else {hbarp = h1p + h2p < 360 ? (hbarp + 360) / 2 : (hbarp - 360) / 2;}
    }

    const T = 1 - 0.17 * Math.cos((hbarp - 30) * deg) + 0.24 * Math.cos(2 * hbarp * deg)
            + 0.32 * Math.cos((3 * hbarp + 6) * deg) - 0.20 * Math.cos((4 * hbarp - 63) * deg);
    const dTheta = 30 * Math.exp(-(((hbarp - 275) / 25) ** 2));
    const Cbarp7 = Cbarp ** 7;
    const RC = 2 * Math.sqrt(Cbarp7 / (Cbarp7 + 25 ** 7));
    const SL = 1 + (0.015 * (Lbarp - 50) ** 2) / Math.sqrt(20 + (Lbarp - 50) ** 2);
    const SC = 1 + 0.045 * Cbarp;
    const SH = 1 + 0.015 * Cbarp * T;
    const RT = -Math.sin(2 * dTheta * deg) * RC;

    const l = dLp / SL, c = dCp / SC, h = dHp / SH;
    return Math.sqrt(l * l + c * c + h * h + RT * c * h);
}

/** Mean CIEDE2000 over all pixels. Each distinct (original, quantized) pair is computed once. */
export function meanDeltaE(original, quantized) {
    const labs = new Map();
    const lab = (key) => {
        let v = labs.get(key);
        if (v === undefined) {v = labFromKey(key); labs.set(key, v);}
        return v;
    };
    const pairs = new Map();
    let sum = 0;
    for (let i = 0; i < original.length; i += 4) {
        const o = (original[i] << 16) | (original[i + 1] << 8) | original[i + 2];
        const q = (quantized[i] << 16) | (quantized[i + 1] << 8) | quantized[i + 2];
        if (o === q) {continue;}
        const key = o * 16777216 + q;
        let d = pairs.get(key);
        if (d === undefined) {d = ciede2000(lab(o), lab(q)); pairs.set(key, d);}
        sum += d;
    }
    return sum / (original.length / 4);
}

export function measure(original, quantized) {
    const m = mse(original, quantized);
    return { mse: m, psnr: psnr(m), deltaE: meanDeltaE(original, quantized) };
}
