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

    // Each occupied cell stores its clusters contiguously with everything a scan reads.
    struct Member {
        std::array<uint16_t, 3> coords;
        uint32_t count;
        int32_t id;
    };

    struct Cluster {
        std::array<uint16_t, 3> coords;
        uint32_t count;
        int32_t bucket;
        int32_t index;
    };

    int resolution = -1;
    uint32_t grid_size = 0;
    int32_t dimension = 0;
    std::vector<int32_t> cells;
    std::vector<std::vector<Member>> buckets;
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

    // Aim for about one cluster per cell; coarser grids are cheaper to search once clusters are sparse.
    static int resolution_for(size_t count) {
        int r = 0;
        while (r < max_resolution && (size_t(1) << (3 * (r + 1))) <= count) {r++;}
        return r;
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
        }
        cluster.bucket = this->cells[cell];
        cluster.index = (int32_t) this->buckets[cluster.bucket].size();
        this->buckets[cluster.bucket].push_back({cluster.coords, cluster.count, id});
    }

    void rebuild(int resolution) {
        this->resolution = resolution;
        this->grid_size = (uint32_t(std::numeric_limits<uint16_t>::max()) + 1u) >> resolution;
        this->dimension = int32_t(1) << resolution;
        this->cells.assign(size_t(this->dimension) * this->dimension * this->dimension, none);
        std::vector<std::vector<Member>> previous;
        previous.swap(this->buckets);
        for (const std::vector<Member>& bucket : previous) {
            for (const Member& member : bucket) {this->link(member.id);}
        }
    }

public:

    explicit WardGrid(size_t expected) {
        this->clusters.reserve(2 * expected);
        this->rebuild(resolution_for(expected));
    }

    int32_t add(const std::array<uint16_t, 3>& coords, uint32_t count) {
        int32_t id = (int32_t) this->clusters.size();
        this->clusters.push_back({coords, count, none, none});
        this->link(id);
        this->alive++;
        return id;
    }

    void remove(int32_t id) {
        Cluster& cluster = this->clusters[id];
        std::vector<Member>& bucket = this->buckets[cluster.bucket];
        if (cluster.index != (int32_t) bucket.size() - 1) {
            bucket[cluster.index] = bucket.back();
            this->clusters[bucket[cluster.index].id].index = cluster.index;
        }
        bucket.pop_back();
        cluster.bucket = none;
        this->alive--;
    }

    // Coarsens the grid once clusters have thinned out enough for a lower resolution.
    void coarsen() {
        int target = resolution_for(this->alive);
        if (target < this->resolution) {this->rebuild(target);}
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

    // Finds the live cluster that is cheapest to merge with `id`, searching outward ring by ring and stopping
    // once no unvisited cell can hold a cheaper partner. Every partner has at least one pixel, so beyond
    // distance d the cost is at least n / (n + 1) * d^2.
    [[nodiscard]] int32_t nearest(int32_t id) const {

        const Cluster& self = this->clusters[id];
        const std::array<uint16_t, 3>& p = self.coords;
        const int32_t c[3] = {this->cell_of(p[0]), this->cell_of(p[1]), this->cell_of(p[2])};
        const int32_t last = this->dimension - 1;
        const double minimum_weight = get_weight(self.count, 1u) * (1.0 - 1e-12);

        int32_t best = none;
        double best_cost = std::numeric_limits<double>::infinity();

        auto scan = [&](int32_t x, int32_t y, int32_t z) {
            int32_t bucket = this->cells[(x * this->dimension + y) * this->dimension + z];
            if (bucket == none) {return;}
            for (const Member& member : this->buckets[bucket]) {
                if (member.id == id) {continue;}
                double cost = get_weight(self.count, member.count) * double(get_distance(p, member.coords));
                if (cost > best_cost) {continue;}
                if (this->is_before(id, cost, member.id, best_cost, best)) {best = member.id; best_cost = cost;}
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
                if (best != none && minimum_weight * double(gap * gap) > best_cost) {break;}
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

        return best;

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