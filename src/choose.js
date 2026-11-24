// The search behind clustering.chooseFrom: k entries of a fixed palette that represent a clustered image well. It is the
// guides' chooseThreads + improveThreads (docs/guides.md), plus a fill step so the result always has k entries. It runs
// on whatever thread calls it and reaches the WebAssembly only through the functions it is given.

// Colours (3 bytes each) as coordinates to measure distance in: OKLab, or the sRGB values themselves.
function coordinates(rgb, space) {
    if (space === 'rgb') {return Float64Array.from(rgb);}
    const linear = (v) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    const out = new Float64Array(rgb.length);
    for (let i = 0; i < rgb.length; i += 3) {
        const r = linear(rgb[i]), g = linear(rgb[i + 1]), b = linear(rgb[i + 2]);
        const l = Math.cbrt(0.4122214708 * r + 0.5363329343 * g + 0.0514459929 * b);
        const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
        const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
        out[i] = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s;
        out[i + 1] = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s;
        out[i + 2] = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
    }
    return out;
}

// Positions in `entries`, in search order (unsorted), exactly k of them.
//   cut(k) → the k-colour palette; swatches() → {palette, weights} of the 1024 cut; snap(colours) → the nearest entry of
//   each colour (RGB); pause() → checks the signal, and yields when one was given.
export async function choose({cut, swatches, snap, pause}, entries, k, space) {

    const t = entries.length / 3;
    const {palette: colors, weights} = await swatches();
    const m = weights.length;
    // Nothing to fit (an empty image): the first k entries, the only choice there is.
    if (m === 0) {return Array.from({length: k}, (_, j) => j);}

    // Snap: the cuts from k up, each colour to its nearest entry; the first k distinct, in split order.
    let chosen = [];
    for (let c = k; c <= 4 * k && chosen.length < k; c++) {
        await pause();
        chosen = [...new Set(await snap(await cut(c)))].slice(0, k);
    }

    const a = coordinates(entries, space), b = coordinates(colors, space);
    const distance = new Float64Array(t * m);   // distance[j * m + i]: squared, from entry j to swatch i
    for (let j = 0; j < t; j++) {
        for (let i = 0; i < m; i++) {
            const dx = a[3 * j] - b[3 * i], dy = a[3 * j + 1] - b[3 * i + 1], dz = a[3 * j + 2] - b[3 * i + 2];
            distance[j * m + i] = dx * dx + dy * dy + dz * dz;
        }
    }

    // Fill: with fewer than k distinct entries, add the entry that lowers the error most, one at a time (ties: lower j).
    chosen = [...chosen];
    if (chosen.length < k) {
        const nearestDistance = new Float64Array(m).fill(Infinity);
        for (const j of chosen) {for (let i = 0; i < m; i++) {nearestDistance[i] = Math.min(nearestDistance[i], distance[j * m + i]);}}
        while (chosen.length < k) {
            await pause();
            let best = -1, lowest = Infinity;
            for (let j = 0; j < t; j++) {
                if (chosen.includes(j)) {continue;}
                let sum = 0;
                for (let i = 0; i < m; i++) {sum += weights[i] * Math.min(nearestDistance[i], distance[j * m + i]);}
                if (best < 0 || sum < lowest) {lowest = sum; best = j;}
            }
            chosen.push(best);
            for (let i = 0; i < m; i++) {nearestDistance[i] = Math.min(nearestDistance[i], distance[best * m + i]);}
        }
    }

    // Swap: entries in and out of `chosen` while that brings the image closer, measured on the swatches.
    const n = chosen.length;
    const nearest = new Int32Array(m), first = new Float64Array(m), second = new Float64Array(m), change = new Float64Array(n);
    for (;;) {
        await pause();
        // Each swatch's nearest chosen entry (its position in `chosen`) and the distances to the nearest two.
        let current = 0;
        for (let i = 0; i < m; i++) {
            let f = Infinity, g = Infinity, near = 0;
            for (let s = 0; s < n; s++) {
                const d = distance[chosen[s] * m + i];
                if (d < f) {g = f; f = d; near = s;} else if (d < g) {g = d;}
            }
            nearest[i] = near; first[i] = f; second[i] = g; current += weights[i] * f;
        }
        // For each unchosen entry j, one pass over the swatches gives the error after swapping j in at every position s:
        // current + shared + change[s]. Keep the best swap, if any is better.
        let best = null, lowest = current * (1 - 1e-9);
        for (let j = 0; j < t; j++) {
            if (j % 64 === 63) {await pause();}
            if (chosen.includes(j)) {continue;}
            let shared = 0;
            change.fill(0);
            for (let i = 0; i < m; i++) {
                const d = distance[j * m + i], gain = d < first[i] ? weights[i] * (d - first[i]) : 0;
                shared += gain;
                change[nearest[i]] += weights[i] * (Math.min(d, second[i]) - first[i]) - gain;
            }
            for (let s = 0; s < n; s++) {
                const error = current + shared + change[s];
                if (error < lowest) {lowest = error; best = [s, j];}
            }
        }
        if (!best) {return chosen;}
        chosen[best[0]] = best[1];
    }

}
