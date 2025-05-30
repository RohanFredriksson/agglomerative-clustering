// Average Hierarchical Agglomerative Color Clustering
#include <map>
#include <vector>
#include <cstdint>
#include <cstdlib>
#include <emscripten.h>
#include <unordered_map>
#include <unordered_set>

#include <iostream>

inline void hash_combine(std::size_t& seed, std::size_t value) {
    seed ^= value + 0x9e3779b9 + (seed << 6) + (seed >> 2);
}

class Vector3 {
    
public:

    uint16_t x;
    uint16_t y;
    uint16_t z;

    Vector3() {
        this->x = 0u;
        this->y = 0u;
        this->z = 0u;
    }

    Vector3(uint16_t x, uint16_t y, uint16_t z) {
        this->x = x;
        this->y = y;
        this->z = z;
    }

    bool operator==(const Vector3& other) const {
        return (x == other.x) &&
               (y == other.y) &&
               (z == other.z);
    }

};

std::ostream& operator<<(std::ostream& os, const Vector3& v) {
    os << "(" << v.x << ", " << v.y << ", " << v.z << ")";
    return os;
}

namespace std {
    template <>
    struct hash<Vector3> {
        std::size_t operator()(const Vector3& v) const noexcept {
            std::size_t seed = 0;
            hash_combine(seed, v.x);
            hash_combine(seed, v.y);
            hash_combine(seed, v.z);
            return seed;
        }
    };
}

class Pair {

public:

    Vector3 a;
    Vector3 b;
    uint64_t distance = std::numeric_limits<uint64_t>::max();

    Pair() {

    }

    Pair(Vector3 a, Vector3 b) {
    
        this->a = a;
        this->b = b;

        uint64_t dx = a.x > b.x ? (uint64_t)(a.x - b.x) : (uint64_t)(b.x - a.x);
        uint64_t dy = a.y > b.y ? (uint64_t)(a.y - b.y) : (uint64_t)(b.y - a.y);
        uint64_t dz = a.z > b.z ? (uint64_t)(a.z - b.z) : (uint64_t)(b.z - a.z);

        this->distance = dx * dx + dy * dy + dz * dz;

    }

    bool operator<(const Pair& other) const {
        return distance < other.distance;
    }

    bool operator==(const Pair& other) const {
        return (a == other.a && b == other.b) || (a == other.b && b == other.a);
    }

    bool operator!=(const Pair& other) const {
        return !(*this == other);
    }

    bool contains(Vector3 vector) {
        return this->a == vector || this->b == vector;
    }

};

class Bucket {

public:

    Vector3 location;
    std::unordered_set<Vector3> points;
    Pair best;

    Bucket(Vector3 location) : location(location) {

    }

};

struct BucketComparator {
    bool operator()(const Bucket* lhs, const Bucket* rhs) const {
        if (lhs->best != rhs->best) {return lhs->best < rhs->best;}
        return lhs < rhs;
    }
};

class SpatialGrid {

public:

    uint16_t resolution;
    uint16_t grid_size;
    size_t size = 0;
    std::unordered_map<Vector3, Bucket*> grid;
    std::map<uint64_t, std::unordered_set<Bucket*>> cache;

    SpatialGrid(uint16_t resolution) {
        this->resolution = resolution;
        this->grid_size = std::numeric_limits<uint16_t>::max() / (1u << this->resolution);
    }

    ~SpatialGrid() {
        for (const auto& pair : this->grid) {
            delete pair.second;
        }
    }

    std::vector<Bucket*> get_local_buckets(Vector3 location) {

        std::vector<Bucket*> result;
        result.reserve(27);

        Vector3 min = location;
        if (min.x > 0u) {min.x--;}
        if (min.y > 0u) {min.y--;}
        if (min.z > 0u) {min.z--;}

        Vector3 max = location;
        max.x++;
        max.y++;
        max.z++;

        for (uint16_t x = min.x; x <= max.x; x++) {
            for (uint16_t y = min.y; y <= max.y; y++) {
                for (uint16_t z = min.z; z <= max.z; z++) {
                    Vector3 bucket_position = Vector3(x, y, z);
                    if (this->grid.find(bucket_position) == this->grid.end()) {continue;}
                    result.push_back(this->grid[bucket_position]);
                }
            }
        }

        return result;

    }

    std::vector<Vector3> get_all_points() {
        
        size_t total_size = 0;
        std::vector<Vector3> result;
        for (const auto& pair : this->grid) {total_size += pair.second->points.size();}
        result.reserve(total_size);

        for (const auto& pair : this->grid) {result.insert(result.end(), pair.second->points.begin(), pair.second->points.end());}
        return result;

    }

    std::vector<Vector3> get_local_points(Vector3 location) {

        size_t total_size = 0; 
        std::vector<Bucket*> buckets = this->get_local_buckets(location);
        for (Bucket* bucket : buckets) {total_size += bucket->points.size();}
        
        std::vector<Vector3> result;
        result.reserve(total_size);
        for (Bucket* bucket : buckets) {result.insert(result.end(), bucket->points.begin(), bucket->points.end());}
        return result;

    }

    Vector3 get_location(Vector3 point) {
        return Vector3(
            point.x / this->grid_size,
            point.y / this->grid_size,
            point.z / this->grid_size
        );   
    }

    void add_cache(Bucket* bucket) {
        if (this->cache.find(bucket->best.distance) == this->cache.end()) {this->cache[bucket->best.distance] = std::unordered_set<Bucket*>();}
        this->cache[bucket->best.distance].insert(bucket);
    } 

    void remove_cache(Bucket* bucket) {
        this->cache[bucket->best.distance].erase(bucket);
        if (this->cache[bucket->best.distance].size() == 0) {this->cache.erase(bucket->best.distance);}
    }

    void add(Vector3 point) {

        // If we don't have the required bucket, allocate one.
        Vector3 location = this->get_location(point);
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

            for (const Vector3& current_point : bucket->points) {
                Pair pair(current_point, point);
                if (!(pair < best)) {continue;}
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
        this->size++;
        
    }

    void remove(Vector3 point) {

        // We can't remove a point if there is no bucket for it.
        Vector3 location = this->get_location(point);
        if (this->grid.find(location) == this->grid.end()) {return;}
        Bucket* bucket = this->grid[location];

        // If the point isn't in the bucket, we can't remove it.
        if (bucket->points.find(point) == bucket->points.end()) {return;}
        this->grid[location]->points.erase(point);
        this->size--;

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
            std::vector<Vector3> local_points = this->get_local_points(bucket->location);
            for (size_t i = 0; i < local_points.size(); i++) {
                for (const Vector3& current_point : bucket->points) {
                    if (current_point == local_points[i]) {continue;}
                    Pair pair(current_point, local_points[i]);
                    if (!(pair < bucket->best)) {continue;}
                    bucket->best = pair;
                }
            }

            this->add_cache(bucket);

        }

    }
    
    Pair get_nearest() {
    
        if (this->cache.size() == 0) {return Pair();}
        std::unordered_set<Bucket*> best_buckets = this->cache.begin()->second;
        if (best_buckets.size() == 0) {std::cout << "ERROR EMPTY CACHE.\n";}

        Pair best = (*best_buckets.begin())->best;
        if (best.distance != std::numeric_limits<uint64_t>::max()) {return best;}
        if (best.distance == std::numeric_limits<uint64_t>::max() && this->resolution == 0u) {return Pair();}

        this->size = 0;

        std::vector<Vector3> points = this->get_all_points();
        for (const auto& pair : this->grid) {delete pair.second;}
        this->cache.clear();
        this->grid.clear();

        this->resolution = this->resolution - 1u;
        this->grid_size = std::numeric_limits<uint16_t>::max() / (1u << this->resolution);
        for (Vector3 point : points) {this->add(point);}
        return this->get_nearest();

    }

    void copy(SpatialGrid* grid) {        
        for (const auto& pair : this->grid) {
            for (Vector3 point : pair.second->points) {
                grid->add(point);
            }
        }
    }

};

inline uint16_t uint8_to_uint16(uint8_t value) {
    return (uint16_t(value) * std::numeric_limits<uint16_t>::max()) / std::numeric_limits<uint8_t>::max();
}

inline uint8_t uint16_to_uint8(uint16_t value) {
    return (uint8_t)((uint32_t(value) * std::numeric_limits<uint8_t>::max()) / std::numeric_limits<uint16_t>::max());
}

extern "C" {

class MergeOperation {
    
public:

    Vector3 merged;
    Vector3 a;
    Vector3 b;
    uint32_t a_count;
    uint32_t b_count;

    MergeOperation(Vector3 merged, Vector3 a, Vector3 b, uint32_t a_count, uint32_t b_count) {
        this->merged = merged;
        this->a = a;
        this->b = b;
        this->a_count = a_count;
        this->b_count = b_count;
    }

};

EMSCRIPTEN_KEEPALIVE
uint8_t* process(uint8_t* input, int length) {
    
    uint8_t* output = (uint8_t*) malloc(length);
    std::unordered_map<Vector3, uint32_t> histogram;
    uint16_t current_resolution = 5u;
    SpatialGrid spatial_grid(current_resolution);

    for (int i = 0; i < length - 2; i += 3) {

        Vector3 color(uint8_to_uint16(input[i]), uint8_to_uint16(input[i+1]), uint8_to_uint16(input[i+2]));
        
        // If we already have this point, increment the histogram
        if (histogram.find(color) != histogram.end()) {
            histogram[color] = histogram[color] + 1u;
            continue;
        }

        spatial_grid.add(color);
        histogram[color] = 1u;

    }

    std::cout << histogram.size() << "\n";
    std::vector<MergeOperation> operations;
    operations.reserve(histogram.size() - 1);

    while (true) {

        Pair best_pair = spatial_grid.get_nearest();
        if (best_pair.distance == std::numeric_limits<uint64_t>::max()) {break;}

        // Merge the nearest points together.
        uint32_t a_count = histogram[best_pair.a];
        uint32_t b_count = histogram[best_pair.b];
        uint32_t merged_count = a_count + b_count;
        double a_ratio = (double) a_count / (double) merged_count;
        double b_ratio = (double) b_count / (double) merged_count;
        
        Vector3 merged(
            best_pair.a.x * a_ratio + best_pair.b.x * b_ratio,
            best_pair.a.y * a_ratio + best_pair.b.y * b_ratio,
            best_pair.a.z * a_ratio + best_pair.b.z * b_ratio
        );

        histogram.erase(best_pair.a);
        histogram.erase(best_pair.b);

        if (histogram.find(merged) == histogram.end()) {histogram[merged] = merged_count;}
        else {histogram[merged] = histogram[merged] + merged_count;}

        MergeOperation operation(merged, best_pair.a, best_pair.b, a_count, b_count);
        operations.push_back(operation);

        std::cout << "HISTOGRAM SIZE: " << histogram.size() << " OPERATIONS SIZE: " << operations.size() << " BOTH: " << histogram.size() + operations.size() << "\n";

        spatial_grid.remove(best_pair.a);
        spatial_grid.remove(best_pair.b);
        spatial_grid.add(merged);
    }

    std::cout << histogram.size() << ", " << operations.size() << "\n";

    for (int i = 0; i < length; ++i) {
        output[i] = 255 - input[i];  // You can change this logic
    }
    
    return output;
}

}