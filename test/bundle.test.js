// The package must bundle with esbuild (what Wrangler, tsup and many others use) for the browser and for neutral
// platforms such as Cloudflare Workers, with no errors or warnings. Literal Node-only imports in the Emscripten glue
// used to stop this ("Could not resolve node:module"), see scripts/patch-glue.mjs.
import { describe, it, expect } from 'vitest';
import { build } from 'esbuild';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const dist = resolve(dirname(fileURLToPath(import.meta.url)), '../dist');

describe('bundling with esbuild', () => {

    it.each([
        ['main entry', 'index.mjs', 'browser'],
        ['main entry', 'index.mjs', 'neutral'],
        ['worker entry', 'worker.mjs', 'browser'],
        ['worker thread script', 'worker-thread.mjs', 'neutral'],
    ])('%s (%s) for platform %s', async (_, file, platform) => {
        const result = await build({
            entryPoints: [resolve(dist, file)], bundle: true, write: false, format: 'esm', platform, logLevel: 'silent',
            mainFields: ['module', 'main'], conditions: ['import', 'default'],
        });
        expect(result.errors).toEqual([]);
        expect(result.warnings).toEqual([]);
        expect(result.outputFiles[0].text).not.toContain('"node:module"');
    });

});
