// Serves the repository root so demo/index.html can load ../dist/index.mjs and its .wasm.
// Usage: npm run build && npm run demo   (then open the printed URL)

import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { extname, join, normalize, resolve, sep } from 'path';
import { fileURLToPath } from 'url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const port = Number(process.env.PORT) || 8080;
const types = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript',
    '.mjs': 'text/javascript',
    '.wasm': 'application/wasm',
    '.css': 'text/css',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
};

createServer(async (request, response) => {
    const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const file = normalize(join(root, path.endsWith('/') ? path + 'index.html' : path));
    if (file !== root && !file.startsWith(root + sep)) {
        response.writeHead(403).end();
        return;
    }
    try {
        const body = await readFile(file);
        response.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream' }).end(body);
    } catch {
        response.writeHead(404).end('Not found');
    }
}).listen(port, () => {
    console.log(`Demo running at http://localhost:${port}/demo/`);
});
