// Longest real slice: the longest gap between turns of the event loop while a controlled clustering runs (a ticker
// on setImmediate), next to the longest gap between onProgress calls (which only fire when the progress value changes,
// so they span several slices where it stalls).
// Usage: node gaps.mjs <dist dir> [rgba raw dir]
import { readFileSync, existsSync } from 'fs';
import { loadavg } from 'os';
const [dir, rawDir] = process.argv.slice(2);
const lib = await import(dir + '/index.mjs');
const raw = (n, w, h) => ({data: new Uint8Array(readFileSync(rawDir + '/' + n + '.rgba')), format: 'rgba', width: w, height: h});
const images = {'block + 25% scatter': raw('block', 512, 640), 'dark block + 25% scatter': raw('dark', 512, 640), 'noise 1024^2': raw('noise', 1024, 1024)};
if (process.env.KODAK) {
  const { getImageRgba } = await import(process.env.KODAK);
  for (const n of ['kodim23', 'kodim14']) { const i = await getImageRgba(n + '.png'); images[n] = {data: new Uint8Array(i.rgba), format: 'rgba', width: i.width, height: i.height}; }
}
await lib.buildClustering(raw('noise', 1024, 1024).data.length ? {data: new Uint8Array(64), format: 'rgba', width: 4, height: 4} : null);
console.log(`load before ${loadavg().map((x) => x.toFixed(2)).join('/')}`);
for (const [name, img] of Object.entries(images)) for (const [cfg, opts] of [['rgb8', {}], ['oklab', {colorSpace: 'oklab'}]]) {
  let loop = 0, progress = 0;
  for (let r = 0; r < 3; r++) {
    let running = true, last = performance.now(), worst = 0, lastP = last, worstP = 0;
    const tick = () => { const t = performance.now(); worst = Math.max(worst, t - last); last = t; if (running) setImmediate(tick); };
    setImmediate(tick);
    await lib.buildClustering(img, {...opts, onProgress: () => { const t = performance.now(); worstP = Math.max(worstP, t - lastP); lastP = t; }});
    running = false; await new Promise((r) => setImmediate(r));
    loop = Math.max(loop, worst); progress = Math.max(progress, worstP);
  }
  console.log(`${name}\t${cfg}\tlongest slice (event-loop gap) ${loop.toFixed(1)} ms\tlongest onProgress gap ${progress.toFixed(1)} ms`);
}
console.log(`load after ${loadavg().map((x) => x.toFixed(2)).join('/')}`);
