// Average Hierarchical Agglomerative Color Clustering
#include <set>
#include <cstdint>
#include <cstdlib>
#include <emscripten.h>
#include <unordered_map>
#include <unordered_set>

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
    uint64_t distance;
    bool initialised = false;

    Pair() {

    }

    Pair(Vector3 a, Vector3 b) {
    
        this->a = a;
        this->b = b;

        uint64_t dx = a.x > b.x ? (uint64_t)(a.x - b.x) : (uint64_t)(b.x - a.x);
        uint64_t dy = a.y > b.y ? (uint64_t)(a.y - b.y) : (uint64_t)(b.y - a.y);
        uint64_t dz = a.z > b.z ? (uint64_t)(a.z - b.z) : (uint64_t)(b.z - a.z);

        this->distance = dx * dx + dy * dy + dz * dz;
        this->initialised = true;

    }

    bool operator<(const Pair& other) const {
        if (initialised && !other.initialised) {return true;}
        if (!initialised && other.initialised) {return false;}
        return distance < other.distance;
    }

    bool contains(Vector3 vector) {
        return this->a == vector || this->b == vector;\
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
        return lhs->best < rhs->best;
    }
};

class SpatialGrid {

public:

    uint16_t resolution;        
    std::unordered_map<Vector3, Bucket*> grid;
    std::set<Bucket*, BucketComparator> cache;

    SpatialGrid(uint16_t resolution) {
        this->resolution = resolution;
    }

    ~SpatialGrid() {
        for (const auto& pair : this->grid) {
            delete pair.second;
        }
    }

    void add(Vector3 point) {

        uint16_t grid_size = std::numeric_limits<uint16_t>::max() / (1u << this->resolution);
        uint16_t x = point.x / grid_size;
        uint16_t y = point.y / grid_size;
        uint16_t z = point.z / grid_size;
        Vector3 location(x, y, z);
        
        // If we don't have the required bucket, allocate one.
        if (this->grid.find(location) == this->grid.end()) {
            this->grid[location] = new Bucket(location);
        }

        // If we already have this point, don't add it.
        else if (this->grid[location]->points.find(point) != this->grid[location]->points.end()) {
            return;
        }

        // Find all neighbour buckets and compute new possible nearest neighbour pairings.
        Vector3 min = location;
        if (min.x > 0u) {min.x--;}
        if (min.y > 0u) {min.y--;}
        if (min.z > 0u) {min.z--;}

        Vector3 max = location;
        if (max.x < grid_size - 1u) {max.x++;}
        if (max.y < grid_size - 1u) {max.y++;}
        if (max.z < grid_size - 1u) {max.z++;}

        for (uint16_t x = min.x; x <= max.x; x++) {
            for (uint16_t y = min.y; y < max.y; y++) {
                for (uint16_t z = min.z; z < max.z; z++) {

                    Vector3 bucket_position = Vector3(x, y, z);
                    if (this->grid.find(bucket_position) == this->grid.end()) {continue;}
                    Bucket* bucket = this->grid[bucket_position];
                    bool recache = false;

                    for (const Vector3& current_point : bucket->points) {
                        Pair pair(current_point, point);
                        if (!(pair < bucket->best)) {continue;}
                        bucket->best = pair;
                        recache = true;
                    }

                    if (!recache) {continue;}
                    cache.erase(bucket);
                    cache.insert(bucket);

                }
            }
        }

        // Insert into the bucket
        this->grid[location]->points.insert(point);

    }

    void remove(Vector3 point) {

        uint16_t grid_size = std::numeric_limits<uint16_t>::max() / (1u << this->resolution);
        uint16_t x = point.x / grid_size;
        uint16_t y = point.y / grid_size;
        uint16_t z = point.z / grid_size;
        Vector3 location(x, y, z);

        // We can't remove a point if there is no bucket for it.
        if (this->grid.find(location) == this->grid.end()) {return;}
        Bucket* bucket = this->grid[location];

        // If the point isn't in the bucket, we can't remove it.
        if (bucket->points.find(point) == bucket->points.end()) {return;}
        this->grid[location]->points.erase(point);

        // If the bucket is empty delete the bucket.
        if (bucket->points.size() == 0) {
            this->grid.erase(location);
            delete bucket;
        }

        // Find all neighbour buckets and see if we have to compute nearest neighbour pairings.
        Vector3 min = location;
        if (min.x > 0u) {min.x--;}
        if (min.y > 0u) {min.y--;}
        if (min.z > 0u) {min.z--;}

        Vector3 max = location;
        if (max.x < grid_size - 1u) {max.x++;}
        if (max.y < grid_size - 1u) {max.y++;}
        if (max.z < grid_size - 1u) {max.z++;}

        for (uint16_t x = min.x; x <= max.x; x++) {
            for (uint16_t y = min.y; y < max.y; y++) {
                for (uint16_t z = min.z; z < max.z; z++) {

                    Vector3 bucket_position = Vector3(x, y, z);
                    if (this->grid.find(bucket_position) == this->grid.end()) {continue;}
                    bucket = this->grid[bucket_position];

                    if (!bucket->best.contains(point)) {continue;}
                    bucket->best = Pair();

                    for (const Vector3& current_point : bucket->points) {
                        Pair pair(current_point, point);
                        if (!(pair < bucket->best)) {continue;}
                        bucket->best = pair;
                    }

                    cache.erase(bucket);
                    cache.insert(bucket);

                }
            }
        }

    }
    
    Pair get_nearest() {
        if (this->cache.size() == 0) {return Pair();}
        return (*this->cache.begin())->best;
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

EMSCRIPTEN_KEEPALIVE
uint8_t* process(uint8_t* input, int length) {
    
    uint8_t* output = (uint8_t*) malloc(length);

    std::unordered_map<Vector3, uint16_t> histogram;
    SpatialGrid spatial_grid(5u);

    for (int i = 0; i < length / 3; i += 3) {

        Vector3 color(uint8_to_uint16(input[i]), uint8_to_uint16(input[i+1]), uint8_to_uint16(input[i+2]));
        auto search = histogram.find(color);

        // If we already have this point, increment the histogram
        if (search != histogram.end()) {
            histogram[color] = histogram[color] + 1u;
            continue;
        }

        histogram[color] = 1u;

    }

    for (int i = 0; i < length; ++i) {
        output[i] = 255 - input[i];  // You can change this logic
    }
    
    return output;
}

}