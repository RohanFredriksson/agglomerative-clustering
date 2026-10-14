#if __cplusplus < 201703L
#error AgglomerativeClustering requires at least C++17"
#endif

#ifndef AGGLOMERATIVE_CLUSTERING_HPP
#define AGGLOMERATIVE_CLUSTERING_HPP

#include <unordered_set>
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

    // Cells are indexed densely, so cap the resolution to bound memory: 129^3 cell indices is ~8.5MB.
    static constexpr int max_resolution = 7;

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

    int resolution = -1;
    size_t next_review = std::numeric_limits<size_t>::max();
    uint32_t grid_size = 0;
    int32_t dimension = 0;
    std::vector<int32_t> cells;
    std::vector<Bucket> buckets;
    // The smallest count ever linked into each bucket. Removals don't raise it, so it may be too low, which
    // only makes it a weaker (still valid) bound.
    std::vector<uint32_t> bucket_minimum;
    // The colour box of everything ever linked into each bucket: tighter than the cell's own extent, and
    // removals only make it looser, so it stays a valid bound.
    std::vector<std::array<uint16_t, 6>> bucket_box;

    // A coarse grid of blocks, each `block_side`^3 cells, so far-reaching searches can skip whole empty or
    // too-expensive regions instead of stepping over every cell. Only used when the grid is at least two blocks
    // across. Like the cell bounds, a block's minimum count and colour box cover everything ever linked into it;
    // its live count is exact, so an empty block is always skipped.
    static constexpr int block_shift = 2;
    static constexpr int32_t block_side = int32_t(1) << block_shift;
    // Cell rings a search scans before it switches to blocks. Most searches finish within them.
    static constexpr int32_t fine_rings = FINE_RINGS;
    int32_t block_dimension = 0;
    std::vector<int32_t> block_live;
    std::vector<uint32_t> block_minimum;
    std::vector<std::array<uint16_t, 6>> block_box;

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

    // Image colours fill only a small part of the RGB cube, so the resolution is chosen from how crowded the
    // occupied cells are rather than from the cluster count: the finest grid whose occupied cells hold at
    // least `target_occupancy` clusters on average. Finer grids mean fewer distance evaluations per search but
    // more empty cells to step over.
    static constexpr double target_occupancy = 6.0;

    int choose_resolution() const {
        // Morton codes at the finest resolution: dropping the low 3 bits gives the code one level coarser, so
        // one bitmap per resolution (at most 2^21 bits) counts its occupied cells without sorting.
        std::vector<uint32_t> codes;
        codes.reserve(this->alive);
        for (const Cluster& cluster : this->clusters) {
            if (cluster.bucket == none) {continue;}
            uint32_t code = 0;
            for (int bit = max_resolution - 1; bit >= 0; bit--) {
                for (int axis = 0; axis < 3; axis++) {code = (code << 1) | ((cluster.coords[axis] >> (16 - max_resolution + bit)) & 1u);}
            }
            codes.push_back(code);
        }
        std::vector<uint64_t> occupancy;
        for (int r = max_resolution; r > 0; r--) {
            int shift = 3 * (max_resolution - r);
            occupancy.assign(((size_t(1) << (3 * r)) + 63) / 64, 0u);
            size_t occupied = 0;
            for (uint32_t code : codes) {
                uint32_t cell = code >> shift;
                uint64_t bit = uint64_t(1) << (cell & 63u);
                occupied += (occupancy[cell >> 6] & bit) == 0;
                occupancy[cell >> 6] |= bit;
            }
            if (double(this->alive) >= target_occupancy * double(occupied)) {return r;}
        }
        return 0;
    }

    int32_t cell_of(uint16_t value) const {
        return int32_t(value / this->grid_size);
    }

    int32_t block_of(const std::array<uint16_t, 3>& coords) const {
        int32_t bx = this->cell_of(coords[0]) >> block_shift, by = this->cell_of(coords[1]) >> block_shift, bz = this->cell_of(coords[2]) >> block_shift;
        return (bx * this->block_dimension + by) * this->block_dimension + bz;
    }

    static void extend(std::array<uint16_t, 6>& box, const std::array<uint16_t, 3>& coords) {
        for (int axis = 0; axis < 3; axis++) {
            box[axis] = std::min(box[axis], coords[axis]);
            box[axis + 3] = std::max(box[axis + 3], coords[axis]);
        }
    }

    static constexpr std::array<uint16_t, 6> empty_box = {std::numeric_limits<uint16_t>::max(), std::numeric_limits<uint16_t>::max(), std::numeric_limits<uint16_t>::max(), 0, 0, 0};

    void link(int32_t id) {
        Cluster& cluster = this->clusters[id];
        int32_t cell = (this->cell_of(cluster.coords[0]) * this->dimension + this->cell_of(cluster.coords[1])) * this->dimension + this->cell_of(cluster.coords[2]);
        if (this->cells[cell] == none) {
            this->cells[cell] = (int32_t) this->buckets.size();
            this->buckets.emplace_back();
            this->bucket_minimum.push_back(std::numeric_limits<uint32_t>::max());
            this->bucket_box.push_back(empty_box);
        }
        extend(this->bucket_box[this->cells[cell]], cluster.coords);
        int32_t block = this->block_of(cluster.coords);
        this->block_live[block]++;
        this->block_minimum[block] = std::min(this->block_minimum[block], cluster.count);
        extend(this->block_box[block], cluster.coords);
        cluster.bucket = this->cells[cell];
        this->bucket_minimum[cluster.bucket] = std::min(this->bucket_minimum[cluster.bucket], cluster.count);
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
        chunk.id[lane] = id;
    }

    void rebuild(int resolution) {
        this->resolution = resolution;
        this->grid_size = (uint32_t(std::numeric_limits<uint16_t>::max()) + 1u) >> resolution;
        this->dimension = int32_t(1) << resolution;
        this->cells.assign(size_t(this->dimension) * this->dimension * this->dimension, none);
        this->buckets.clear();
        this->bucket_minimum.clear();
        this->bucket_box.clear();
        this->block_dimension = std::max<int32_t>(this->dimension >> block_shift, 1);
        size_t blocks = size_t(this->block_dimension) * this->block_dimension * this->block_dimension;
        this->block_live.assign(blocks, 0);
        this->block_minimum.assign(blocks, std::numeric_limits<uint32_t>::max());
        this->block_box.assign(blocks, empty_box);
        for (int32_t id = 0; id < (int32_t) this->clusters.size(); id++) {
            if (this->clusters[id].bucket != none) {this->link(id);}
        }
    }

public:

    explicit WardGrid(size_t expected) {
        this->clusters.reserve(2 * expected);
        this->cache_of.reserve(2 * expected);
        this->expensive.reserve(2 * expected);
        this->rebuild(0);
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
        this->block_live[this->block_of(cluster.coords)]--;
        cluster.bucket = none;
        if (this->cache_of[id] != none) {
            this->free_caches.push_back(this->cache_of[id]);
            this->cache_of[id] = none;
        }
        this->alive--;
    }

    // Re-picks the resolution (after the initial adds, then each time the cluster count halves) and rebuilds
    // the grid if it changed.
    void reindex() {
        if (this->alive > this->next_review) {return;}
        this->next_review = this->alive / 2;
        int target = this->choose_resolution();
        if (target != this->resolution) {this->rebuild(target);}
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
    // cost is at least n / (n + 1) * d^2. The first `fine_rings` rings go cell by cell; past them, a grid at
    // least two blocks across continues by rings of blocks, so empty and too-expensive regions are skipped
    // whole. Returns how many clusters were examined.
    size_t search(int32_t id, Candidates& list, int limit) const {

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

        // No member of a cell or block can cost less than its lightest possible member at the nearest point of
        // its colour box.
        auto floor_cost = [&](uint32_t minimum, const std::array<uint16_t, 6>& box) __attribute__((always_inline)) {
            double weight = get_weight(self.count, minimum) * (1.0 - 1e-12);
            uint64_t box_gap = 0;
            for (int axis = 0; axis < 3; axis++) {
                // Branchless: at most one of the two differences is positive, and each square fits in 32 bits.
                int32_t g = std::max({int32_t(box[axis]) - int32_t(p[axis]), int32_t(p[axis]) - int32_t(box[axis + 3]), 0});
                box_gap += uint64_t(uint32_t(g) * uint32_t(g));
            }
            return weight * double(box_gap);
        };

        // Called for every cell of every ring, so force it inline: as a call it costs about as much as the scan.
        auto scan = [&](int32_t x, int32_t y, int32_t z) __attribute__((always_inline)) {
            int32_t bucket = this->cells[(x * this->dimension + y) * this->dimension + z];
            if (bucket == none) {return;}
            if (floor_cost(this->bucket_minimum[bucket], this->bucket_box[bucket]) > bound) {return;}
            const Bucket& members = this->buckets[bucket];
            examined += members.size;
            for (const Chunk& chunk : members.chunks) {
                f32x4 dx = chunk.x - px, dy = chunk.y - py, dz = chunk.z - pz;
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
                    if (list.size == limit) {bound = list.costs[limit - 1];}
                }
            }
        };

        // Whether anything outside the cube of `ring - 1` units around unit `u` (units of `size` colour values,
        // `end` the last unit) could still beat the bound: everything outside lies past one of its faces.
        auto unfinished = [&](const int32_t* u, int32_t ring, int32_t end, uint64_t size) __attribute__((always_inline)) {
            uint64_t gap = std::numeric_limits<uint64_t>::max();
            for (int axis = 0; axis < 3; axis++) {
                if (u[axis] - ring >= 0) {gap = std::min<uint64_t>(gap, uint64_t(p[axis]) - (uint64_t(u[axis] - ring + 1) * size - 1u));}
                if (u[axis] + ring <= end) {gap = std::min<uint64_t>(gap, uint64_t(u[axis] + ring) * size - p[axis]);}
            }
            return gap != std::numeric_limits<uint64_t>::max() && !(minimum_weight * double(gap * gap) > bound);
        };

        const bool blocked = this->block_dimension >= 2;
        for (int32_t ring = 0; ; ring++) {

            if (ring > 0 && !unfinished(c, ring, last, this->grid_size)) {break;}
            if (blocked && ring > fine_rings) {
                this->search_blocks(c, scan, floor_cost, unfinished, bound);
                break;
            }

            for_ring(c, ring, last, scan);

        }

        return examined;

    }

    // Continues a search past its first `fine_rings` cell rings, by rings of blocks around the cell's block.
    // Cells within `fine_rings` of the search's own cell were already scanned and are skipped.
    template <typename Scan, typename Floor, typename Unfinished>
    void search_blocks(const int32_t* c, Scan& scan, Floor& floor_cost, Unfinished& unfinished, const double& bound) const {
        const int32_t b[3] = {c[0] >> block_shift, c[1] >> block_shift, c[2] >> block_shift};
        const int32_t last = this->block_dimension - 1;
        const uint64_t size = uint64_t(this->grid_size) << block_shift;
        auto visit = [&](int32_t x, int32_t y, int32_t z) __attribute__((always_inline)) {
            int32_t block = (x * this->block_dimension + y) * this->block_dimension + z;
            if (this->block_live[block] == 0) {return;}
            if (floor_cost(this->block_minimum[block], this->block_box[block]) > bound) {return;}
            for (int32_t cx = x << block_shift; cx < (x + 1) << block_shift; cx++) {
                bool x_near = cx >= c[0] - fine_rings && cx <= c[0] + fine_rings;
                for (int32_t cy = y << block_shift; cy < (y + 1) << block_shift; cy++) {
                    bool xy_near = x_near && cy >= c[1] - fine_rings && cy <= c[1] + fine_rings;
                    for (int32_t cz = z << block_shift; cz < (z + 1) << block_shift; cz++) {
                        if (xy_near && cz >= c[2] - fine_rings && cz <= c[2] + fine_rings) {continue;}
                        scan(cx, cy, cz);
                    }
                }
            }
        };
        for (int32_t ring = 0; ; ring++) {
            if (ring > 0 && !unfinished(b, ring, last, size)) {break;}
            for_ring(b, ring, last, visit);
        }
    }

    // Calls `visit` on every unit of the shell at Chebyshev distance `ring` around `u`, clipped to [0, end].
    template <typename Visit>
    static void for_ring(const int32_t* u, int32_t ring, int32_t end, Visit& visit) {
        for (int32_t x = std::max(u[0] - ring, 0); x <= std::min(u[0] + ring, end); x++) {
            bool x_edge = x == u[0] - ring || x == u[0] + ring;
            for (int32_t y = std::max(u[1] - ring, 0); y <= std::min(u[1] + ring, end); y++) {
                bool xy_edge = x_edge || y == u[1] - ring || y == u[1] + ring;
                if (xy_edge) {
                    for (int32_t z = std::max(u[2] - ring, 0); z <= std::min(u[2] + ring, end); z++) {visit(x, y, z);}
                } else {
                    if (u[2] - ring >= 0) {visit(x, y, u[2] - ring);}
                    if (ring > 0 && u[2] + ring <= end) {visit(x, y, u[2] + ring);}
                }
            }
        }
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
    [[nodiscard]] int32_t nearest(int32_t id) {

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
        size_t examined = this->search(id, list, 1);
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
    std::vector<uint32_t> totals;

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

    // Counts one pixel of the colour packed as r << 16 | g << 8 | b.
    void count(uint32_t key) {
        const uint64_t tag = uint64_t(key) + 1u;
        uint32_t slot = this->home(key);
        while (true) {
            uint64_t entry = this->slots[slot];
            if (entry == 0u) {break;}
            if ((entry >> 32) == tag) {this->totals[uint32_t(entry)]++; return;}
            slot = (slot + 1u) & this->mask;
        }
        uint32_t index = (uint32_t) this->keys.size();
        this->slots[slot] = tag << 32 | index;
        this->keys.push_back(key);
        this->totals.push_back(1u);
        // Keep the load factor at most 1/2 so probes stay short.
        if (2 * this->keys.size() > this->slots.size()) {this->resize(64 - this->shift + 1);}
    }

    // The distinct colours (packed as in count) in order of first appearance, and how often each appeared.
    const std::vector<uint32_t>& colors() const {return this->keys;}
    const std::vector<uint32_t>& counts() const {return this->totals;}

    size_t size() const {
        return this->keys.size();
    }

};

class KDTree {

private:

    struct Node {
        std::array<uint8_t, 3> point;
        int left = -1;
        int right = -1;
    };

    std::vector<Node> nodes;
    int root = -1;

    int build(std::vector<std::array<uint8_t, 3>>& points, int start, int end, int depth) {

        if (start >= end) {return -1;}
        int mid = (start + end) / 2;
        int axis = depth % 3;
        
        auto comparator = [axis](const std::array<uint8_t, 3>& a, const std::array<uint8_t, 3>& b) {
            if (axis == 0) {return a[0] < b[0];}
            if (axis == 1) {return a[1] < b[1];}
            return a[2] < b[2];
        };

        std::nth_element(points.begin() + start, points.begin() + mid, points.begin() + end, comparator);
        this->nodes.push_back(Node{points[mid], -1, -1});
        int node_index = (int) this->nodes.size() - 1;

        this->nodes[node_index].left = build(points, start, mid, depth + 1);
        this->nodes[node_index].right = build(points, mid + 1, end, depth + 1);

        return node_index;

    }

public:

    void build(std::vector<std::array<uint8_t, 3>> points) {
        this->nodes.clear();
        this->root = this->build(points, 0, (int) points.size(), 0);
    }

    [[nodiscard]] std::array<uint8_t, 3> get_nearest(const std::array<uint8_t, 3>& target) const {

        if (this->root == -1) {
            std::array<uint8_t, 3> result = {0u, 0u, 0u};
            return result;
        }

        std::array<uint8_t, 3> best_point;
        uint32_t best_distance = std::numeric_limits<uint32_t>::max();

        struct StackFrame {
            int node_index;
            int depth;
            uint32_t bound;
        };

        // The tree is median-split, so its depth is at most ~log2(n) and each pop pushes at most two
        // frames; a fixed-size stack avoids a heap allocation per query.
        StackFrame fringe[64];
        int fringe_size = 0;
        fringe[fringe_size++] = {root, 0, 0u};

        while (fringe_size > 0) {

            StackFrame frame = fringe[--fringe_size];

            // Skip subtrees that can't contain a closer point than one found since this frame was pushed.
            if (frame.bound >= best_distance) {continue;}

            const Node& node = this->nodes[frame.node_index];
            uint32_t dx = static_cast<uint32_t>(node.point[0] > target[0] ? node.point[0] - target[0] : target[0] - node.point[0]);
            uint32_t dy = static_cast<uint32_t>(node.point[1] > target[1] ? node.point[1] - target[1] : target[1] - node.point[1]);
            uint32_t dz = static_cast<uint32_t>(node.point[2] > target[2] ? node.point[2] - target[2] : target[2] - node.point[2]);
            uint32_t distance = dx * dx + dy * dy + dz * dz;

            if (distance < best_distance) {
                best_distance = distance;
                best_point = node.point;
            }

            int axis = frame.depth % 3;
            int difference = 0;
            if (axis == 0)      {difference = int(target[0]) - int(node.point[0]);}
            else if (axis == 1) {difference = int(target[1]) - int(node.point[1]);}
            else                {difference = int(target[2]) - int(node.point[2]);}

            int first = difference < 0 ? node.left : node.right;
            int second = difference < 0 ? node.right : node.left;

            // Push the far side first so the near side is popped (and searched) first, tightening best_distance.
            uint32_t split_distance = static_cast<uint32_t>(difference * difference);
            if (second != -1 && split_distance < best_distance) {fringe[fringe_size++] = {second, frame.depth + 1, split_distance};}
            if (first != -1) {fringe[fringe_size++] = {first, frame.depth + 1, frame.bound};}

        }

        return best_point;
    
    }

};

}

#endif