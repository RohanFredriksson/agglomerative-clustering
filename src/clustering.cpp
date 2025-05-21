// Average Hierarchical Agglomerative Color Clustering
#include <tuple>
#include <cstdint>
#include <cstdlib>
#include <emscripten.h>
#include <unordered_map>

extern "C" {

inline uint16_t uint8_to_uint16(uint8_t value) {
    return (uint16_t(value) * std::numeric_limits<uint16_t>::max()) / std::numeric_limits<uint8_t>::max();
}

inline uint8_t uint16_to_uint8(uint16_t value) {
    return (uint8_t)((uint32_t(value) * std::numeric_limits<uint8_t>::max()) / std::numeric_limits<uint16_t>::max());
}

inline void hash_combine(std::size_t& seed, std::size_t value) {
    seed ^= value + 0x9e3779b9 + (seed << 6) + (seed >> 2);
}

struct hash {
    std::size_t operator()(const std::tuple<uint16_t, uint16_t, uint16_t>& t) const noexcept {
        std::size_t seed = 0;
        hash_combine(seed, std::hash<uint16_t>{}(std::get<0>(t)));
        hash_combine(seed, std::hash<uint16_t>{}(std::get<1>(t)));
        hash_combine(seed, std::hash<uint16_t>{}(std::get<2>(t)));
        return seed;
    }
};

struct equal {
    bool operator()(const std::tuple<uint16_t, uint16_t, uint16_t>& lhs, const std::tuple<uint16_t, uint16_t, uint16_t>& rhs) const {
        return (std::get<0>(lhs) == std::get<0>(rhs)) &&
               (std::get<1>(lhs) == std::get<1>(rhs)) &&
               (std::get<2>(lhs) == std::get<2>(rhs));
    }
};

EMSCRIPTEN_KEEPALIVE
uint8_t* process(uint8_t* input, int length) {
    
    uint8_t* output = (uint8_t*) malloc(length);

    std::unordered_map<std::tuple<uint16_t, uint16_t, uint16_t>, int, hash, equal> map;
    for (int i = 0; i < length / 3; i += 3) {

        uint16_t r = uint8_to_uint16(input[i]);
        uint16_t g = uint8_to_uint16(input[i+1]);
        uint16_t b = uint8_to_uint16(input[i+2]);

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