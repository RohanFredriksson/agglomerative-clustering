// Average Hierarchical Agglomerative Color Clustering
#include <map>
#include <vector>
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

    uint32_t x;
    uint32_t y;
    uint32_t z;

    Vector3(uint32_t x, uint32_t y, int32_t z) {
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

class Bucket {

public:
    Vector3 location;
    std::unordered_set<Vector3> points;

};


class CourseningGrid {

    private:

        uint32_t resolution;        
        std::unordered_map<Vector3, Bucket> grid;

    public:

        CourseningGrid(uint32_t resolution) {
            this->resolution = resolution;
        }

        void add(Vector3 point) {

            uint32_t grid_size = std::numeric_limits<uint32_t>::max() / this->resolution;


        }

        void remove(Vector3 point) {

        }
        
        /*
        std::tuple<std::tuple<uint32_t, uint32_t, uint32_t>, std::tuple<uint32_t, uint32_t, uint32_t>> get_nearest() {

            



            return std::make_tuple(std::make_tuple(8u, 8u, 8u), std::make_tuple(8u, 8u, 8u));
        }
        */

};

inline uint32_t uint8_to_uint32(uint8_t value) {
    return (uint32_t(value) * std::numeric_limits<uint32_t>::max()) / std::numeric_limits<uint8_t>::max();
}

inline uint8_t uint32_to_uint8(uint32_t value) {
    return (uint8_t)((uint64_t(value) * std::numeric_limits<uint8_t>::max()) / std::numeric_limits<uint32_t>::max());
}

extern "C" {

EMSCRIPTEN_KEEPALIVE
uint8_t* process(uint8_t* input, int length) {
    
    uint8_t* output = (uint8_t*) malloc(length);

    std::unordered_map<Vector3, uint32_t> histogram;

    for (int i = 0; i < length / 3; i += 3) {

        Vector3 color(uint8_to_uint32(input[i]), uint8_to_uint32(input[i+1]), uint8_to_uint32(input[i+2]));
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