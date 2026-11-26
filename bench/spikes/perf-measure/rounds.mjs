// Question 2: a copy of the instrumented source (instrument.mjs first) whose merge loop can run in rounds instead of
// the nearest-neighbour chain. Each round finds the cheapest partner of every cluster that needs one, merges all
// mutual pairs, and repeats. A cluster keeps its partner until that partner is merged away (Ward is reducible, so a
// new cluster can't be cheaper to it than the partner it replaced), so only those clusters search again, and the
// merged clusters search for the first time. The searches of a round only read the grid, so they can run on threads.
// The grid's `private:` becomes `public:` in the copy so the search can be called directly (no per-cluster caches,
// which are not thread safe). Output: build/rounds/.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, 'build/src'), out = join(here, 'build/rounds');
mkdirSync(out, { recursive: true });
for (const f of readdirSync(src)) if (/\.(hpp|cpp)$/.test(f)) copyFileSync(join(src, f), join(out, f));
let h = readFileSync(join(src, 'clustering.hpp'), 'utf8');
h = h.replaceAll('private:', 'public:');
writeFileSync(join(out, 'clustering.hpp'), h);
let t = readFileSync(join(src, 'clustering.cpp'), 'utf8');
const once = (from, to) => { const p = t.split(from); if (p.length !== 2) throw new Error('patch point: ' + from); t = p.join(to); };
once('#include "stamps.hpp"\n', '#include "stamps.hpp"\n#include "rounds.hpp"\n');
once('        AgglomerativeClustering::WardGrid& grid = *this->grid;\n        // A review of the grid\'s size left unfinished',
     '        if (g_rounds_threads > 0) {return this->merge_rounds();}\n        AgglomerativeClustering::WardGrid& grid = *this->grid;\n        // A review of the grid\'s size left unfinished');
once('    // Ward\'s criterion is reducible, so merging mutual cheapest partners', readFileSync(join(here, 'cpp/merge_rounds.inc'), 'utf8') + '\n    // Ward\'s criterion is reducible, so merging mutual cheapest partners');
once('                while (!grid.is_alive(this->next_start)) {this->next_start++;}\n                this->chain.push_back(this->next_start);',
     '                if (g_chain_reverse) {int32_t top = grid.capacity() - 1; while (!grid.is_alive(top)) {top--;} this->chain.push_back(top);} else {\n                while (!grid.is_alive(this->next_start)) {this->next_start++;}\n                this->chain.push_back(this->next_start);}');
writeFileSync(join(out, 'clustering.cpp'), t);
copyFileSync(join(here, 'cpp/rounds.hpp'), join(out, 'rounds.hpp'));
console.log('rounds copy in', out);
