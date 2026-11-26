// Runs the README's marked snippets (a fenced js block after <!-- snippet -->) against dist/, on small in-memory
// images, so the page can't show code that throws. Each block's last line is an expression whose value must not be
// undefined. `image`, `imageData` and `chart` (24 colours, flat RGB) are in scope.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as library from '../dist/index.mjs';

const readme = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../README.md'), 'utf8');
const snippets = [...readme.matchAll(/<!-- snippet -->\s*```js\n([\s\S]*?)```/g)].map((m) => m[1].trimEnd());

const width = 32;
const data = new Uint8Array(width * width * 4);
for (let i = 0; i < width * width; i++) data.set([(i * 7) % 256, (i * 13) % 256, (i * 29) % 256, 255], 4 * i);
const image = { data, format: 'rgba', width, height: width };
const imageData = new ImageData(new Uint8ClampedArray(data), width, width);
const chart = Uint8Array.from({ length: 72 }, (_, i) => (i * 53 + 17) % 256);

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

describe('README snippets', () => {
    it('has marked snippets', () => {
        expect(snippets.length).toBeGreaterThanOrEqual(6);
    });
    for (const [n, code] of snippets.entries()) {
        it(`runs snippet ${n + 1}: ${code.split('\n').find((l) => l.trim() && !l.startsWith('import')).slice(0, 50)}`, async () => {
            const lines = code.split('\n');
            const last = lines.pop().trim().replace(/;$/, '');
            const body = lines
                .join('\n')
                .replace(/^import \{([^}]*)\} from 'agglomerative-clustering';$/gm, 'const {$1} = library;');
            expect(body).not.toMatch(/\bimport\b/);
            const run = new AsyncFunction('library', 'image', 'imageData', 'chart', `${body}\nreturn (${last});`);
            expect(await run(library, image, imageData, chart)).not.toBeUndefined();
        });
    }
});
