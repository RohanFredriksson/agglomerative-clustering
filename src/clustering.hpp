#if __cplusplus < 201703L
#error AgglomerativeClustering requires at least C++17"
#endif

#ifndef AGGLOMERATIVE_CLUSTERING_HPP
#define AGGLOMERATIVE_CLUSTERING_HPP

#include <unordered_map>
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
        // Morton codes at the finest resolution: dropping the low 3 bits gives the code one level coarser,
        // so one sort answers the occupied-cell count at every resolution.
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
        std::sort(codes.begin(), codes.end());
        for (int r = max_resolution; r > 0; r--) {
            int shift = 3 * (max_resolution - r);
            size_t occupied = 0;
            for (size_t i = 0; i < codes.size(); i++) {
                if (i == 0 || (codes[i] >> shift) != (codes[i - 1] >> shift)) {occupied++;}
            }
            if (double(this->alive) >= target_occupancy * double(occupied)) {return r;}
        }
        return 0;
    }

    int32_t cell_of(uint16_t value) const {
        return int32_t(value / this->grid_size);
    }

    void link(int32_t id) {
        Cluster& cluster = this->clusters[id];
        int32_t cell = (this->cell_of(cluster.coords[0]) * this->dimension + this->cell_of(cluster.coords[1])) * this->dimension + this->cell_of(cluster.coords[2]);
        if (this->cells[cell] == none) {
            this->cells[cell] = (int32_t) this->buckets.size();
            this->buckets.emplace_back();
            this->bucket_minimum.push_back(std::numeric_limits<uint32_t>::max());
        }
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
    // cost is at least n / (n + 1) * d^2. Returns how many clusters were examined.
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

        // Squared distance from p to the nearest point of a cell, per axis.
        auto axis_gap = [&](int axis, int32_t cell) -> uint64_t {
            uint64_t lo = uint64_t(cell) * this->grid_size;
            uint64_t hi = lo + this->grid_size - 1u;
            uint64_t gap = p[axis] < lo ? lo - p[axis] : p[axis] > hi ? p[axis] - hi : 0u;
            return gap * gap;
        };

        auto scan = [&](int32_t x, int32_t y, int32_t z) {
            int32_t bucket = this->cells[(x * this->dimension + y) * this->dimension + z];
            if (bucket == none) {return;}
            // No member of this cell can cost less than its lightest possible member at the cell's nearest point.
            double cell_weight = get_weight(self.count, this->bucket_minimum[bucket]) * (1.0 - 1e-12);
            if (cell_weight * double(axis_gap(0, x) + axis_gap(1, y) + axis_gap(2, z)) > bound) {return;}
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

        for (int32_t ring = 0; ; ring++) {

            // Anything outside the cells already searched lies past one of the cube's faces.
            if (ring > 0) {
                uint64_t gap = std::numeric_limits<uint64_t>::max();
                for (int axis = 0; axis < 3; axis++) {
                    if (c[axis] - ring >= 0) {gap = std::min<uint64_t>(gap, uint64_t(p[axis]) - (uint64_t(c[axis] - ring + 1) * this->grid_size - 1u));}
                    if (c[axis] + ring <= last) {gap = std::min<uint64_t>(gap, uint64_t(c[axis] + ring) * this->grid_size - p[axis]);}
                }
                if (gap == std::numeric_limits<uint64_t>::max()) {break;}
                if (minimum_weight * double(gap * gap) > bound) {break;}
            }

            for (int32_t x = std::max(c[0] - ring, 0); x <= std::min(c[0] + ring, last); x++) {
                bool x_edge = x == c[0] - ring || x == c[0] + ring;
                for (int32_t y = std::max(c[1] - ring, 0); y <= std::min(c[1] + ring, last); y++) {
                    bool xy_edge = x_edge || y == c[1] - ring || y == c[1] + ring;
                    if (xy_edge) {
                        for (int32_t z = std::max(c[2] - ring, 0); z <= std::min(c[2] + ring, last); z++) {scan(x, y, z);}
                    } else {
                        if (c[2] - ring >= 0) {scan(x, y, c[2] - ring);}
                        if (ring > 0 && c[2] + ring <= last) {scan(x, y, c[2] + ring);}
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

class AgglomerativeHistogram {

private:

    struct ArrayHash {
        std::size_t operator()(const std::array<uint16_t, 3>& arr) const noexcept {
            uint64_t v = (uint64_t(arr[0]) << 32) | (uint64_t(arr[1]) << 16) | arr[2];
            v ^= v >> 33;
            v *= 0xff51afd7ed558ccdULL;
            v ^= v >> 33;
            v *= 0xc4ceb9fe1a85ec53ULL;
            v ^= v >> 33;
            return static_cast<std::size_t>(v);
        }
    };

    std::unordered_map<std::array<uint16_t, 3>, uint32_t, ArrayHash> histogram;

public:

    bool count(std::array<uint16_t, 3> color) {
        auto it = this->histogram.find(color);
        if (it != this->histogram.end()) {it->second++; return false;}
        this->histogram[color] = 1u;
        return true;
    }

    uint32_t get(const std::array<uint16_t, 3>& color) const {
        auto it = this->histogram.find(color);
        return it == this->histogram.end() ? 0u : it->second;
    }

    size_t size() const {
        return this->histogram.size();
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