#if __cplusplus < 201703L
#error AgglomerativeClustering requires at least C++17"
#endif

#ifndef AGGLOMERATIVE_CLUSTERING_HPP
#define AGGLOMERATIVE_CLUSTERING_HPP

#include <unordered_map>
#include <unordered_set>
#include <functional>
#include <algorithm>
#include <vector>
#include <stdexcept>
#include <optional>
#include <cstdint>
#include <utility>
#include <limits>
#include <array>

namespace AgglomerativeClustering {

class CoarseningGrid {

public:

    struct Nearest {
        std::array<uint16_t, 3> a;
        std::array<uint16_t, 3> b;
        int32_t a_slot;
        int32_t b_slot;
    };

private:

    // Cells are stored densely, so cap the resolution to bound memory: 129^3 cell heads is ~8.5MB.
    static constexpr uint16_t max_resolution = 7u;
    static constexpr int32_t none = -1;

    // Points live in a pool and are chained into their cell with an intrusive doubly linked list.
    // Each point caches its nearest neighbour within the surrounding 3x3x3 cells.
    struct Point {
        std::array<uint16_t, 3> coords{};
        uint64_t key = 0;
        uint64_t nearest_distance = std::numeric_limits<uint64_t>::max();
        int32_t nearest = none;
        int32_t prev = none;
        int32_t next = none;
        int32_t cell = none;
        uint32_t version = 0;
        bool alive = false;
    };

    // Heap entries are invalidated lazily: an entry is stale once its point's version moves on.
    // Ties are broken on packed coordinates so the chosen pair is deterministic.
    struct Entry {

        uint64_t distance;
        uint64_t key_a;
        uint64_t key_b;
        int32_t slot;
        uint32_t version;

        bool operator>(const Entry& other) const {
            if (distance != other.distance) {return distance > other.distance;}
            if (key_a != other.key_a) {return key_a > other.key_a;}
            return key_b > other.key_b;
        }

    };

    uint16_t resolution = 0;
    uint16_t grid_size = 0;
    uint16_t dimension = 0;
    std::vector<int32_t> cells;
    std::vector<Point> points;
    std::vector<int32_t> free_slots;
    std::vector<Entry> heap;
    size_t alive = 0;

    static uint64_t pack(const std::array<uint16_t, 3>& point) {
        return (uint64_t(point[0]) << 32) | (uint64_t(point[1]) << 16) | uint64_t(point[2]);
    }

    static uint64_t get_distance(const std::array<uint16_t, 3>& a, const std::array<uint16_t, 3>& b) {
        uint64_t dx = static_cast<uint64_t>(a[0] > b[0] ? a[0] - b[0] : b[0] - a[0]);
        uint64_t dy = static_cast<uint64_t>(a[1] > b[1] ? a[1] - b[1] : b[1] - a[1]);
        uint64_t dz = static_cast<uint64_t>(a[2] > b[2] ? a[2] - b[2] : b[2] - a[2]);
        return dx * dx + dy * dy + dz * dz;
    }

    void set_resolution(uint16_t resolution) {
        this->resolution = resolution;
        this->grid_size = std::numeric_limits<uint16_t>::max() / (1u << this->resolution);
        this->dimension = std::numeric_limits<uint16_t>::max() / this->grid_size + 1u;
        this->cells.assign(size_t(this->dimension) * this->dimension * this->dimension, none);
    }

    int32_t get_cell(const std::array<uint16_t, 3>& point) const {
        int32_t x = point[0] / this->grid_size;
        int32_t y = point[1] / this->grid_size;
        int32_t z = point[2] / this->grid_size;
        return (x * this->dimension + y) * this->dimension + z;
    }

    template<typename F>
    void for_each_local_point(const std::array<uint16_t, 3>& point, F&& func) const {

        int32_t cx = point[0] / this->grid_size;
        int32_t cy = point[1] / this->grid_size;
        int32_t cz = point[2] / this->grid_size;
        int32_t last = this->dimension - 1;

        for (int32_t x = std::max(cx - 1, 0); x <= std::min(cx + 1, last); x++) {
            for (int32_t y = std::max(cy - 1, 0); y <= std::min(cy + 1, last); y++) {
                for (int32_t z = std::max(cz - 1, 0); z <= std::min(cz + 1, last); z++) {
                    int32_t slot = this->cells[(x * this->dimension + y) * this->dimension + z];
                    while (slot != none) {
                        int32_t next = this->points[slot].next;
                        func(slot);
                        slot = next;
                    }
                }
            }
        }

    }

    void link(int32_t slot) {
        Point& point = this->points[slot];
        point.cell = this->get_cell(point.coords);
        point.prev = none;
        point.next = this->cells[point.cell];
        if (point.next != none) {this->points[point.next].prev = slot;}
        this->cells[point.cell] = slot;
    }

    void unlink(int32_t slot) {
        Point& point = this->points[slot];
        if (point.prev != none) {this->points[point.prev].next = point.next;}
        else {this->cells[point.cell] = point.next;}
        if (point.next != none) {this->points[point.next].prev = point.prev;}
    }

    // Invalidates the point's previous heap entry and pushes its current nearest neighbour, if any.
    void push(int32_t slot) {
        Point& point = this->points[slot];
        point.version++;
        if (point.nearest == none) {return;}
        this->heap.push_back({point.nearest_distance, point.key, this->points[point.nearest].key, slot, point.version});
        std::push_heap(this->heap.begin(), this->heap.end(), std::greater<Entry>());
    }

    bool is_closer(uint64_t distance, int32_t candidate, const Point& point) const {
        if (distance != point.nearest_distance) {return distance < point.nearest_distance;}
        return point.nearest == none || this->points[candidate].key < this->points[point.nearest].key;
    }

    // Recomputes a point's nearest neighbour from scratch.
    void find_nearest(int32_t slot) {

        Point& point = this->points[slot];
        point.nearest = none;
        point.nearest_distance = std::numeric_limits<uint64_t>::max();

        this->for_each_local_point(point.coords, [&](int32_t other) {
            if (other == slot) {return;}
            uint64_t distance = get_distance(point.coords, this->points[other].coords);
            if (!this->is_closer(distance, other, point)) {return;}
            point.nearest = other;
            point.nearest_distance = distance;
        });

        this->push(slot);

    }

    void rebuild() {

        this->heap.clear();
        for (int32_t slot = 0; slot < (int32_t) this->points.size(); slot++) {
            if (this->points[slot].alive) {this->link(slot);}
        }

        for (int32_t slot = 0; slot < (int32_t) this->points.size(); slot++) {
            if (this->points[slot].alive) {this->find_nearest(slot);}
        }

    }

    // Rebuilds the heap from live entries once stale ones dominate, so it stays proportional to the point count.
    void compact() {

        if (this->heap.size() <= 4 * this->alive + 1024) {return;}

        this->heap.clear();
        for (int32_t slot = 0; slot < (int32_t) this->points.size(); slot++) {
            const Point& point = this->points[slot];
            if (!point.alive || point.nearest == none) {continue;}
            this->heap.push_back({point.nearest_distance, point.key, this->points[point.nearest].key, slot, point.version});
        }
        std::make_heap(this->heap.begin(), this->heap.end(), std::greater<Entry>());

    }

    void remove(int32_t slot) {
        Point& point = this->points[slot];
        this->unlink(slot);
        point.alive = false;
        point.version++;
        this->alive--;
        this->free_slots.push_back(slot);
    }

    // Points whose cached nearest neighbour was a removed point must be recomputed; they can only be local to it.
    void repair(const std::array<uint16_t, 3>& removed, int32_t a_slot, int32_t b_slot) {
        this->for_each_local_point(removed, [&](int32_t other) {
            int32_t nearest = this->points[other].nearest;
            if (nearest == a_slot || nearest == b_slot) {this->find_nearest(other);}
        });
    }

public:

    CoarseningGrid(uint16_t resolution) {
        this->set_resolution(std::min(resolution, max_resolution));
    }

    void add(const std::array<uint16_t, 3>& point) {

        // If we already have this point, don't add it.
        int32_t cell = this->get_cell(point);
        for (int32_t slot = this->cells[cell]; slot != none; slot = this->points[slot].next) {
            if (this->points[slot].coords == point) {return;}
        }

        int32_t slot;
        if (!this->free_slots.empty()) {slot = this->free_slots.back(); this->free_slots.pop_back();}
        else {slot = (int32_t) this->points.size(); this->points.emplace_back();}

        Point& added = this->points[slot];
        added.coords = point;
        added.key = pack(point);
        added.nearest = none;
        added.nearest_distance = std::numeric_limits<uint64_t>::max();
        added.alive = true;
        this->alive++;
        this->link(slot);

        // A single pass finds the new point's nearest neighbour and offers it to every local point.
        this->for_each_local_point(point, [&](int32_t other) {

            if (other == slot) {return;}
            Point& current = this->points[other];
            uint64_t distance = get_distance(point, current.coords);

            if (this->is_closer(distance, other, added)) {
                added.nearest = other;
                added.nearest_distance = distance;
            }

            if (this->is_closer(distance, slot, current)) {
                current.nearest = slot;
                current.nearest_distance = distance;
                this->push(other);
            }

        });

        this->push(slot);

    }

    // Replaces the pair returned by get_nearest with their merged point.
    void merge(const Nearest& nearest, const std::array<uint16_t, 3>& merged) {
        this->remove(nearest.a_slot);
        this->remove(nearest.b_slot);
        this->repair(nearest.a, nearest.a_slot, nearest.b_slot);
        this->repair(nearest.b, nearest.a_slot, nearest.b_slot);
        this->add(merged);
        this->compact();
    }

    // Returns the closest pair among points in neighbouring cells, coarsening the grid when no such pair exists.
    [[nodiscard]] std::optional<Nearest> get_nearest() {

        while (true) {

            while (!this->heap.empty()) {
                const Entry& top = this->heap.front();
                const Point& point = this->points[top.slot];
                if (point.alive && point.version == top.version) {
                    return Nearest{point.coords, this->points[point.nearest].coords, top.slot, point.nearest};
                }
                std::pop_heap(this->heap.begin(), this->heap.end(), std::greater<Entry>());
                this->heap.pop_back();
            }

            if (this->alive < 2 || this->resolution == 0u) {return std::nullopt;}
            this->set_resolution(this->resolution - 1u);
            this->rebuild();

        }

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

    std::array<uint16_t, 3> merge(std::array<uint16_t, 3> a, std::array<uint16_t, 3> b) {

        uint32_t a_count = this->histogram[a];
        uint32_t b_count = this->histogram[b];
        uint32_t merged_count = a_count + b_count;

        std::array<uint16_t, 3> merged = {
            static_cast<uint16_t>((uint64_t(a[0]) * a_count + uint64_t(b[0]) * b_count) / merged_count),
            static_cast<uint16_t>((uint64_t(a[1]) * a_count + uint64_t(b[1]) * b_count) / merged_count),
            static_cast<uint16_t>((uint64_t(a[2]) * a_count + uint64_t(b[2]) * b_count) / merged_count)
        };

        this->histogram.erase(a);
        this->histogram.erase(b);
        this->histogram[merged] += merged_count;

        return merged;

    }

    size_t size() {
        return this->histogram.size();
    }

    std::array<uint16_t, 3> last() {
        if (this->histogram.size() != 1) {throw std::logic_error("AgglomerativeHistogram::last: method must be called when there is exactly one final element remaining.");}
        return this->histogram.begin()->first;
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