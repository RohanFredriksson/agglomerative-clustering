// Downloads the real RGBA images the bare-RGB measurement uses: every 9th emoji of Twemoji 14.0.2 (72×72) and of
// Noto Emoji 2.047 (128×128), about 400 of each. Anti-aliased edges and soft shadows make them the likeliest real
// false positives of a check on the alpha byte. Saved to fixtures/images/bare-rgb/ (gitignored).
//   node bench/spikes/bare-rgb/fetch-images.mjs
import { mkdir, access, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../../fixtures/images/bare-rgb');

async function listTwemoji() {
    const res = await fetch('https://data.jsdelivr.com/v1/package/gh/twitter/twemoji@14.0.2/flat');
    const { files } = await res.json();
    return files.map((f) => f.name).filter((n) => n.startsWith('/assets/72x72/')).sort()
        .map((n) => `https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2${n}`);
}

function listNoto() {
    // jsDelivr won't list a package over 50 MB, so the file list comes from GitHub's tree API (needs `gh`).
    const out = execFileSync('gh', ['api', 'repos/googlefonts/noto-emoji/git/trees/v2.047?recursive=1',
        '--jq', '.tree[].path | select(startswith("png/128/"))'], { encoding: 'utf8' });
    return out.trim().split('\n').sort().map((p) => `https://cdn.jsdelivr.net/gh/googlefonts/noto-emoji@v2.047/${p}`);
}

async function fetchAll(set, urls) {
    const dir = join(root, set);
    await mkdir(dir, { recursive: true });
    const picked = urls.filter((_, i) => i % 9 === 0);
    let fetched = 0;
    for (let i = 0; i < picked.length; i += 16) {
        await Promise.all(picked.slice(i, i + 16).map(async (url) => {
            const path = join(dir, url.split('/').pop());
            try {await access(path); return;} catch {}
            const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
            if (!res.ok) {throw new Error(`${url}: HTTP ${res.status}`);}
            await writeFile(path, Buffer.from(await res.arrayBuffer()));
            fetched++;
        }));
    }
    console.log(`${set}: ${picked.length} images (${fetched} downloaded)`);
}

await fetchAll('twemoji', await listTwemoji());
await fetchAll('noto', listNoto());
