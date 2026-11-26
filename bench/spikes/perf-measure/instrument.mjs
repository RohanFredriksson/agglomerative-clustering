// Copies src/ to build/src/ and adds stage timestamps (STAMP) to ClusteringJob and a counter of nearest() calls in the
// chain. Nothing else changes, so the instrumented build clusters exactly as the shipped one. Fails if a patch point
// is missing or appears more than once. Usage: node instrument.mjs
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, '../../../src'), out = join(here, 'build/src');
mkdirSync(out, { recursive: true });
for (const f of readdirSync(src)) if (/\.(hpp|cpp)$/.test(f)) copyFileSync(join(src, f), join(out, f));
let t = readFileSync(join(src, 'clustering.cpp'), 'utf8');
const once = (from, to) => {
    const parts = t.split(from);
    if (parts.length !== 2) throw new Error(`patch point found ${parts.length - 1} times: ${from}`);
    t = parts.join(to);
};
once('#include "clustering.hpp"\n', '#include "stamps.hpp"\n#include "clustering.hpp"\n');
once('        const bool timed = budget_ms < std::numeric_limits<double>::infinity();\n', '        STAMP("start");\n        const bool timed = budget_ms < std::numeric_limits<double>::infinity();\n');
once('        this->stage = Stage::build;\n        return true;', '        STAMP("scan");\n        this->stage = Stage::build;\n        return true;');
once('            this->phase = this->precision < 8 ? Phase::group : Phase::grid;', '            STAMP("convert");\n            this->phase = this->precision < 8 ? Phase::group : Phase::grid;');
once('            this->phase = Phase::grouped_error;', '            STAMP("group");\n            this->phase = Phase::grouped_error;');
once('            this->bin_of = {};\n            this->sums = {};\n            this->cursor = 0;\n            this->phase = Phase::grid;', '            this->bin_of = {};\n            this->sums = {};\n            this->cursor = 0;\n            STAMP("grouped_error");\n            this->phase = Phase::grid;');
once('            this->phase = Phase::index;', '            STAMP("grid_add");\n            this->phase = Phase::index;');
once('        this->stage = Stage::chain;\n        return true;', '        STAMP("reindex");\n        this->stage = Stage::chain;\n        return true;');
once('        this->stage = Stage::write;\n        return true;', '        STAMP("chain");\n        this->stage = Stage::write;\n        return true;');
once('            this->writing = Writing::sort;', '            STAMP("w_colors");\n            this->writing = Writing::sort;');
once('            this->writing = Writing::records;', '            STAMP("w_sort");\n            this->writing = Writing::records;');
once('            this->writing = Writing::checksum;', '            STAMP("w_records");\n            this->writing = Writing::checksum;');
once('        }\n        this->stage = Stage::done;\n        return true;\n    }\n\n};', '        }\n        STAMP("w_checksum");\n        this->stage = Stage::done;\n        return true;\n    }\n\n};');
once('            int32_t b = grid.nearest(a,', '            g_searches++;\n            int32_t b = grid.nearest(a,');
writeFileSync(join(out, 'clustering.cpp'), t);
writeFileSync(join(out, 'stamps.hpp'), `// Stage timestamps for the perf spike.
#pragma once
#include <vector>
#include <cstdint>
struct Stamp {const char* name; double t;};
static std::vector<Stamp> g_stamps;
static uint64_t g_searches = 0;
#ifdef STAMP_CALLGRIND
#include <valgrind/callgrind.h>
#define STAMP(n) do {CALLGRIND_DUMP_STATS_AT(n); CALLGRIND_ZERO_STATS; g_stamps.push_back({n, 0});} while (0)
#else
#define STAMP(n) g_stamps.push_back({n, emscripten_get_now()})
#endif
`);
console.log('instrumented copy in', out);
