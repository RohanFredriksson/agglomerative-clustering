// Hierarchical Agglomerative Color Clustering (Ward's method)
#include "clustering.hpp"
#include <emscripten.h>
#include <cstdlib>
#include <cstring>
#include <vector>
#include <cmath>

inline uint16_t uint8_to_uint16(uint8_t value) {
    return (uint16_t(value) * std::numeric_limits<uint16_t>::max()) / std::numeric_limits<uint8_t>::max();
}

inline uint8_t uint16_to_uint8(uint16_t value) {
    return static_cast<uint8_t>((static_cast<uint32_t>(value) * std::numeric_limits<uint8_t>::max() + (std::numeric_limits<uint16_t>::max() / 2)) / std::numeric_limits<uint16_t>::max());
}

// Allocates a buffer with a 4-byte little-endian length prefix; returns the base pointer (payload starts at +4).
uint8_t* allocate_variable_size(size_t size) {
    uint8_t* output = (uint8_t*) std::malloc(4 + size);
    output[0] = (size >> 0) & 0xFF;
    output[1] = (size >> 8) & 0xFF;
    output[2] = (size >> 16) & 0xFF;
    output[3] = (size >> 24) & 0xFF;
    return output;
}

uint8_t* pack_variable_size(const std::vector<uint8_t>& vector) {
    uint8_t* output = allocate_variable_size(vector.size());
    std::memcpy(output + 4, vector.data(), vector.size() * sizeof(uint8_t));
    return output;
}

// Writes merge record i: [merged rgb, a rgb, b rgb], downscaled to 8 bits per channel.
void write_record(std::vector<uint8_t>& clustering, int i, const std::array<uint16_t, 3>& m, const std::array<uint16_t, 3>& a, const std::array<uint16_t, 3>& b) {
    size_t offset = 3 + 9 * i;
    const std::array<uint16_t, 3>* colors[3] = {&m, &a, &b};
    for (int j = 0; j < 3; j++) {
        for (int c = 0; c < 3; c++) {clustering[offset + 3 * j + c] = uint16_to_uint8((*colors[j])[c]);}
    }
}

std::vector<uint8_t> _get_clustering(uint8_t* image_data, int image_length, int image_format) {

    std::vector<uint8_t> clustering;
    AgglomerativeClustering::AgglomerativeHistogram histogram;

    int limit = image_format == 1 ? image_length - 2 : image_length - 3;
    int increment = image_format == 1 ? 3 : 4;

    // Pass 1: build histogram and collect unique colours
    std::vector<std::array<uint16_t, 3>> unique_colors;
    for (int i = 0; i < limit; i += increment) {
        std::array<uint16_t, 3> color = {uint8_to_uint16(image_data[i]), uint8_to_uint16(image_data[i+1]), uint8_to_uint16(image_data[i+2])};
        if (histogram.count(color)) {unique_colors.push_back(color);}
    }

    size_t n = unique_colors.size();
    clustering.resize(3 + 9 * (n - 1));

    // Pass 2: one cluster per unique colour
    AgglomerativeClustering::WardGrid grid(n);
    for (const std::array<uint16_t, 3>& color : unique_colors) {grid.add(color, histogram.get(color));}

    // Merges come out of the nearest-neighbour chain in chain order, not cost order. A merge's height is its
    // cost, raised to its children's heights where centroid rounding would put it below them, so sorting by
    // height keeps every merge after the merges that formed its clusters.
    struct Merge {
        double height;
        std::array<uint16_t, 3> merged, a, b;
    };
    std::vector<Merge> merges;
    merges.reserve(n - 1);
    std::vector<double> heights(2 * n, 0.0);

    // Ward's criterion is reducible, so merging mutual cheapest partners as the chain finds them gives the
    // same hierarchy as always merging the globally cheapest pair.
    std::vector<int32_t> chain;
    int32_t next_start = 0;
    while (grid.size() > 1) {

        if (chain.empty()) {
            while (!grid.is_alive(next_start)) {next_start++;}
            chain.push_back(next_start);
        }

        int32_t a = chain.back();
        int32_t b = grid.nearest(a);

        if (chain.size() < 2 || chain[chain.size() - 2] != b) {
            chain.push_back(b);
            continue;
        }

        chain.pop_back();
        chain.pop_back();

        uint32_t a_count = grid.count(a);
        uint32_t b_count = grid.count(b);
        uint32_t count = a_count + b_count;
        const std::array<uint16_t, 3>& ac = grid.coords(a);
        const std::array<uint16_t, 3>& bc = grid.coords(b);
        std::array<uint16_t, 3> merged = {
            static_cast<uint16_t>((uint64_t(ac[0]) * a_count + uint64_t(bc[0]) * b_count) / count),
            static_cast<uint16_t>((uint64_t(ac[1]) * a_count + uint64_t(bc[1]) * b_count) / count),
            static_cast<uint16_t>((uint64_t(ac[2]) * a_count + uint64_t(bc[2]) * b_count) / count)
        };

        double height = std::max({grid.cost(a, b), heights[a], heights[b]});
        merges.push_back({height, merged, ac, bc});
        grid.remove(a);
        grid.remove(b);
        int32_t m = grid.add(merged, count);
        heights[m] = height;
        grid.coarsen();

    }

    std::stable_sort(merges.begin(), merges.end(), [](const Merge& x, const Merge& y) {return x.height < y.height;});
    for (size_t j = 0; j < merges.size(); j++) {
        write_record(clustering, int(merges.size() - 1 - j), merges[j].merged, merges[j].a, merges[j].b);
    }

    // Add the k=1 clustering colour
    std::array<uint16_t, 3> root = merges.empty() ? unique_colors[0] : merges.back().merged;
    clustering[0] = uint16_to_uint8(root[0]);
    clustering[1] = uint16_to_uint8(root[1]);
    clustering[2] = uint16_to_uint8(root[2]);
    return clustering;

}

std::vector<uint8_t> _get_palette_from_clustering(const uint8_t* clustering, size_t clustering_length, int k) {

    std::vector<uint8_t> palette;
    if (clustering_length < 3 || k < 1) {return palette;}

    struct ArrayHash {
        std::size_t operator()(const std::array<uint8_t, 3>& arr) const noexcept {
            uint32_t v = (uint32_t(arr[0]) << 16) | (uint32_t(arr[1]) << 8) | arr[2];
            return std::hash<uint32_t>{}(v);
        }
    };

    int merges = (clustering_length - 3) / 9;
    k = std::min(k - 1, merges);
    std::unordered_set<std::array<uint8_t, 3>, ArrayHash> colors;
    colors.insert({clustering[0], clustering[1], clustering[2]});

    for (int i = 0; i < k; i++) {
        colors.erase({clustering[3+i*9], clustering[4+i*9], clustering[5+i*9]});
        colors.insert({clustering[6+i*9], clustering[7+i*9], clustering[8+i*9]});
        colors.insert({clustering[9+i*9], clustering[10+i*9], clustering[11+i*9]});
    }

    palette.reserve(colors.size());
    for (std::array<uint8_t, 3> color : colors) {
        palette.push_back(color[0]);
        palette.push_back(color[1]);
        palette.push_back(color[2]);
    }

    return palette;    

}

// Returns a length-prefixed buffer (see allocate_variable_size) so the output is written once, in place.
uint8_t* _quantize(const uint8_t* image_data, int image_length, int image_format, const uint8_t* palette, size_t palette_length) {
    
    std::vector<std::array<uint8_t, 3>> colors;
    colors.reserve(palette_length / 3);

    for (size_t i = 0; i + 2 < palette_length; i += 3) {
        std::array<uint8_t, 3> color = {palette[i], palette[i+1], palette[i+2]};
        colors.push_back(color);
    }

    AgglomerativeClustering::KDTree tree;
    tree.build(colors);

    int increment = image_format == 1 ? 3 : 4;
    size_t pixels = image_length > 0 ? static_cast<size_t>(image_length) / increment : 0;
    uint8_t* packed = allocate_variable_size(pixels * increment);
    uint8_t* output = packed + 4;

    for (size_t p = 0; p < pixels; p++) {
        const uint8_t* pixel = image_data + p * increment;
        uint8_t* out = output + p * increment;
        std::array<uint8_t, 3> color = {pixel[0], pixel[1], pixel[2]};
        std::array<uint8_t, 3> nearest = tree.get_nearest(color);
        out[0] = nearest[0];
        out[1] = nearest[1];
        out[2] = nearest[2];
        if (image_format == 0) {out[3] = pixel[3];}
    }

    return packed;

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
    std::vector<uint8_t> palette = _get_palette_from_clustering(clustering.data(), clustering.size(), k);
    return pack_variable_size(palette);
}

EMSCRIPTEN_KEEPALIVE
uint8_t* get_palette_from_clustering(uint8_t* clustering_data, int clustering_length, int k) {
    std::vector<uint8_t> palette = _get_palette_from_clustering(clustering_data, clustering_length, k);
    return pack_variable_size(palette);
}

EMSCRIPTEN_KEEPALIVE
uint8_t* quantize(uint8_t* image_data, int image_length, int image_format, int k) {
    std::vector<uint8_t> clustering = _get_clustering(image_data, image_length, image_format);
    std::vector<uint8_t> palette = _get_palette_from_clustering(clustering.data(), clustering.size(), k);
    return _quantize(image_data, image_length, image_format, palette.data(), palette.size());
}

EMSCRIPTEN_KEEPALIVE
uint8_t* quantize_with_clustering(uint8_t* image_data, int image_length, int image_format, uint8_t* clustering_data, int clustering_length, int k) {
    std::vector<uint8_t> palette = _get_palette_from_clustering(clustering_data, clustering_length, k);
    return _quantize(image_data, image_length, image_format, palette.data(), palette.size());
}

EMSCRIPTEN_KEEPALIVE
uint8_t* quantize_with_palette(uint8_t* image_data, int image_length, int image_format, uint8_t* palette_data, int palette_length) {
    return _quantize(image_data, image_length, image_format, palette_data, palette_length);
}

}