#if __cplusplus < 201703L
#error AgglomerativeClustering requires at least C++17"
#endif

#ifndef AGGLOMERATIVE_CLUSTERING_HPP
#define AGGLOMERATIVE_CLUSTERING_HPP

#include <algorithm>
#include <vector>
#include <cstdint>
#include <utility>
#include <limits>
#include <array>

namespace AgglomerativeClustering {

// Spatial index over the live clusters, answering exact "cheapest partner by Ward cost" queries.
// Cells form a dense uniform grid that is rebuilt coarser as clusters merge, keeping a few clusters per cell.
class WardGrid {

public:

    static constexpr int32_t none = -1;

private:

    // The grid sizes (cells per axis) to choose from, each with about twice the cells of the one before. Cells
    // are indexed densely, so the largest is capped to bound memory: 128^3 cell indices is 8MB.
    static constexpr int32_t dimensions[] = {1, 2, 3, 4, 5, 6, 8, 10, 13, 16, 20, 25, 32, 40, 50, 64, 80, 101, 128};

    // Each occupied cell stores its clusters in chunks of four lanes, so a scan computes four exact Ward costs
    // at once (GCC/Clang vector extensions: WASM SIMD128 with -msimd128, SSE natively). Colours are at most
    // 65535, so they are exact as floats. Unused lanes have id `none`, one pixel and a colour far outside the
    // cube, so their cost is huge and a chunk whose live lanes are all too expensive is skipped whole.
    typedef float f32x4 __attribute__((vector_size(16)));
    typedef uint32_t u32x4 __attribute__((vector_size(16)));
    typedef double f64x4 __attribute__((vector_size(32)));
    typedef int64_t i64x4 __attribute__((vector_size(32)));
    static constexpr float far_away = 1e30f;

    struct Chunk {
        f32x4 x = {far_away, far_away, far_away, far_away};
        f32x4 y = {far_away, far_away, far_away, far_away};
        f32x4 z = {far_away, far_away, far_away, far_away};
        u32x4 count = {1, 1, 1, 1};
        // The counts again as floats (rounded above 2^24), for the float filter: x86 has no unsigned convert.
        f32x4 weight = {1.0f, 1.0f, 1.0f, 1.0f};
        int32_t id[4] = {none, none, none, none};
    };

    struct Bucket {
        std::vector<Chunk> chunks;
        int32_t size = 0;
    };

    struct Cluster {
        std::array<uint16_t, 3> coords;
        uint32_t count;
        int32_t bucket;
        int32_t index;
    };

    // Candidate caches for clusters whose searches are expensive (see nearest).
    static constexpr int cache_size = 16;
    static constexpr size_t cache_after = 1024;

    // The cheapest partners of one cluster in the total order of is_before, cheapest first.
    struct Candidates {
        int size = 0;
        int32_t ids[cache_size];
        double costs[cache_size];
    };

    // Every live cluster not in `candidates` costs at least `threshold`; clusters with ids from `seen` on
    // were created after the list was built and haven't been offered yet.
    struct Cache {
        Candidates candidates;
        int32_t seen = 0;
        double threshold = 0.0;
    };

    std::vector<int32_t> cache_of;
    std::vector<bool> expensive;
    std::vector<Cache> caches;
    std::vector<int32_t> free_caches;

    size_t next_review = std::numeric_limits<size_t>::max();
    // The grid has `dimension` cells per axis; a coordinate v is in cell (v * dimension) >> 16, and cell k
    // starts at boundaries[k], the smallest coordinate in it (boundaries[dimension] is 65536).
    int32_t dimension = 0;
    std::vector<uint32_t> boundaries;
    std::vector<int32_t> cells;
    // Which cells of each (x, y) column have a bucket, one bit per z in `words` 64-bit words, so search steps
    // over empty cells (most of them, in images) without touching `cells`.
    int32_t words = 1;
    std::vector<uint64_t> columns;
    std::vector<Bucket> buckets;
    // Per bucket, the colour box of everything ever linked into it (`low` and `high`, lanes 0-2), which is
    // tighter than the cell's own extent, and the smallest count ever linked into it (`high` lane 3; `low` lane
    // 3 is 0). Removals only loosen both, so they stay valid bounds. Floats, so search tests a cell with a few
    // vector operations; colours are exact, and a count rounded to float is covered by the filter's margin.
    struct Bounds {
        f32x4 low = {far_away, far_away, far_away, 0.0f};
        f32x4 high = {0.0f, 0.0f, 0.0f, far_away};
    };
    std::vector<Bounds> bucket_bounds;
    std::vector<Cluster> clusters;
    size_t alive = 0;

    static uint64_t get_distance(const std::array<uint16_t, 3>& a, const std::array<uint16_t, 3>& b) {
        uint64_t dx = static_cast<uint64_t>(a[0] > b[0] ? a[0] - b[0] : b[0] - a[0]);
        uint64_t dy = static_cast<uint64_t>(a[1] > b[1] ? a[1] - b[1] : b[1] - a[1]);
        uint64_t dz = static_cast<uint64_t>(a[2] > b[2] ? a[2] - b[2] : b[2] - a[2]);
        return dx * dx + dy * dy + dz * dz;
    }

    static double get_weight(uint32_t a, uint32_t b) {
        return double(a) * double(b) / (double(a) + double(b));
    }

    static uint64_t pack(const std::array<uint16_t, 3>& point) {
        return (uint64_t(point[0]) << 32) | (uint64_t(point[1]) << 16) | uint64_t(point[2]);
    }

    // Image colours fill only a small part of the RGB cube, so the grid size is chosen from how crowded the
    // occupied cells are rather than from the cluster count: the finest grid whose occupied cells hold at
    // least `target_occupancy` clusters on average. Finer grids mean fewer distance evaluations per search but
    // more empty cells to step over.
    static constexpr double target_occupancy = 24.0;

    // Clusters only merge, so the grid only needs to get coarser: sizes are tried from the current one down,
    // counting each one's occupied cells in a bitmap.
    int32_t choose_dimension() const {
        std::vector<uint64_t> occupancy;
        int index = int(std::size(dimensions)) - 1;
        while (index > 0 && dimensions[index] > this->dimension) {index--;}
        if (this->next_review == std::numeric_limits<size_t>::max()) {index = int(std::size(dimensions)) - 1;}
        for (; index > 0; index--) {
            const uint32_t d = uint32_t(dimensions[index]);
            occupancy.assign((size_t(d) * d * d + 63) / 64, 0u);
            size_t occupied = 0;
            for (const Cluster& cluster : this->clusters) {
                if (cluster.bucket == none) {continue;}
                uint32_t cell = (((cluster.coords[0] * d) >> 16) * d + ((cluster.coords[1] * d) >> 16)) * d + ((cluster.coords[2] * d) >> 16);
                uint64_t bit = uint64_t(1) << (cell & 63u);
                occupied += (occupancy[cell >> 6] & bit) == 0;
                occupancy[cell >> 6] |= bit;
            }
            if (double(this->alive) >= target_occupancy * double(occupied)) {break;}
        }
        return dimensions[index];
    }

    int32_t cell_of(uint16_t value) const {
        return int32_t((uint32_t(value) * uint32_t(this->dimension)) >> 16);
    }

    void link(int32_t id) {
        Cluster& cluster = this->clusters[id];
        int32_t cell = (this->cell_of(cluster.coords[0]) * this->dimension + this->cell_of(cluster.coords[1])) * this->dimension + this->cell_of(cluster.coords[2]);
        if (this->cells[cell] == none) {
            this->cells[cell] = (int32_t) this->buckets.size();
            int32_t z = this->cell_of(cluster.coords[2]);
            this->columns[size_t(cell / this->dimension) * this->words + z / 64] |= uint64_t(1) << (z % 64);
            this->buckets.emplace_back();
            this->bucket_bounds.emplace_back();
        }
        cluster.bucket = this->cells[cell];
        Bounds& bounds = this->bucket_bounds[cluster.bucket];
        for (int axis = 0; axis < 3; axis++) {
            bounds.low[axis] = std::min(bounds.low[axis], float(cluster.coords[axis]));
            bounds.high[axis] = std::max(bounds.high[axis], float(cluster.coords[axis]));
        }
        bounds.high[3] = std::min(bounds.high[3], float(cluster.count));
        Bucket& bucket = this->buckets[cluster.bucket];
        cluster.index = bucket.size++;
        if (cluster.index % 4 == 0) {bucket.chunks.emplace_back();}
        this->set_lane(bucket, cluster.index, cluster.coords, cluster.count, id);
    }

    static void set_lane(Bucket& bucket, int32_t index, const std::array<uint16_t, 3>& coords, uint32_t count, int32_t id) {
        Chunk& chunk = bucket.chunks[index / 4];
        int lane = index % 4;
        chunk.x[lane] = float(coords[0]);
        chunk.y[lane] = float(coords[1]);
        chunk.z[lane] = float(coords[2]);
        chunk.count[lane] = count;
        chunk.weight[lane] = float(count);
        chunk.id[lane] = id;
    }

    void rebuild(int32_t dimension) {
        this->dimension = dimension;
        this->boundaries.resize(size_t(dimension) + 1);
        for (int32_t k = 0; k <= dimension; k++) {this->boundaries[k] = uint32_t((uint64_t(k) * 65536u + uint64_t(dimension) - 1u) / uint64_t(dimension));}
        this->cells.assign(size_t(this->dimension) * this->dimension * this->dimension, none);
        this->words = (this->dimension + 63) / 64;
        this->columns.assign(size_t(this->dimension) * this->dimension * this->words, 0u);
        this->buckets.clear();
        this->bucket_bounds.clear();
        for (int32_t id = 0; id < (int32_t) this->clusters.size(); id++) {
            if (this->clusters[id].bucket != none) {this->link(id);}
        }
    }

public:

    explicit WardGrid(size_t expected) {
        this->clusters.reserve(2 * expected);
        this->cache_of.reserve(2 * expected);
        this->expensive.reserve(2 * expected);
        this->rebuild(1);
    }

    int32_t add(const std::array<uint16_t, 3>& coords, uint32_t count) {
        int32_t id = (int32_t) this->clusters.size();
        this->clusters.push_back({coords, count, none, none});
        this->cache_of.push_back(none);
        this->expensive.push_back(false);
        this->link(id);
        this->alive++;
        return id;
    }

    void remove(int32_t id) {
        Cluster& cluster = this->clusters[id];
        Bucket& bucket = this->buckets[cluster.bucket];
        int32_t last = bucket.size - 1;
        if (cluster.index != last) {
            int32_t moved = bucket.chunks[last / 4].id[last % 4];
            Cluster& other = this->clusters[moved];
            this->set_lane(bucket, cluster.index, other.coords, other.count, moved);
            other.index = cluster.index;
        }
        this->set_lane(bucket, last, {0, 0, 0}, 1, none);
        Chunk& tail = bucket.chunks[last / 4];
        tail.x[last % 4] = tail.y[last % 4] = tail.z[last % 4] = far_away;
        bucket.size = last;
        if (last % 4 == 0) {bucket.chunks.pop_back();}
        cluster.bucket = none;
        if (this->cache_of[id] != none) {
            this->free_caches.push_back(this->cache_of[id]);
            this->cache_of[id] = none;
        }
        this->alive--;
    }

    // Re-picks the grid size (after the initial adds, then each time the cluster count halves) and rebuilds
    // the grid if it changed.
    void reindex() {
        if (this->alive > this->next_review) {return;}
        int32_t target = this->choose_dimension();
        this->next_review = this->alive / 2;
        if (target != this->dimension) {this->rebuild(target);}
    }

    bool is_alive(int32_t id) const {return this->clusters[id].bucket != none;}
    size_t size() const {return this->alive;}
    const std::array<uint16_t, 3>& coords(int32_t id) const {return this->clusters[id].coords;}
    uint32_t count(int32_t id) const {return this->clusters[id].count;}
    int32_t capacity() const {return (int32_t) this->clusters.size();}

    // Ward cost of merging two clusters: the increase in total squared error, n_a * n_b / (n_a + n_b) * |a - b|^2.
    double cost(int32_t a, int32_t b) const {
        const Cluster& x = this->clusters[a];
        const Cluster& y = this->clusters[b];
        return get_weight(x.count, y.count) * double(get_distance(x.coords, y.coords));
    }

    // A strict total order on candidate partners of `a`: by cost, then by the partner's packed colour and id.
    // Every cluster ranks partners the same way, which is what keeps the nearest-neighbour chain acyclic.
    bool is_before(int32_t a, double cost, int32_t candidate, double best_cost, int32_t best) const {
        if (best == none) {return true;}
        if (cost != best_cost) {return cost < best_cost;}
        uint64_t candidate_key = pack(this->clusters[candidate].coords);
        uint64_t best_key = pack(this->clusters[best].coords);
        uint64_t own_key = pack(this->clusters[a].coords);
        // Compare the unordered pairs {a, candidate} and {a, best} by their smaller then larger (key, id).
        auto lower = [&](uint64_t key, int32_t id) {return std::make_pair(std::min(std::make_pair(own_key, a), std::make_pair(key, id)), std::max(std::make_pair(own_key, a), std::make_pair(key, id)));};
        return lower(candidate_key, candidate) < lower(best_key, best);
    }

private:

    // Inserts a candidate if it ranks among the best `limit`; returns the cost of any candidate pushed out, else infinity.
    double offer(int32_t id, Candidates& list, int limit, int32_t candidate, double cost) const {
        if (list.size == limit && !this->is_before(id, cost, candidate, list.costs[limit - 1], list.ids[limit - 1])) {return cost;}
        double evicted = list.size == limit ? list.costs[limit - 1] : std::numeric_limits<double>::infinity();
        int i = list.size == limit ? limit - 1 : list.size++;
        while (i > 0 && this->is_before(id, cost, candidate, list.costs[i - 1], list.ids[i - 1])) {
            list.ids[i] = list.ids[i - 1];
            list.costs[i] = list.costs[i - 1];
            i--;
        }
        list.ids[i] = candidate;
        list.costs[i] = cost;
        return evicted;
    }

    // Collects the `limit` cheapest partners of `id`, searching outward ring by ring and stopping once no
    // unvisited cell can hold a cheaper one. Every partner has at least one pixel, so beyond distance d the
    // cost is at least n / (n + 1) * d^2. Returns how many clusters were examined.
    size_t search(int32_t id, Candidates& list, int limit, int32_t hint = none) const {

        const Cluster& self = this->clusters[id];
        const std::array<uint16_t, 3>& p = self.coords;
        const int32_t c[3] = {this->cell_of(p[0]), this->cell_of(p[1]), this->cell_of(p[2])};
        const int32_t last = this->dimension - 1;
        const double minimum_weight = get_weight(self.count, 1u) * (1.0 - 1e-12);
        size_t examined = 0;
        list.size = 0;

        // The cost a candidate must beat to make the list: its worst entry once full.
        double bound = std::numeric_limits<double>::infinity();
        const f32x4 px = {float(p[0]), float(p[0]), float(p[0]), float(p[0])};
        const f32x4 py = {float(p[1]), float(p[1]), float(p[1]), float(p[1])};
        const f32x4 pz = {float(p[2]), float(p[2]), float(p[2]), float(p[2])};
        const f64x4 own_count = {double(self.count), double(self.count), double(self.count), double(self.count)};
        const f32x4 own_count_f = {float(self.count), float(self.count), float(self.count), float(self.count)};
        const f32x4 position = {float(p[0]), float(p[1]), float(p[2]), 0.0f};

        // Cells and chunks first go through cheap float filters: a partner can only beat the bound if
        // n_a * n_b * d^2 <= bound * (n_a + n_b), which needs no division and takes one f32x4 per operation
        // instead of two f64x2. Float rounding is a few ulps (~1e-7) on each side, so widening the bound by 1e-4
        // never rejects a lane the exact test would keep; chunks that pass get exact costs as before. While the
        // bound is infinite, so is the filter's, and everything passes.
        const float infinity = std::numeric_limits<float>::infinity();
        f32x4 filter_bound = {infinity, infinity, infinity, infinity};
        auto tighten = [&](double value) __attribute__((always_inline)) {
            bound = value;
            float widened = float(value) * 1.0001f;
            filter_bound = f32x4{widened, widened, widened, widened};
        };

        // A known partner bounds the search from the start. The scan meets it again, but an equal entry never
        // displaces itself, so it isn't listed twice; that only holds for a list of one.
        if (hint != none && limit == 1) {
            list.ids[0] = hint;
            list.costs[0] = this->cost(id, hint);
            list.size = 1;
            tighten(list.costs[0]);
        }

        // Called for every cell of every ring, so force it inline: as a call it costs about as much as the scan.
        auto scan = [&](int32_t x, int32_t y, int32_t z) __attribute__((always_inline)) {
            int32_t bucket = this->cells[(x * this->dimension + y) * this->dimension + z];
            if (bucket == none) {return;}
            // No member of this cell can cost less than its lightest possible member at the nearest point of the
            // cell's colour box. Lane 3 of the gap is 0 (low and position are 0 there, high is a count).
            const Bounds& bounds = this->bucket_bounds[bucket];
            f32x4 gap = bounds.low - position;
            f32x4 above = position - bounds.high;
            gap = gap > above ? gap : above;
            gap = gap > 0.0f ? gap : 0.0f;
            gap *= gap;
            float lightest = bounds.high[3];
            if (own_count_f[0] * lightest * (gap[0] + gap[1] + gap[2]) > filter_bound[0] * (own_count_f[0] + lightest)) {return;}
            const Bucket& members = this->buckets[bucket];
            examined += members.size;
            for (const Chunk& chunk : members.chunks) {
                f32x4 dx = chunk.x - px, dy = chunk.y - py, dz = chunk.z - pz;
                u32x4 maybe = (u32x4) (own_count_f * chunk.weight * (dx * dx + dy * dy + dz * dz) <= filter_bound * (own_count_f + chunk.weight));
                if (!(maybe[0] | maybe[1] | maybe[2] | maybe[3])) {continue;}
                // Exact Ward costs for all four lanes: integer differences and their squares are exact in double,
                // and the weight uses the same operations as get_weight, so these match the scalar costs bit for bit.
                f64x4 ex = __builtin_convertvector(dx, f64x4), ey = __builtin_convertvector(dy, f64x4), ez = __builtin_convertvector(dz, f64x4);
                f64x4 distance = ex * ex + ey * ey + ez * ez;
                f64x4 counts = __builtin_convertvector(chunk.count, f64x4);
                f64x4 cost = own_count * counts / (own_count + counts) * distance;
                f64x4 bound_vector = {bound, bound, bound, bound};
                i64x4 cheap = cost <= bound_vector;
                if (!(cheap[0] | cheap[1] | cheap[2] | cheap[3])) {continue;}
                for (int lane = 0; lane < 4; lane++) {
                    if (!cheap[lane] || chunk.id[lane] == none || chunk.id[lane] == id) {continue;}
                    if (cost[lane] > bound) {continue;}
                    this->offer(id, list, limit, chunk.id[lane], cost[lane]);
                    if (list.size == limit) {tighten(list.costs[limit - 1]);}
                }
            }
        };

        for (int32_t ring = 0; ; ring++) {

            // Anything outside the cells already searched lies past one of the cube's faces.
            if (ring > 0) {
                uint64_t gap = std::numeric_limits<uint64_t>::max();
                for (int axis = 0; axis < 3; axis++) {
                    if (c[axis] - ring >= 0) {gap = std::min<uint64_t>(gap, uint64_t(p[axis]) - (this->boundaries[c[axis] - ring + 1] - 1u));}
                    if (c[axis] + ring <= last) {gap = std::min<uint64_t>(gap, this->boundaries[c[axis] + ring] - uint64_t(p[axis]));}
                }
                if (gap == std::numeric_limits<uint64_t>::max()) {break;}
                if (minimum_weight * double(gap * gap) > bound) {break;}
            }

            // Column bits for this ring: the z range of edge rows, and the two end cells of interior rows (a zero
            // bit where that end lies outside the grid, or both ends are the same cell at ring 0).
            uint64_t span[2] = {0u, 0u};
            for (int32_t word = 0; word < this->words; word++) {
                int32_t low = std::max(c[2] - ring - 64 * word, 0), high = std::min(c[2] + ring, last) - 64 * word;
                if (high >= 0 && low <= 63) {span[word] = (~uint64_t(0) << low) & (~uint64_t(0) >> (63 - std::min(high, 63)));}
            }
            const int32_t below_word = c[2] - ring >= 0 ? (c[2] - ring) / 64 : 0;
            const uint64_t below_bit = c[2] - ring >= 0 ? uint64_t(1) << ((c[2] - ring) % 64) : 0u;
            const int32_t above_word = ring > 0 && c[2] + ring <= last ? (c[2] + ring) / 64 : 0;
            const uint64_t above_bit = ring > 0 && c[2] + ring <= last ? uint64_t(1) << ((c[2] + ring) % 64) : 0u;

            for (int32_t x = std::max(c[0] - ring, 0); x <= std::min(c[0] + ring, last); x++) {
                bool x_edge = x == c[0] - ring || x == c[0] + ring;
                for (int32_t y = std::max(c[1] - ring, 0); y <= std::min(c[1] + ring, last); y++) {
                    bool xy_edge = x_edge || y == c[1] - ring || y == c[1] + ring;
                    const uint64_t* column = &this->columns[size_t(x * this->dimension + y) * this->words];
                    if (xy_edge) {
                        // The ring's whole z range, visiting only occupied cells, in increasing z.
                        for (int32_t word = 0; word < this->words; word++) {
                            uint64_t bits = column[word] & span[word];
                            while (bits != 0u) {
                                scan(x, y, word * 64 + __builtin_ctzll(bits));
                                bits &= bits - 1u;
                            }
                        }
                    } else {
                        if (column[below_word] & below_bit) {scan(x, y, c[2] - ring);}
                        if (column[above_word] & above_bit) {scan(x, y, c[2] + ring);}
                    }
                }
            }

        }

        return examined;

    }

public:

    // Returns the live cluster that is cheapest to merge with `id`.
    //
    // A cluster at the base of the nearest-neighbour chain is queried again after every merge above it, and a
    // large cluster's search reaches far (its bound assumes a one-pixel partner). So once a search has been
    // expensive, the cluster keeps its `cache_size` cheapest candidates and a threshold below which no
    // unlisted cluster can cost. Live clusters never change, so the next query only has to drop dead
    // candidates and offer the clusters created since; it falls back to a full search when the cheapest
    // remaining candidate isn't strictly below the threshold.
    [[nodiscard]] int32_t nearest(int32_t id, int32_t hint = none) {

        int32_t slot = this->cache_of[id];

        if (slot != none) {
            Cache& cache = this->caches[slot];
            Candidates& list = cache.candidates;
            int kept = 0;
            for (int i = 0; i < list.size; i++) {
                if (!this->is_alive(list.ids[i])) {continue;}
                list.ids[kept] = list.ids[i];
                list.costs[kept] = list.costs[i];
                kept++;
            }
            list.size = kept;
            int32_t end = this->capacity();
            for (int32_t other = cache.seen; other < end; other++) {
                if (other == id || !this->is_alive(other)) {continue;}
                double cost = this->cost(id, other);
                if (cost >= cache.threshold) {continue;}
                cache.threshold = std::min(cache.threshold, this->offer(id, list, cache_size, other, cost));
            }
            cache.seen = end;
            if (list.size > 0 && list.costs[0] < cache.threshold) {return list.ids[0];}
            this->search(id, list, cache_size);
            cache.threshold = list.size == cache_size ? list.costs[cache_size - 1] : std::numeric_limits<double>::infinity();
            return list.size > 0 ? list.ids[0] : none;
        }

        Candidates list;
        size_t examined = this->search(id, list, 1, hint);
        if (examined > cache_after && !this->expensive[id]) {
            this->expensive[id] = true;
        } else if (examined > cache_after) {
            if (this->free_caches.empty()) {
                slot = (int32_t) this->caches.size();
                this->caches.emplace_back();
            } else {
                slot = this->free_caches.back();
                this->free_caches.pop_back();
            }
            this->cache_of[id] = slot;
            Cache& cache = this->caches[slot];
            this->search(id, cache.candidates, cache_size);
            cache.seen = this->capacity();
            cache.threshold = cache.candidates.size == cache_size ? cache.candidates.costs[cache_size - 1] : std::numeric_limits<double>::infinity();
        }
        return list.size > 0 ? list.ids[0] : none;

    }

};

// Counts 8-bit colours, keeping them in order of first appearance.
// An open-addressing table with linear probing: each slot packs (colour + 1) << 32 | index into one word, so a
// probe is a single load, and 0 marks an empty slot. It grows with the number of distinct colours, not pixels.
class AgglomerativeHistogram {

private:

    std::vector<uint64_t> slots;
    uint32_t mask = 0;
    int shift = 0;
    std::vector<uint32_t> keys;
    std::vector<uint64_t> totals;

    // Fibonacci hashing: the top bits of the product spread neighbouring colours across the table.
    uint32_t home(uint32_t key) const {
        return uint32_t((uint64_t(key) * 0x9E3779B97F4A7C15ULL) >> this->shift);
    }

    void resize(int bits) {
        this->slots.assign(size_t(1) << bits, 0u);
        this->mask = (uint32_t(1) << bits) - 1u;
        this->shift = 64 - bits;
        for (uint32_t index = 0; index < (uint32_t) this->keys.size(); index++) {
            uint32_t slot = this->home(this->keys[index]);
            while (this->slots[slot] != 0u) {slot = (slot + 1u) & this->mask;}
            this->slots[slot] = (uint64_t(this->keys[index]) + 1u) << 32 | index;
        }
    }

public:

    AgglomerativeHistogram() {
        this->resize(12);
    }

    // Adds `weight` to the colour packed as r << 16 | g << 8 | b, and returns the colour's index. Weights are
    // pixel counts, or alpha-weighted counts in units of 1/255 of a pixel; totals are 64-bit so neither overflows.
    uint32_t add(uint32_t key, uint64_t weight = 1u) {
        const uint64_t tag = uint64_t(key) + 1u;
        uint32_t slot = this->home(key);
        while (true) {
            uint64_t entry = this->slots[slot];
            if (entry == 0u) {break;}
            if ((entry >> 32) == tag) {this->totals[uint32_t(entry)] += weight; return uint32_t(entry);}
            slot = (slot + 1u) & this->mask;
        }
        uint32_t index = (uint32_t) this->keys.size();
        this->slots[slot] = tag << 32 | index;
        this->keys.push_back(key);
        this->totals.push_back(weight);
        // Keep the load factor at most 1/2 so probes stay short.
        if (2 * this->keys.size() > this->slots.size()) {this->resize(64 - this->shift + 1);}
        return index;
    }

    // The distinct colours (packed as in add) in order of first appearance, and the total weight of each.
    const std::vector<uint32_t>& colors() const {return this->keys;}
    const std::vector<uint64_t>& counts() const {return this->totals;}

    size_t size() const {
        return this->keys.size();
    }

};

// Nearest palette colour, like KDTree, through a coarse grid of cells over the coordinates whose candidate
// lists are built the first time a lookup lands in them. A cell lists every palette entry that can be nearest
// to some point of the cell: those whose least distance to the cell is at most the smallest greatest distance
// of any entry. A lookup then compares exact distances over that short list, with the same tie-break as
// KDTree (the smaller key), so the answers are the same. Building a cell costs one pass over the palette, and
// only cells that pixels reach are built.
class PaletteIndex {

public:

    typedef std::array<uint16_t, 3> Point;

private:

    // A candidate's least distance to its cell, shifted right by `least_shift` so it fits 32 bits (rounding
    // down keeps it a lower bound), and its palette index.
    struct Candidate {
        uint32_t least;
        int32_t index;
    };

    std::vector<Point> points;
    std::vector<uint32_t> keys;
    int cell_bits = 0;
    int shift = 0;
    int least_shift = 0;
    // Per cell, where its candidates start in `pool` (or -1 if not built yet) and how many there are.
    std::vector<std::pair<int32_t, int32_t>> cells;
    // Each cell's candidates, by least distance to the cell, so a lookup stops at one that can't win. At most
    // (cells reached) x (palette size) entries; a few hundred KB on photos.
    std::vector<Candidate> pool;
    std::vector<uint64_t> least;

    std::pair<int32_t, int32_t> build_cell(uint32_t cell, uint32_t cx, uint32_t cy, uint32_t cz) {
        const int64_t width = int64_t(1) << this->shift;
        const int64_t low[3] = {int64_t(cx) << this->shift, int64_t(cy) << this->shift, int64_t(cz) << this->shift};
        const size_t n = this->points.size();
        // Least and greatest squared distances from each entry to the cell's box, in two plain passes.
        uint64_t limit = std::numeric_limits<uint64_t>::max();
        for (size_t i = 0; i < n; i++) {
            uint64_t least = 0, greatest = 0;
            for (int axis = 0; axis < 3; axis++) {
                int64_t below = low[axis] - int64_t(this->points[i][axis]);
                int64_t above = int64_t(this->points[i][axis]) - (low[axis] + width - 1);
                int64_t near = std::max<int64_t>({below, above, 0});
                int64_t far = std::max(-below, -above);
                least += uint64_t(near * near);
                greatest += uint64_t(far * far);
            }
            this->least[i] = least;
            limit = std::min(limit, greatest);
        }
        const size_t start = this->pool.size();
        for (size_t i = 0; i < n; i++) {
            if (this->least[i] <= limit) {this->pool.push_back({uint32_t(this->least[i] >> this->least_shift), int32_t(i)});}
        }
        std::sort(this->pool.begin() + start, this->pool.end(), [](const Candidate& a, const Candidate& b) {return a.least < b.least;});
        std::pair<int32_t, int32_t> entry = {int32_t(start), int32_t(this->pool.size() - start)};
        this->cells[cell] = entry;
        return entry;
    }

public:

    // `coordinate_bits` is how many bits the coordinates use (8 for RGB values, 16 for OKLab), and the grid has
    // 2^cell_bits cells per axis. Finer cells mean shorter lists but more of them to build.
    void build(const std::vector<Point>& points, const std::vector<uint32_t>& keys, int coordinate_bits, int cell_bits) {
        this->points = points;
        this->keys = keys;
        this->cell_bits = cell_bits;
        this->shift = coordinate_bits - cell_bits;
        // Squared distances are below 3 * 2^(2 * coordinate_bits).
        this->least_shift = std::max(0, 2 * coordinate_bits + 2 - 32);
        this->cells.assign(size_t(1) << (3 * cell_bits), {-1, 0});
        this->pool.clear();
        this->least.assign(points.size(), 0u);
    }

    // The index of the point nearest to `target`, or -1 if there are none.
    [[nodiscard]] int32_t get_nearest(const Point& target) {
        if (this->points.empty()) {return -1;}
        const uint32_t cx = target[0] >> this->shift, cy = target[1] >> this->shift, cz = target[2] >> this->shift;
        const uint32_t cell = (((cx << this->cell_bits) | cy) << this->cell_bits) | cz;
        std::pair<int32_t, int32_t> entry = this->cells[cell];
        if (entry.first < 0) {entry = this->build_cell(cell, cx, cy, cz);}
        int32_t best_index = -1;
        uint32_t best_key = std::numeric_limits<uint32_t>::max();
        uint64_t best_distance = std::numeric_limits<uint64_t>::max();
        for (int32_t i = entry.first; i < entry.first + entry.second; i++) {
            const Candidate& candidate = this->pool[i];
            if ((uint64_t(candidate.least) << this->least_shift) > best_distance) {break;}
            const Point& point = this->points[candidate.index];
            uint64_t distance = 0;
            for (int axis = 0; axis < 3; axis++) {
                int64_t d = int64_t(point[axis]) - int64_t(target[axis]);
                distance += uint64_t(d * d);
            }
            const uint32_t key = this->keys[candidate.index];
            if (distance < best_distance || (distance == best_distance && key < best_key)) {
                best_distance = distance;
                best_key = key;
                best_index = candidate.index;
            }
        }
        return best_index;
    }

};

// Nearest-neighbour lookup over palette colours, in whichever coordinates the caller uses (8-bit RGB values,
// or scaled OKLab). Returns the index of the nearest point. Equally near points are told apart by their keys
// (the caller passes each colour's packed RGB), smallest first, so the answer doesn't depend on palette order.
class KDTree {

public:

    typedef std::array<uint16_t, 3> Point;

private:

    struct Node {
        Point point;
        uint32_t key;
        int32_t index;
        int left = -1;
        int right = -1;
    };

    std::vector<Node> nodes;
    int root = -1;

    std::vector<uint32_t> keys;

    int build(std::vector<std::pair<Point, int32_t>>& points, int start, int end, int depth) {

        if (start >= end) {return -1;}
        int mid = (start + end) / 2;
        int axis = depth % 3;

        auto comparator = [axis](const std::pair<Point, int32_t>& a, const std::pair<Point, int32_t>& b) {
            return a.first[axis] < b.first[axis];
        };

        std::nth_element(points.begin() + start, points.begin() + mid, points.begin() + end, comparator);
        this->nodes.push_back(Node{points[mid].first, this->keys[points[mid].second], points[mid].second, -1, -1});
        int node_index = (int) this->nodes.size() - 1;

        this->nodes[node_index].left = build(points, start, mid, depth + 1);
        this->nodes[node_index].right = build(points, mid + 1, end, depth + 1);

        return node_index;

    }

public:

    void build(const std::vector<Point>& points, const std::vector<uint32_t>& keys) {
        this->keys = keys;
        std::vector<std::pair<Point, int32_t>> indexed;
        indexed.reserve(points.size());
        for (int32_t i = 0; i < (int32_t) points.size(); i++) {indexed.push_back({points[i], i});}
        this->nodes.clear();
        this->root = this->build(indexed, 0, (int) indexed.size(), 0);
    }

    // The index of the point nearest to `target`, or -1 if the tree is empty.
    [[nodiscard]] int32_t get_nearest(const Point& target) const {

        if (this->root == -1) {return -1;}

        int32_t best_index = -1;
        uint32_t best_key = std::numeric_limits<uint32_t>::max();
        uint64_t best_distance = std::numeric_limits<uint64_t>::max();

        struct StackFrame {
            int node_index;
            int depth;
            uint64_t bound;
        };

        // The tree is median-split, so its depth is at most ~log2(n) and each pop pushes at most two
        // frames; a fixed-size stack avoids a heap allocation per query.
        StackFrame fringe[64];
        int fringe_size = 0;
        fringe[fringe_size++] = {root, 0, 0u};

        while (fringe_size > 0) {

            StackFrame frame = fringe[--fringe_size];

            // Skip subtrees that can't contain a closer (or equally close) point than one found since this frame
            // was pushed; equally close ones still matter, for the tie-break.
            if (frame.bound > best_distance) {continue;}

            const Node& node = this->nodes[frame.node_index];
            uint64_t distance = 0;
            for (int axis = 0; axis < 3; axis++) {
                int64_t d = int64_t(node.point[axis]) - int64_t(target[axis]);
                distance += uint64_t(d * d);
            }

            if (distance < best_distance || (distance == best_distance && node.key < best_key)) {
                best_distance = distance;
                best_key = node.key;
                best_index = node.index;
            }

            int axis = frame.depth % 3;
            int64_t difference = int64_t(target[axis]) - int64_t(node.point[axis]);

            int first = difference < 0 ? node.left : node.right;
            int second = difference < 0 ? node.right : node.left;

            // Push the far side first so the near side is popped (and searched) first, tightening best_distance.
            uint64_t split_distance = uint64_t(difference * difference);
            if (second != -1 && split_distance <= best_distance) {fringe[fringe_size++] = {second, frame.depth + 1, split_distance};}
            if (first != -1) {fringe[fringe_size++] = {first, frame.depth + 1, frame.bound};}

        }

        return best_index;

    }

};

}

#endif