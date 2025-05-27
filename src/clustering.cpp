// Average Hierarchical Agglomerative Color Clustering
#include <set>
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
    uint16_t grid_size;
    std::unordered_map<Vector3, Bucket*> grid;
    std::set<Bucket*, BucketComparator> cache;

    SpatialGrid(uint16_t resolution) {
        this->resolution = resolution;
        this->grid_size = std::numeric_limits<uint16_t>::max() / (1u << this->resolution);
        std::cout << "GRID SIZE: " << this->grid_size << "\n";
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
        if (max.x < this->grid_size - 1u) {max.x++;}
        if (max.y < this->grid_size - 1u) {max.y++;}
        if (max.z < this->grid_size - 1u) {max.z++;}

        for (uint16_t x = min.x; x <= max.x; x++) {
            for (uint16_t y = min.y; y < max.y; y++) {
                for (uint16_t z = min.z; z < max.z; z++) {
                    Vector3 bucket_position = Vector3(x, y, z);
                    if (this->grid.find(bucket_position) == this->grid.end()) {continue;}
                    result.push_back(this->grid[bucket_position]);
                }
            }
        }

        return result;

    }

    std::vector<Vector3> get_local_points(Vector3 location) {

        size_t total_size; 
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

    void add(Vector3 point) {

        // If we don't have the required bucket, allocate one.
        Vector3 location = this->get_location(point);
        std::cout << "ADD LOCATION: " << location << "\n";
        if (this->grid.find(location) == this->grid.end()) {
            this->grid[location] = new Bucket(location);
        }

        // If we already have this point, don't add it.
        else if (this->grid[location]->points.find(point) != this->grid[location]->points.end()) {
            return;
        }

        std::cout << "\nADDED COLOUR " << point << "\n";

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

            if (!recache) {std::cout << bucket->location << " DOESN'T NEED AN ADD RECACHE\n"; continue;}
            std::cout << bucket->location << " NEEDS AN ADD RECACHE\n";
            cache.erase(bucket);
            bucket->best = best;
            cache.insert(bucket);

        }

        // Insert into the bucket
        this->grid[location]->points.insert(point);
        
    }

    void remove(Vector3 point) {

        // We can't remove a point if there is no bucket for it.
        Vector3 location = this->get_location(point);
        if (this->grid.find(location) == this->grid.end()) {std::cout << "CANNOT FIND BUCKET " << location << "\n"; return;}
        Bucket* bucket = this->grid[location];

        // If the point isn't in the bucket, we can't remove it.
        if (bucket->points.find(point) == bucket->points.end()) {std::cout << "CANNOT FIND COLOUR " << point << " IN " << location << "\n"; return;}
        this->grid[location]->points.erase(point);
        std::cout << "\nREMOVE COLOUR " << point << "\n";

        // If the bucket is empty delete the bucket.
        if (bucket->points.size() == 0) {
            this->grid.erase(location);
            this->cache.erase(bucket);
            delete bucket;
            std::cout << "REMOVE BUCKET" << location << "\n";
        }

        std::vector<Bucket*> buckets = this->get_local_buckets(location);
        for (Bucket* bucket : buckets) {

            // If the best point doesn't include the removed point we don't need to recache.
            if (!bucket->best.contains(point)) {std::cout << bucket->location << " DOESN'T NEED A REMOVE RECACHE\n"; continue;}
            this->cache.erase(bucket);
            bucket->best = Pair();
            std::cout << bucket->location << " NEEDS A REMOVE RECACHE\n";

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

            this->cache.insert(bucket);

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
    uint16_t current_resolution = 5u;
    SpatialGrid spatial_grid(current_resolution);

    for (int i = 0; i < length / 3; i += 3) {

        Vector3 color(uint8_to_uint16(input[i]), uint8_to_uint16(input[i+1]), uint8_to_uint16(input[i+2]));
        auto search = histogram.find(color);

        // If we already have this point, increment the histogram
        if (search != histogram.end()) {
            histogram[color] = histogram[color] + 1u;
            continue;
        }

        spatial_grid.add(color);
        histogram[color] = 1u;

    }

    while (current_resolution > 0u) {

        Pair best_pair = spatial_grid.get_nearest();
        
        // If there are no best pairs then, coursen the grid.
        if (!best_pair.initialised) {
            std::cout << spatial_grid.grid.size() << "\n";
            std::cout << spatial_grid.cache.size() << "\n";
            std::cout << "REBUILD\n\n\n\n\n\n\n\n";
            current_resolution = current_resolution - 1u;
            SpatialGrid new_grid(current_resolution);
            spatial_grid.copy(&new_grid);
            spatial_grid = new_grid;
            continue;
        }

        std::cout << "\nBEST PAIR IN " << (*spatial_grid.cache.begin())->location << "\n";
        std::cout << "A: " << best_pair.a << " " << spatial_grid.get_location(best_pair.a) << "\n";
        std::cout << "B: " << best_pair.b << " " << spatial_grid.get_location(best_pair.b) << "\n\n";

        // Merge the nearest points together.
        uint16_t a_count = histogram[best_pair.a];
        uint16_t b_count = histogram[best_pair.b];
        uint16_t merged_count = a_count + b_count;
        float a_ratio = (float) a_count / (float) merged_count;
        float b_ratio = (float) b_count / (float) merged_count;
        
        Vector3 merged(
            best_pair.a.x * a_ratio + best_pair.b.x * b_ratio,
            best_pair.a.y * a_ratio + best_pair.b.y * b_ratio,
            best_pair.a.z * a_ratio + best_pair.b.z * b_ratio
        );

        histogram.erase(best_pair.a);
        histogram.erase(best_pair.b);
        histogram[merged] = merged_count;

        std::cout << a_count << ", " << b_count << ", " << a_ratio << ", " << b_ratio << "\n";

        std::cout << "MERGED " << best_pair.a;
        std::cout << " AND " << best_pair.b;
        std::cout << " TO " << merged << "\n";

        spatial_grid.remove(best_pair.a);
        spatial_grid.remove(best_pair.b);
        spatial_grid.add(merged);

    }
    

    for (int i = 0; i < length; ++i) {
        output[i] = 255 - input[i];  // You can change this logic
    }
    
    return output;
}

}