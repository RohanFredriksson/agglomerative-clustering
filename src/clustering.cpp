// Average Hierarchical Agglomerative Color Clustering
#include <tuple>
#include <vector>
#include <cstdint>
#include <cstdlib>
#include <emscripten.h>
#include <unordered_map>
#include <unordered_set>

extern "C" {

inline void hash_combine(std::size_t& seed, std::size_t value) {
    seed ^= value + 0x9e3779b9 + (seed << 6) + (seed >> 2);
}

struct hash {
    std::size_t operator()(const std::tuple<uint32_t, uint32_t, uint32_t>& t) const noexcept {
        std::size_t seed = 0;
        hash_combine(seed, std::hash<uint32_t>{}(std::get<0>(t)));
        hash_combine(seed, std::hash<uint32_t>{}(std::get<1>(t)));
        hash_combine(seed, std::hash<uint32_t>{}(std::get<2>(t)));
        return seed;
    }
};

struct equal {
    bool operator()(const std::tuple<uint32_t, uint32_t, uint32_t>& lhs, const std::tuple<uint32_t, uint32_t, uint32_t>& rhs) const {
        return (std::get<0>(lhs) == std::get<0>(rhs)) &&
               (std::get<1>(lhs) == std::get<1>(rhs)) &&
               (std::get<2>(lhs) == std::get<2>(rhs));
    }
};

class CourseningGrid {

    private:

        std::unordered_map<std::tuple<uint32_t, uint32_t, uint32_t>, std::unordered_set<std::tuple<uint32_t, uint32_t, uint32_t>, hash, equal>, hash, equal> grid;

    public:

        CourseningGrid(int resolution) {

        }

        void add(std::tuple<uint32_t, uint32_t, uint32_t> point) {

        }

        void remove(std::tuple<uint32_t, uint32_t, uint32_t> point) {

        }

        std::tuple<std::tuple<uint32_t, uint32_t, uint32_t>, std::tuple<uint32_t, uint32_t, uint32_t>> get_nearest() {

            



            return std::make_tuple(std::make_tuple(8u, 8u, 8u), std::make_tuple(8u, 8u, 8u));
        }

};

inline uint32_t uint8_to_uint32(uint8_t value) {
    return (uint32_t(value) * std::numeric_limits<uint32_t>::max()) / std::numeric_limits<uint8_t>::max();
}

inline uint8_t uint32_to_uint8(uint32_t value) {
    return (uint8_t)((uint64_t(value) * std::numeric_limits<uint8_t>::max()) / std::numeric_limits<uint32_t>::max());
}

EMSCRIPTEN_KEEPALIVE
uint8_t* process(uint8_t* input, int length) {
    
    uint8_t* output = (uint8_t*) malloc(length);

    std::unordered_map<std::tuple<uint32_t, uint32_t, uint32_t>, int, hash, equal> map;
    for (int i = 0; i < length / 3; i += 3) {

        uint32_t r = uint8_to_uint32(input[i]);
        uint32_t g = uint8_to_uint32(input[i+1]);
        uint32_t b = uint8_to_uint32(input[i+2]);

        auto key = std::make_tuple(r, g, b);
        auto search = map.find(key);

        // If we already have this point, increment the histogram
        if (search != map.end()) {
            map[key] = map[key] + 1;
            continue;
        }

        map[key] = 1;

    }


    

    for (int i = 0; i < length; ++i) {
        output[i] = 255 - input[i];  // You can change this logic
    }
    
    return output;
}

}