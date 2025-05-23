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

};

class Bucket {

private:

    Vector3 location;
    std::unordered_set<Vector3> points;
    Pair best;

public:

    Bucket(Vector3 location) : location(location) {

    }

    bool operator<(const Bucket other) const {
        if (best.initialised && !other.best.initialised) {return true;}
        if (!best.initialised && other.best.initialised) {return false;}
        return best.distance < other.best.distance;
    }

};

class CourseningGrid {

public:

    uint16_t resolution;        
    std::unordered_map<Vector3, Bucket> grid;
    std::set<Bucket> cache;

    CourseningGrid(uint16_t resolution) {
        this->resolution = resolution;
    }

    void add(Vector3 point) {

        uint16_t grid_size = std::numeric_limits<uint16_t>::max() / this->resolution;


    }

    void remove(Vector3 point) {

    }
    
    /*
    std::tuple<std::tuple<uint16_t, uint16_t, uint16_t>, std::tuple<uint16_t, uint16_t, uint16_t>> get_nearest() {

        



        return std::make_tuple(std::make_tuple(8u, 8u, 8u), std::make_tuple(8u, 8u, 8u));
    }
    */

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