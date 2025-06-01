#if __cplusplus < 201703L
#error AgglomerativeClustering requires at least C++17"
#endif

#ifndef AGGLOMERATIVE_CLUSTERING_HPP
#define AGGLOMERATIVE_CLUSTERING_HPP

#include <unordered_map>
#include <unordered_set>
#include <functional>
#include <stdexcept>
#include <optional>
#include <cstdint>
#include <utility>
#include <limits>
#include <array>
#include <map>

namespace AgglomerativeClustering {

class CoarseningGrid {

private:

    struct ArrayHash {
        std::size_t operator()(const std::array<uint16_t, 3>& arr) const noexcept {
            size_t seed = 0;
            for (auto elem : arr) {seed ^= std::hash<uint16_t>{}(elem) + 0x9e3779b9 + (seed << 6) + (seed >> 2);}
            return seed;
        }
    };

    struct Pair {

        std::array<uint16_t, 3> a{};
        std::array<uint16_t, 3> b{};
        uint64_t distance = std::numeric_limits<uint64_t>::max();

        Pair() = default;

        Pair(const std::array<uint16_t, 3>& a, const std::array<uint16_t, 3>& b) : a(a), b(b) {
            uint64_t dx = static_cast<uint64_t>(a[0] > b[0] ? a[0] - b[0] : b[0] - a[0]);
            uint64_t dy = static_cast<uint64_t>(a[1] > b[1] ? a[1] - b[1] : b[1] - a[1]);
            uint64_t dz = static_cast<uint64_t>(a[2] > b[2] ? a[2] - b[2] : b[2] - a[2]);
            distance = dx * dx + dy * dy + dz * dz;
        }

        bool operator>=(const Pair& other) const {
            return distance >= other.distance;
        }

        bool contains(const std::array<uint16_t, 3>& point) const {
            return a == point || b == point;
        }

    };

    struct Bucket {

        std::array<uint16_t, 3> location{};
        std::unordered_set<std::array<uint16_t, 3>, ArrayHash> points;
        Pair best;

        Bucket(const std::array<uint16_t, 3>& location) : location(location) {}

    };

    uint16_t resolution;
    uint16_t grid_size;
    std::unordered_map<std::array<uint16_t, 3>, Bucket*, ArrayHash> grid;
    std::map<uint64_t, std::unordered_set<Bucket*>> cache;

    std::vector<Bucket*> get_local_buckets(const std::array<uint16_t, 3>& location) const {

        std::vector<Bucket*> result;
        result.reserve(27);

        std::array<uint16_t, 3> min = location;
        if (min[0] > 0u) {min[0]--;}
        if (min[1] > 0u) {min[1]--;}
        if (min[2] > 0u) {min[2]--;}

        std::array<uint16_t, 3> max = location;
        max[0]++;
        max[1]++;
        max[2]++;

        for (uint16_t x = min[0]; x <= max[0]; x++) {
            for (uint16_t y = min[1]; y <= max[1]; y++) {
                for (uint16_t z = min[2]; z <= max[2]; z++) {
                    std::array<uint16_t, 3> bucket_position = {x, y, z};
                    auto it = this->grid.find(bucket_position);
                    if (it != this->grid.end()) {result.push_back(it->second);}
                }
            }
        }

        return result;

    }

    std::vector<std::array<uint16_t, 3>> get_all_points() const {
        
        size_t total_size = 0;
        std::vector<std::array<uint16_t, 3>> result;
        for (const auto& pair : this->grid) {total_size += pair.second->points.size();}
        result.reserve(total_size);

        for (const auto& pair : this->grid) {result.insert(result.end(), pair.second->points.begin(), pair.second->points.end());}
        return result;

    }

    std::vector<std::array<uint16_t, 3>> get_local_points(std::array<uint16_t, 3> location) const {

        size_t total_size = 0; 
        std::vector<Bucket*> buckets = this->get_local_buckets(location);
        for (Bucket* bucket : buckets) {total_size += bucket->points.size();}
        
        std::vector<std::array<uint16_t, 3>> result;
        result.reserve(total_size);
        for (Bucket* bucket : buckets) {result.insert(result.end(), bucket->points.begin(), bucket->points.end());}
        return result;

    }

    std::array<uint16_t, 3> get_location(const std::array<uint16_t, 3>& point) const {
        std::array<uint16_t, 3> result = {static_cast<uint16_t>(point[0] / this->grid_size), static_cast<uint16_t>(point[1] / this->grid_size), static_cast<uint16_t>(point[2] / this->grid_size)};
        return result;
    }

    void add_cache(Bucket* bucket) {
        if (this->cache.find(bucket->best.distance) == this->cache.end()) {this->cache[bucket->best.distance] = std::unordered_set<Bucket*>();}
        this->cache[bucket->best.distance].insert(bucket);
    } 

    void remove_cache(Bucket* bucket) {
        this->cache[bucket->best.distance].erase(bucket);
        if (this->cache[bucket->best.distance].size() == 0) {this->cache.erase(bucket->best.distance);}
    }

public:

    CoarseningGrid(uint16_t resolution) {
        this->resolution = resolution;
        this->grid_size = std::numeric_limits<uint16_t>::max() / (1u << this->resolution);
    }

    ~CoarseningGrid() {
        for (const auto& pair : this->grid) {
            delete pair.second;
        }
    }

    inline void add(uint16_t x, uint16_t y, uint16_t z) {
        std::array<uint16_t, 3> point = {x, y, z};
        this->add(point);
    }

    void add(std::array<uint16_t, 3> point) {

        // If we don't have the required bucket, allocate one.
        std::array<uint16_t, 3> location = this->get_location(point);
        if (this->grid.find(location) == this->grid.end()) {
            Bucket* bucket = new Bucket(location);
            this->grid[location] = bucket;
            this->add_cache(bucket);
        }

        // If we already have this point, don't add it.
        else if (this->grid[location]->points.find(point) != this->grid[location]->points.end()) {
            return;
        }

        std::vector<Bucket*> buckets = this->get_local_buckets(location);
        for (Bucket* bucket : buckets) {

            bool recache = false;
            Pair best = bucket->best;

            for (const std::array<uint16_t, 3>& current_point : bucket->points) {
                Pair pair(current_point, point);
                if (pair >= best) {continue;}
                recache = true;
                best = pair;
            }

            if (!recache) {continue;}
            this->remove_cache(bucket);
            bucket->best = best;
            this->add_cache(bucket);

        }

        // Insert into the bucket
        this->grid[location]->points.insert(point);
        
    }

    inline void remove(uint16_t x, uint16_t y, uint16_t z) {
        std::array<uint16_t, 3> point = {x, y, z};
        this->remove(point);
    }

    void remove(std::array<uint16_t, 3> point) {

        // We can't remove a point if there is no bucket for it.
        std::array<uint16_t, 3> location = this->get_location(point);
        if (this->grid.find(location) == this->grid.end()) {return;}
        Bucket* bucket = this->grid[location];

        // If the point isn't in the bucket, we can't remove it.
        if (bucket->points.find(point) == bucket->points.end()) {return;}
        this->grid[location]->points.erase(point);

        // If the bucket is empty delete the bucket.
        if (bucket->points.size() == 0) {
            this->grid.erase(location);
            this->remove_cache(bucket);
            delete bucket;
        }

        std::vector<Bucket*> buckets = this->get_local_buckets(location);
        for (Bucket* bucket : buckets) {

            // If the best point doesn't include the removed point we don't need to recache.
            if (!bucket->best.contains(point)) {continue;}
            this->remove_cache(bucket);
            bucket->best = Pair();

            // Brute force closest point search, this should be okay since there should not be too many points.
            std::vector<std::array<uint16_t, 3>> local_points = this->get_local_points(bucket->location);
            for (size_t i = 0; i < local_points.size(); i++) {
                for (const std::array<uint16_t, 3>& current_point : bucket->points) {
                    if (current_point == local_points[i]) {continue;}
                    Pair pair(current_point, local_points[i]);
                    if (pair >= bucket->best) {continue;}
                    bucket->best = pair;
                }
            }

            this->add_cache(bucket);

        }

    }
    
    [[nodiscard]] std::optional<std::pair<std::array<uint16_t, 3>, std::array<uint16_t, 3>>> get_nearest() {
    
        if (this->cache.size() == 0) {return std::nullopt;}
        std::unordered_set<Bucket*> best_buckets = this->cache.begin()->second;

        Pair best = (*best_buckets.begin())->best;
        if (best.distance != std::numeric_limits<uint64_t>::max()) {return std::make_pair(best.a, best.b);}
        if (best.distance == std::numeric_limits<uint64_t>::max() && this->resolution == 0u) {return std::nullopt;}

        std::vector<std::array<uint16_t, 3>> points = this->get_all_points();
        for (const auto& pair : this->grid) {delete pair.second;}
        this->cache.clear();
        this->grid.clear();

        this->resolution = this->resolution - 1u;
        this->grid_size = std::numeric_limits<uint16_t>::max() / (1u << this->resolution);
        for (std::array<uint16_t, 3> point : points) {this->add(point);}
        return this->get_nearest();

    }

};

class AgglomerativeHistogram {

private:

    struct ArrayHash {
        std::size_t operator()(const std::array<uint16_t, 3>& arr) const noexcept {
            size_t seed = 0;
            for (auto elem : arr) {seed ^= std::hash<uint16_t>{}(elem) + 0x9e3779b9 + (seed << 6) + (seed >> 2);}
            return seed;
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
        double a_ratio = (double) a_count / (double) merged_count;
        double b_ratio = (double) b_count / (double) merged_count;

        std::array<uint16_t, 3> merged = {
            static_cast<uint16_t>(a[0] * a_ratio + b[0] * b_ratio),
            static_cast<uint16_t>(a[1] * a_ratio + b[1] * b_ratio),
            static_cast<uint16_t>(a[2] * a_ratio + b[2] * b_ratio)
        };

        this->histogram.erase(a);
        this->histogram.erase(b);

        auto it = this->histogram.find(merged);
        if (it != this->histogram.end()) {it->second += merged_count;}
        this->histogram[merged] = merged_count;

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

}

#endif