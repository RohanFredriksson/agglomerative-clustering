// Decodes data/*.jpg to raw RGBA (data/<id>.rgba) with ImageMagick (auto-orient, sRGB 8-bit, alpha 255) and writes data/images.json
// (width, height, pixels, distinct colours) for the photos and for the Kodak/mosaic/upscale images of ../perf-measure/data (linked).
import { execFileSync } from 'child_process';
import { readFileSync, writeFileSync, readdirSync, existsSync, symlinkSync, statSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const here = dirname(fileURLToPath(import.meta.url)), data = join(here, 'data');
const distinct = (rgba) => { const seen = new Uint8Array(1 << 21); let n = 0; for (let i = 0; i < rgba.length; i += 4) { const k = (rgba[i] << 16) | (rgba[i + 1] << 8) | rgba[i + 2]; const b = 1 << (k & 7); if (!(seen[k >> 3] & b)) { seen[k >> 3] |= b; n++; } } return n; };
const out = {};
for (const f of readdirSync(data).filter((f) => f.endsWith('.jpg'))) {
    const id = f.slice(0, -4);
    const [w, h] = execFileSync('magick', ['identify', '-auto-orient', '-format', '%w %h', join(data, f) + '[0]']).toString().trim().split(' ').map(Number);
    execFileSync('magick', [join(data, f) + '[0]', '-auto-orient', '-colorspace', 'sRGB', '-depth', '8', '-alpha', 'opaque', 'rgba:' + join(data, id + '.rgba')]);
    const rgba = readFileSync(join(data, id + '.rgba'));
    if (rgba.length !== w * h * 4) throw new Error(`${id}: ${rgba.length} bytes for ${w}x${h}`);
    out[id] = { width: w, height: h, pixels: w * h, distinct: distinct(rgba), how: 'photo' };
    console.log(id, out[id]);
}
const old = JSON.parse(readFileSync(join(here, '../perf-measure/data/images.json'), 'utf8'));
for (const [id, v] of Object.entries(old)) {
    if (id === 'noise150') continue;
    const dst = join(data, id + '.rgba');
    if (!existsSync(dst)) symlinkSync('../../perf-measure/data/' + id + '.rgba', dst);
    out[id] = v;
}
writeFileSync(join(data, 'images.json'), JSON.stringify(out, null, 1));
