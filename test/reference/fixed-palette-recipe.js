// The fixed-palette recipe of 3.7.2 (docs/guides.md, "Choosing colours from a fixed palette"), copied verbatim, as the
// reference that clustering.chooseFrom is tested against. `entry` is the library module (the function the recipe calls);
// returns the recipe's chooseThreads and improveThreads.
export function recipe(entry) {
  const { quantizeToIndicesWithPalette } = entry;

  // The indices of n threads that represent the clustered image well.
  async function chooseThreads(clustering, threads, n) {
    let chosen = [];
    for (let k = n; k <= 4 * n && chosen.length < n; k++) {
      const cut = await clustering.getPalette(k);
      // The cut palette as an image of one pixel per colour, mapped to the threads.
      const { indices } = await quantizeToIndicesWithPalette({ data: cut, format: 'rgb' }, threads);
      // Split order puts the coarsest colours first, so when a cut gives more than n threads, the first n are kept.
      chosen = [...new Set(indices)].slice(0, n);
    }
    return chosen;   // can be fewer than n for an image with few colours
  }

  // Swaps threads in and out of `chosen` while that brings the image closer, measured on 1024 swatches. `space`: 'rgb'
  // (sRGB values, which PSNR measures) or 'oklab' (a lower mean ΔE2000, but it can grey out small vivid areas).
  async function improveThreads(clustering, threads, chosen, space = 'rgb') {
    if (space !== 'oklab' && space !== 'rgb') {throw new TypeError(`Invalid space: expected 'oklab' or 'rgb', got ${space}`);}
    const { palette: colors, weights } = await clustering.getSwatches(1024);
    const a = coordinates(threads, space), b = coordinates(colors, space);
    const m = weights.length, t = threads.length / 3, n = chosen.length;
    const distance = new Float64Array(t * m);   // distance[j * m + i]: squared, from thread j to swatch i
    for (let j = 0; j < t; j++) {
      for (let i = 0; i < m; i++) {
        const dx = a[3 * j] - b[3 * i], dy = a[3 * j + 1] - b[3 * i + 1], dz = a[3 * j + 2] - b[3 * i + 2];
        distance[j * m + i] = dx * dx + dy * dy + dz * dz;
      }
    }
    chosen = [...chosen];
    const nearest = new Int32Array(m), first = new Float64Array(m), second = new Float64Array(m), change = new Float64Array(n);
    for (;;) {
      // Each swatch's nearest chosen thread (its position in `chosen`) and the distances to the nearest two.
      let current = 0;
      for (let i = 0; i < m; i++) {
        let f = Infinity, g = Infinity, near = 0;
        for (let s = 0; s < n; s++) {
          const d = distance[chosen[s] * m + i];
          if (d < f) {g = f; f = d; near = s;} else if (d < g) {g = d;}
        }
        nearest[i] = near; first[i] = f; second[i] = g; current += weights[i] * f;
      }
      // For each unchosen thread j, one pass over the swatches gives the error after swapping j in at every position s:
      // current + shared + change[s]. Keep the best swap, if any is better.
      let best = null, lowest = current * (1 - 1e-9);
      for (let j = 0; j < t; j++) {
        if (chosen.includes(j)) {continue;}
        let shared = 0;   // what j gains on the swatches it brings closer, whichever thread it replaces
        change.fill(0);   // change[s]: the rest of the change, on the swatches whose nearest thread is at s
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

  return { chooseThreads, improveThreads };
}
