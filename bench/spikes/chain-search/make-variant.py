#!/usr/bin/env python3
"""Builds a variant: writes (a unified diff against the shipped src/, paths a/src/... b/src/...) for each change tried,
each made from the shipped files by the string edits below, so every change is independent and reproducible. build.sh applies
a list of them in order. Usage: make-variant.py <name> <outdir> [transform ...]"""
import os, subprocess, sys, tempfile, shutil
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '../../..'))
SRC = os.path.join(ROOT, 'src')
HERE = os.path.dirname(os.path.abspath(__file__))

class Edit:
    def __init__(self):
        self.f = {n: open(os.path.join(SRC, n)).read() for n in ('clustering.hpp', 'clustering.cpp')}
    def once(self, name, a, b):
        assert self.f[name].count(a) == 1, (name, a[:60], self.f[name].count(a))
        self.f[name] = self.f[name].replace(a, b)

patches = {}
def patch(fn):
    patches[fn.__name__] = fn
    return fn

@patch
def params(e):
    """cache size, cache threshold and grid occupancy target settable by -D (defaults are the shipped values)"""
    e.once('clustering.hpp', '    static constexpr int cache_size = 16;\n    static constexpr size_t cache_after = 1024;',
           '#ifndef CACHE_SIZE\n#define CACHE_SIZE 16\n#endif\n#ifndef CACHE_AFTER\n#define CACHE_AFTER 1024\n#endif\n    static constexpr int cache_size = CACHE_SIZE;\n    static constexpr size_t cache_after = CACHE_AFTER;')
    e.once('clustering.hpp', '    static constexpr double target_occupancy = 24.0;',
           '#ifndef TARGET_OCC\n#define TARGET_OCC 24.0\n#endif\n    static constexpr double target_occupancy = TARGET_OCC;')

@patch
def fastoffer(e):
    """offer(): compare costs inline and call is_before only for equal costs (same order)"""
    h = e.f['clustering.hpp']
    a = h.index('    double offer(int32_t id, Candidates& list')
    b = h.index('    // Collects the `limit` cheapest partners')
    new = '''    double offer(int32_t id, Candidates& list, int limit, int32_t candidate, double cost) const {
        // The same order as is_before, with its first test (different costs) inline: is_before is called only for equal costs.
        if (list.size == limit) {
            const double worst = list.costs[limit - 1];
            if (cost > worst || (cost == worst && !this->is_before(id, cost, candidate, worst, list.ids[limit - 1]))) {return cost;}
        }
        double evicted = list.size == limit ? list.costs[limit - 1] : std::numeric_limits<double>::infinity();
        int i = list.size == limit ? limit - 1 : list.size++;
        while (i > 0) {
            const double above = list.costs[i - 1];
            if (!(cost < above || (cost == above && this->is_before(id, cost, candidate, above, list.ids[i - 1])))) {break;}
            list.ids[i] = list.ids[i - 1];
            list.costs[i] = above;
            i--;
        }
        list.ids[i] = candidate;
        list.costs[i] = cost;
        return evicted;
    }

'''
    e.f['clustering.hpp'] = h[:a] + new + h[b:]

@patch
def minw(e):
    """ring stop and bound use the smallest count among live clusters instead of one pixel (a lower bound of any partner's count)"""
    e.once('clustering.hpp', '    size_t alive = 0;\n', '    size_t alive = 0;\n    // Live clusters with each small count, and a lower bound of the smallest live count (counts only grow).\n    static constexpr uint32_t small = 4096;\n    std::vector<uint32_t> small_counts = std::vector<uint32_t>(small, 0u);\n    uint32_t min_count = 1;\n')
    e.once('clustering.hpp', '        this->link(id);\n        this->alive++;\n        return id;', '        if (count < small) {this->small_counts[count]++;}\n        this->link(id);\n        this->alive++;\n        return id;')
    e.once('clustering.hpp', '        cluster.bucket = none;\n        if (this->cache_of[id] != none) {', '        cluster.bucket = none;\n        if (cluster.count < small) {this->small_counts[cluster.count]--;}\n        if (this->cache_of[id] != none) {')
    e.once('clustering.hpp', '        const double minimum_weight = get_weight(self.count, 1u) * (1.0 - 1e-12);', '        const double minimum_weight = get_weight(self.count, this->min_count) * (1.0 - 1e-12);')
    e.once('clustering.hpp', '    [[nodiscard]] int32_t nearest(int32_t id, int32_t hint = none) {\n', '    [[nodiscard]] int32_t nearest(int32_t id, int32_t hint = none) {\n\n        while (this->min_count < small && this->small_counts[this->min_count] == 0u) {this->min_count++;}\n')

@patch
def counters(e):
    """the search counters of variants/count (-DCOUNTERS builds only)"""
    for n in e.f: e.f[n] = open(os.path.join(HERE, 'variants/count', n)).read()

@patch
def colprune(e):
    """skip an x slab or an (x, y) column whose cell interval is already too far for a partner of the smallest possible weight"""
    e.once('clustering.hpp', '        for (int32_t ring = 0; ; ring++) {\n', '''        // Distance along one axis from the colour to a cell's interval: every cluster in the cell is at least this far.
        auto axis_gap = [&](int axis, int32_t cell) __attribute__((always_inline)) -> uint64_t {
            const uint64_t low = this->boundaries[cell], high = uint64_t(this->boundaries[cell + 1]) - 1u, v = p[axis];
            return v < low ? low - v : (v > high ? v - high : 0u);
        };

        for (int32_t ring = 0; ; ring++) {
''')
    e.once('clustering.hpp', '                bool x_edge = x == c[0] - ring || x == c[0] + ring;\n', '                bool x_edge = x == c[0] - ring || x == c[0] + ring;\n                const uint64_t gx = axis_gap(0, x);\n                if (minimum_weight * double(gx * gx) > bound) {continue;}\n')
    e.once('clustering.hpp', '                    bool xy_edge = x_edge || y == c[1] - ring || y == c[1] + ring;\n', '                    const uint64_t gy = axis_gap(1, y);\n                    if (minimum_weight * double(gx * gx + gy * gy) > bound) {continue;}\n                    bool xy_edge = x_edge || y == c[1] - ring || y == c[1] + ring;\n')

@patch
def review(e):
    """review the grid size (and rebuild its bounds) each time the cluster count falls to REVIEW_NUM/REVIEW_DEN of its last review's"""
    e.once('clustering.hpp', 'this->next_review = this->alive / 2;', '#ifndef REVIEW_NUM\n#define REVIEW_NUM 7\n#define REVIEW_DEN 8\n#endif\n            this->next_review = this->alive * REVIEW_NUM / REVIEW_DEN;')

@patch
def adaptive(e):
    """a cache that fell back to a full search is rebuilt twice as large, up to CACHE_MAX candidates (needs params, which make cache_size a macro)"""
    e.once('clustering.hpp', '#ifndef CACHE_AFTER', '#ifndef CACHE_MAX\n#define CACHE_MAX 64\n#endif\n#ifndef CACHE_AFTER')
    e.once('clustering.hpp', '        int32_t ids[cache_size];\n        double costs[cache_size];', '        int32_t ids[CACHE_MAX];\n        double costs[CACHE_MAX];')
    e.once('clustering.hpp', '        Candidates candidates;\n        int32_t seen = 0;', '        Candidates candidates;\n        int limit = cache_size;\n        int32_t seen = 0;')
    e.once('clustering.hpp', 'cache.threshold = std::min(cache.threshold, this->offer(id, list, cache_size, other, cost));', 'cache.threshold = std::min(cache.threshold, this->offer(id, list, cache.limit, other, cost));')
    e.once('clustering.hpp', "            this->search(id, list, cache_size);\n            cache.threshold = list.size == cache_size ? list.costs[cache_size - 1] : std::numeric_limits<double>::infinity();", "            cache.limit = std::min(cache.limit * 2, int(CACHE_MAX));\n            this->search(id, list, cache.limit);\n            cache.threshold = list.size == cache.limit ? list.costs[cache.limit - 1] : std::numeric_limits<double>::infinity();")
    e.once('clustering.hpp', "            Cache& cache = this->caches[slot];\n            this->search(id, cache.candidates, cache_size);", "            Cache& cache = this->caches[slot];\n            cache.limit = cache_size;\n            this->search(id, cache.candidates, cache_size);")

@patch
def skip1(e):
    """a cluster already marked expensive goes straight to a cache-building search (limit cache_size), instead of a one-candidate search first; the cache is dropped again if that search was cheap (needs adaptive)"""
    e.once('clustering.hpp', "        Candidates list;\n        size_t examined = this->search(id, list, 1, hint);", """        if (this->expensive[id]) {
            if (this->free_caches.empty()) {
                slot = (int32_t) this->caches.size();
                this->caches.emplace_back();
            } else {
                slot = this->free_caches.back();
                this->free_caches.pop_back();
            }
            Cache& cache = this->caches[slot];
            cache.limit = cache_size;
            const size_t seen_examined = this->search(id, cache.candidates, cache_size);
            cache.seen = this->capacity();
            cache.threshold = cache.candidates.size == cache_size ? cache.candidates.costs[cache_size - 1] : std::numeric_limits<double>::infinity();
            const int32_t best = cache.candidates.size > 0 ? cache.candidates.ids[0] : none;
            if (seen_examined > cache_after) {this->cache_of[id] = slot;} else {this->free_caches.push_back(slot);}
            return best;
        }
        Candidates list;
        size_t examined = this->search(id, list, 1, hint);""")

def build(name, transforms, outdir):
    """Applies the transforms in order to the shipped files (`counters` replaces them with the counters build, so it goes first)
    and writes them to outdir plus a diff against the shipped files to patches/<name>.diff."""
    e = Edit()
    for t in transforms: patches[t](e)
    os.makedirs(outdir, exist_ok=True)
    for n, t in e.f.items(): open(os.path.join(outdir, n), 'w').write(t)
    d = tempfile.mkdtemp()
    os.makedirs(d + '/a/src'); os.makedirs(d + '/b/src')
    for n, t in e.f.items():
        shutil.copy(os.path.join(SRC, n), d + '/a/src/' + n)
        open(d + '/b/src/' + n, 'w').write(t)
    r = subprocess.run(['diff', '-ruN', 'a', 'b'], cwd=d, capture_output=True, text=True)
    os.makedirs(os.path.join(HERE, 'patches'), exist_ok=True)
    out = '\n'.join(l.split('\t')[0] if l.startswith(('--- ', '+++ ')) else l for l in r.stdout.split('\n') if not l.startswith('diff '))
    open(os.path.join(HERE, 'patches', name + '.diff'), 'w').write(out)
    shutil.rmtree(d)

if __name__ == '__main__':
    # make-patches.py <name> <outdir> [transform ...]
    build(sys.argv[1], sys.argv[3:], sys.argv[2])
