// Runs the README's marked snippets (a fenced js block after <!-- snippet -->) against dist/, on small in-memory
// images, so the page can't show code that throws. Each block's last line is an expression whose value must not be
// undefined. `image`, `imageData` and `chart` (24 colours, flat RGB) are in scope.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as library from '../dist/index.mjs';

const readme = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../README.md'), 'utf8');
const snippets = [...readme.matchAll(/<!-- snippet (\w+) -->\s*```js\n([\s\S]*?)```/g)].map((m) => [m[1], m[2].trimEnd()]);

const width = 32;
const data = new Uint8Array(width * width * 4);
for (let i = 0; i < width * width; i++) data.set([(i * 7) % 256, (i * 13) % 256, (i * 29) % 256, 255], 4 * i);
const image = { data, format: 'rgba', width, height: width };
const imageData = new ImageData(new Uint8ClampedArray(data), width, width);
const chart = Uint8Array.from({ length: 72 }, (_, i) => (i * 53 + 17) % 256);

// What the README says about each snippet's result.
const pixels = width * width;
const checks = {
    pixelart: ({ frames }) => {
        expect(frames).toHaveLength(4);
        frames.forEach((f, i) => {
            expect(f.indices).toHaveLength(pixels);
            expect(f.palette.length / 3).toBeLessThanOrEqual([4, 8, 16, 32][i]);
            expect(Math.max(...f.indices)).toBeLessThan(f.palette.length / 3);
        });
    },
    eink: ({ indices }) => {
        expect(indices).toHaveLength(pixels);
        expect(Math.max(...indices)).toBeLessThan(7);
    },
    threads: ({ indices }) => {
        expect(indices).toHaveLength(pixels);
        expect(Math.max(...indices)).toBeLessThan(12);
    },
    transparency: ({ reduced }) => {
        expect(reduced.format).toBe('rgba');
        expect(reduced.data).toHaveLength(data.length);
        for (let i = 3; i < data.length; i += 4) expect(reduced.data[i]).toBe(data[i]);
    },
    swatches: ({ shares }) => {
        expect(shares).toHaveLength(8);
        expect(Math.abs(Array.from(shares).reduce((a, b) => a + b, 0) - 1)).toBeLessThan(1e-9);
    },
    animation: ({ frame }) => {
        expect(frame.indices).toHaveLength(pixels);
        expect(Math.max(...frame.indices)).toBeLessThan(frame.palette.length / 3);
    },
};

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

describe('README snippets', () => {
    it('has marked snippets', () => {
        expect(snippets.length).toBeGreaterThanOrEqual(6);
    });
    for (const [id, code] of snippets) {
        it(`runs snippet ${id}: ${code.split('\n').find((l) => l.trim() && !l.startsWith('import')).slice(0, 50)}`, async () => {
            const body = code.replace(/^import \{([^}]*)\} from 'agglomerative-clustering';$/gm, 'const {$1} = library;');
            expect(body).not.toMatch(/\bimport\b/);
            // The values the block declares at its top level, by name (the imported functions among them).
            const names = [...body.matchAll(/^(?:const|let) (\{[^}]*\}|\w+)/gm)]
                .flatMap((m) => m[1].replace(/[{}]/g, '').split(',').map((n) => n.trim().split(':').pop().trim()))
                .filter(Boolean);
            const run = new AsyncFunction('library', 'image', 'imageData', 'chart', `${body}\nreturn { ${names.join(', ')} };`);
            const result = await run(library, image, imageData, chart);
            expect(Object.keys(result).length).toBeGreaterThan(0);
            for (const [name, value] of Object.entries(result)) expect(value, name).not.toBeUndefined();
            checks[id]?.(result);
        });
    }
});
