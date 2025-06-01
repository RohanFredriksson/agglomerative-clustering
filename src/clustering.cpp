// Average Hierarchical Agglomerative Color Clustering
#include "clustering.hpp"
#include <emscripten.h>

inline void hash_combine(std::size_t& seed, std::size_t value) {
    seed ^= value + 0x9e3779b9 + (seed << 6) + (seed >> 2);
}

#include <iostream>

class Color {

public:

    uint8_t r;
    uint8_t g;
    uint8_t b;

    Color(uint8_t r, uint8_t g, uint8_t b) {
        this->r = r;
        this->g = g;
        this->b = b;
    }

    bool operator==(const Color& other) const {
        return (r == other.r) &&
               (g == other.g) &&
               (b == other.b);
    }

};

namespace std {
    template <>
    struct hash<Color> {
        std::size_t operator()(const Color& c) const noexcept {
            std::size_t seed = 0;
            hash_combine(seed, c.r);
            hash_combine(seed, c.g);
            hash_combine(seed, c.b);
            return seed;
        }
    };
}

inline uint16_t uint8_to_uint16(uint8_t value) {
    return (uint16_t(value) * std::numeric_limits<uint16_t>::max()) / std::numeric_limits<uint8_t>::max();
}

inline uint8_t uint16_to_uint8(uint16_t value) {
    return static_cast<uint8_t>((static_cast<uint32_t>(value) * std::numeric_limits<uint8_t>::max() + (std::numeric_limits<uint16_t>::max() / 2)) / std::numeric_limits<uint16_t>::max());
}

uint8_t* pack_variable_size(std::vector<uint8_t> vector) {
    uint8_t* output = (uint8_t*) std::malloc(4 + vector.size());
    output[0] = (vector.size() >> 0) & 0xFF;
    output[1] = (vector.size() >> 8) & 0xFF;
    output[2] = (vector.size() >> 16) & 0xFF;
    output[3] = (vector.size() >> 24) & 0xFF;
    std::memcpy(output + 4, vector.data(), vector.size() * sizeof(uint8_t));
    return output;
}

std::vector<uint8_t> _get_clustering(uint8_t* image_data, int image_length, int image_format) {

    std::vector<uint8_t> clustering;
    AgglomerativeClustering::CoarseningGrid grid(5u);
    AgglomerativeClustering::AgglomerativeHistogram histogram;

    int limit = image_format == 1 ? image_length - 2 : image_length - 3;
    int increment = image_format == 1 ? 3 : 4;

    for (int i = 0; i < limit; i += increment) {
        std::array<uint16_t, 3> color = {uint8_to_uint16(image_data[i]), uint8_to_uint16(image_data[i+1]), uint8_to_uint16(image_data[i+2])};
        if (histogram.count(color)) {
            grid.add(color);
        }
        
    }

    size_t clustering_size = 3 + 9 * (histogram.size() - 1);
    clustering.reserve(clustering_size);
    clustering.resize(clustering_size);

    for (int i = histogram.size() - 2; i >= 0; i--) {

        std::optional<std::pair<std::array<uint16_t, 3>, std::array<uint16_t, 3>>> result = grid.get_nearest();
        if (!result.has_value()) {break;}
        
        auto [a, b] = result.value();
        std::array<uint16_t, 3> m = histogram.merge(a, b);
        grid.remove(a);
        grid.remove(b);
        grid.add(m);
        
        // Add the clustering operation
        size_t offset = 3 + 9 * i;
        clustering[offset + 0] = uint16_to_uint8(m[0]);
        clustering[offset + 1] = uint16_to_uint8(m[1]);
        clustering[offset + 2] = uint16_to_uint8(m[2]);
        clustering[offset + 3] = uint16_to_uint8(a[0]);
        clustering[offset + 4] = uint16_to_uint8(a[1]);
        clustering[offset + 5] = uint16_to_uint8(a[2]);
        clustering[offset + 6] = uint16_to_uint8(b[0]);
        clustering[offset + 7] = uint16_to_uint8(b[1]);
        clustering[offset + 8] = uint16_to_uint8(b[2]);

    }

    // Add the k=1 clustering colour
    std::array<uint16_t, 3> last = histogram.last();
    clustering[0] = uint16_to_uint8(last[0]);
    clustering[1] = uint16_to_uint8(last[1]);
    clustering[2] = uint16_to_uint8(last[2]);
    return clustering;

}

std::vector<uint8_t> _get_palette_from_clustering(std::vector<uint8_t> clustering, int k) {
     
    std::vector<uint8_t> palette;
    if (clustering.size() < 3 || k < 1) {return palette;}

    int merges = (clustering.size() - 3) / 9;
    k = std::min(k - 1, merges);
    std::unordered_set<Color> colors;
    colors.insert(Color(clustering[0], clustering[1], clustering[2]));

    for (int i = 0; i < k; i++) {
        colors.erase(Color(clustering[3+i*9], clustering[4+i*9], clustering[5+i*9]));
        colors.insert(Color(clustering[6+i*9], clustering[7+i*9], clustering[8+i*9]));
        colors.insert(Color(clustering[9+i*9], clustering[10+i*9], clustering[11+i*9]));
    }

    palette.reserve(colors.size());
    for (Color color : colors) {
        palette.push_back(color.r);
        palette.push_back(color.g);
        palette.push_back(color.b);
    }
    
    return palette;
    
}

uint8_t* _quantize(uint8_t* image_data, int image_length, int image_format, std::vector<uint8_t> palette) {
    return nullptr;
}

extern "C" {

EMSCRIPTEN_KEEPALIVE
uint8_t* get_clustering(uint8_t* image_data, int image_length, int image_format) {
    std::vector<uint8_t> clustering = _get_clustering(image_data, image_length, image_format);
    return pack_variable_size(clustering);
}

EMSCRIPTEN_KEEPALIVE
uint8_t* get_palette(uint8_t* image_data, int image_length, int image_format, int k) {
    std::vector<uint8_t> clustering = _get_clustering(image_data, image_length, image_format);
    std::vector<uint8_t> palette = _get_palette_from_clustering(clustering, k);
    return pack_variable_size(palette);
}

EMSCRIPTEN_KEEPALIVE
uint8_t* get_palette_from_clustering(uint8_t* clustering_data, int clustering_length, int k) {
    std::vector<uint8_t> clustering;
    clustering.resize(clustering_length);
    std::memcpy(clustering.data(), clustering_data, clustering_length);
    std::vector<uint8_t> palette = _get_palette_from_clustering(clustering, k);
    return pack_variable_size(palette);
}

EMSCRIPTEN_KEEPALIVE
uint8_t* quantize(uint8_t* image_data, int image_length, int image_format, int k) {
    std::vector<uint8_t> clustering = _get_clustering(image_data, image_length, image_format);
    std::vector<uint8_t> palette = _get_palette_from_clustering(clustering, k);
    return _quantize(image_data, image_length, image_format, palette);
}

EMSCRIPTEN_KEEPALIVE
uint8_t* quantize_with_clustering(uint8_t* image_data, int image_length, int image_format, uint8_t* clustering_data, int clustering_length, int k) {
    std::vector<uint8_t> clustering;
    clustering.resize(clustering_length);
    std::memcpy(clustering.data(), clustering_data, clustering_length);
    std::vector<uint8_t> palette = _get_palette_from_clustering(clustering, k);
    return _quantize(image_data, image_length, image_format, palette);
}

EMSCRIPTEN_KEEPALIVE
uint8_t* quantize_with_palette(uint8_t* image_data, int image_length, int image_format, uint8_t* palette_data, int palette_length) {
    std::vector<uint8_t> palette;
    palette.resize(palette_length);
    std::memcpy(palette.data(), palette_data, palette_length);
    return _quantize(image_data, image_length, image_format, palette);
}

EMSCRIPTEN_KEEPALIVE
uint8_t* process(uint8_t* input, int length) {
    uint8_t* output = (uint8_t*) malloc(length);
    std::vector<uint8_t> clustering = _get_clustering(input, length, 1);
    return output;
}

}