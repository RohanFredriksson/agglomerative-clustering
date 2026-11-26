// Writes the 24 Kodak photos as raw RGBA to data/kNN.rgba (kodim23 is k23, as in ../perf-measure) and adds them to data/images.json.
import { getImageRgba } from '../../../fixtures/kodak.js';
import { writeFileSync, readFileSync, existsSync, lstatSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const here = dirname(fileURLToPath(import.meta.url)), root = join(here, '../../..');
const metaPath = join(here, 'data/images.json'), meta = JSON.parse(readFileSync(metaPath, 'utf8'));
for (let n = 1; n <= 24; n++) {
    const id = 'k' + String(n).padStart(2, '0');
    const r = await getImageRgba(join(root, `fixtures/images/kodim${String(n).padStart(2, '0')}.png`));
    const rgba = r.rgba ?? r, w = r.width ?? 768, h = r.height ?? 512;
    if (rgba.length !== w * h * 4) throw new Error(id + ' size');
    const f = join(here, 'data', id + '.rgba');
    if (!existsSync(f) || !lstatSync(f).isSymbolicLink()) writeFileSync(f, rgba);
    meta[id] ??= { width: w, height: h, pixels: w * h, how: 'kodim' + n };
}
writeFileSync(metaPath, JSON.stringify(meta, null, 1));
