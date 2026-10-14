// Hierarchical Agglomerative Color Clustering (Ward's method)
#include "clustering.hpp"
#include "colorspace.hpp"
#include <emscripten.h>
#include <cstdlib>
#include <cstring>
#include <vector>
#include <cmath>

using AgglomerativeClustering::ColorSpace;
using AgglomerativeClustering::ColorCoordinates;

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

// Writes 16-bit clustering coordinates as an 8-bit sRGB colour.
void write_color(std::vector<uint8_t>& clustering, size_t offset, const ColorCoordinates& space, const std::array<uint16_t, 3>& coords) {
    std::array<uint8_t, 3> rgb = space.to_rgb(coords);
    for (int c = 0; c < 3; c++) {clustering[offset + c] = rgb[c];}
}

// Writes merge record i: [merged rgb, a rgb, b rgb], converted to 8-bit sRGB.
void write_record(std::vector<uint8_t>& clustering, int i, const ColorCoordinates& space, const std::array<uint16_t, 3>& m, const std::array<uint16_t, 3>& a, const std::array<uint16_t, 3>& b) {
    size_t offset = 3 + 9 * i;
    write_color(clustering, offset, space, m);
    write_color(clustering, offset + 3, space, a);
    write_color(clustering, offset + 6, space, b);
}

// Clusters the image's colours in `color_space`. With `precision` below 8, colours are first grouped by the
// top `precision` bits of each channel, and each group enters the clustering as one cluster at the
// count-weighted mean of its colours: at most 2^(3 * precision) clusters, so time is bounded on images with
// very many distinct colours, while the means keep the palette close to exact.
std::vector<uint8_t> _get_clustering(uint8_t* image_data, int image_length, int image_format, ColorSpace color_space, int precision) {

    std::vector<uint8_t> clustering;
    AgglomerativeClustering::AgglomerativeHistogram histogram;
    const ColorCoordinates space(color_space);

    int limit = image_format == 1 ? image_length - 2 : image_length - 3;
    int increment = image_format == 1 ? 3 : 4;

    // Pass 1: build histogram and collect unique colours
    for (int i = 0; i < limit; i += increment) {
        histogram.add((uint32_t(image_data[i]) << 16) | (uint32_t(image_data[i+1]) << 8) | uint32_t(image_data[i+2]));
    }

    std::vector<std::array<uint16_t, 3>> unique_colors;
    std::vector<uint32_t> unique_counts;
    unique_colors.reserve(histogram.size());
    for (uint32_t key : histogram.colors()) {
        unique_colors.push_back(space.cluster(uint8_t(key >> 16), uint8_t(key >> 8), uint8_t(key)));
    }
    unique_counts = histogram.counts();

    if (precision < 8) {
        const uint32_t channel = (0xFFu << (8 - precision)) & 0xFFu;
        const uint32_t mask = (channel << 16) | (channel << 8) | channel;
        AgglomerativeClustering::AgglomerativeHistogram bins;
        std::vector<std::array<uint64_t, 3>> sums;
        for (size_t i = 0; i < unique_colors.size(); i++) {
            uint32_t bin = bins.add(histogram.colors()[i] & mask, unique_counts[i]);
            if (bin == sums.size()) {sums.push_back({0u, 0u, 0u});}
            for (int c = 0; c < 3; c++) {sums[bin][c] += uint64_t(unique_colors[i][c]) * unique_counts[i];}
        }
        unique_colors.resize(bins.size());
        unique_counts = bins.counts();
        for (size_t b = 0; b < bins.size(); b++) {
            for (int c = 0; c < 3; c++) {unique_colors[b][c] = uint16_t(sums[b][c] / unique_counts[b]);}
        }
    }

    size_t n = unique_colors.size();
    clustering.resize(3 + 9 * (n - 1));

    // Pass 2: one cluster per unique colour
    AgglomerativeClustering::WardGrid grid(n);
    for (size_t i = 0; i < n; i++) {grid.add(unique_colors[i], unique_counts[i]);}
    grid.reindex();

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
        grid.reindex();

    }

    std::stable_sort(merges.begin(), merges.end(), [](const Merge& x, const Merge& y) {return x.height < y.height;});
    for (size_t j = 0; j < merges.size(); j++) {
        write_record(clustering, int(merges.size() - 1 - j), space, merges[j].merged, merges[j].a, merges[j].b);
    }

    // Add the k=1 clustering colour
    write_color(clustering, 0, space, merges.empty() ? unique_colors[0] : merges.back().merged);
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

// Maps each pixel to its nearest palette colour, matching in `color_space`. With `dither` > 0 the
// remaining error is diffused to neighbouring pixels (serpentine Floyd-Steinberg, scaled by `dither`), which
// needs the image's `width`. Returns a length-prefixed buffer (see allocate_variable_size) so the output is
// written once, in place.
uint8_t* _quantize(const uint8_t* image_data, int image_length, int image_format, const uint8_t* palette, size_t palette_length, ColorSpace color_space, double dither, int width) {

    const ColorCoordinates space(color_space);
    std::vector<std::array<uint8_t, 3>> colors;
    std::vector<AgglomerativeClustering::KDTree::Point> points;
    colors.reserve(palette_length / 3);
    points.reserve(palette_length / 3);

    for (size_t i = 0; i + 2 < palette_length; i += 3) {
        colors.push_back({palette[i], palette[i+1], palette[i+2]});
        points.push_back(space.match(palette[i], palette[i+1], palette[i+2]));
    }

    AgglomerativeClustering::KDTree tree;
    tree.build(points);

    int increment = image_format == 1 ? 3 : 4;
    size_t pixels = image_length > 0 ? static_cast<size_t>(image_length) / increment : 0;
    uint8_t* packed = allocate_variable_size(pixels * increment);
    uint8_t* output = packed + 4;

    // A direct-mapped memo of recent lookups: photos repeat colours, neighbouring pixels most of all, so most
    // pixels skip the tree. A colour always maps to the same palette entry, so the output is unchanged.
    constexpr int memo_bits = 14;
    std::vector<uint32_t> memo_keys(size_t(1) << memo_bits, std::numeric_limits<uint32_t>::max());
    std::vector<int32_t> memo_values(size_t(1) << memo_bits);
    const std::array<uint8_t, 3> black = {0u, 0u, 0u};
    auto nearest_index = [&](uint8_t r, uint8_t g, uint8_t b) {
        uint32_t key = (uint32_t(r) << 16) | (uint32_t(g) << 8) | uint32_t(b);
        uint32_t slot = (key * 0x9E3779B1u) >> (32 - memo_bits);
        if (memo_keys[slot] != key) {
            memo_keys[slot] = key;
            memo_values[slot] = tree.get_nearest(space.match(r, g, b));
        }
        return memo_values[slot];
    };
    auto nearest = [&](uint8_t r, uint8_t g, uint8_t b) -> const std::array<uint8_t, 3>& {
        int32_t index = nearest_index(r, g, b);
        return index < 0 ? black : colors[index];
    };

    if (dither <= 0.0 || width <= 0 || pixels % size_t(width) != 0 || colors.empty()) {
        for (size_t p = 0; p < pixels; p++) {
            const uint8_t* pixel = image_data + p * increment;
            uint8_t* out = output + p * increment;
            const std::array<uint8_t, 3>& chosen = nearest(pixel[0], pixel[1], pixel[2]);
            out[0] = chosen[0];
            out[1] = chosen[1];
            out[2] = chosen[2];
            if (image_format == 0) {out[3] = pixel[3];}
        }
        return packed;
    }

    // Error for the current and next rows, one pixel of padding on each side so neighbours need no checks.
    const size_t height = pixels / size_t(width);
    std::vector<float> current(3 * (size_t(width) + 2), 0.0f), next(3 * (size_t(width) + 2), 0.0f);
    const float strength = float(std::min(dither, 1.0));
    const float limit = color_space == ColorSpace::rgb ? 255.0f : 65535.0f;

    for (size_t y = 0; y < height; y++) {
        const bool forward = y % 2 == 0;
        for (size_t i = 0; i < size_t(width); i++) {
            const size_t x = forward ? i : size_t(width) - 1 - i;
            const size_t p = y * size_t(width) + x;
            const uint8_t* pixel = image_data + p * increment;
            uint8_t* out = output + p * increment;
            if (image_format == 0) {out[3] = pixel[3];}
            float* e = &current[3 * (x + 1)];
            // Fully transparent pixels neither take error nor pass any on: their colour isn't seen.
            if (image_format == 0 && pixel[3] == 0) {
                const std::array<uint8_t, 3>& chosen = nearest(pixel[0], pixel[1], pixel[2]);
                for (int c = 0; c < 3; c++) {out[c] = chosen[c]; e[c] = 0.0f;}
                continue;
            }
            // Error is carried in the matching coordinates (8-bit RGB values, or OKLab), so the colour chosen
            // is the one that best cancels it; mixing spaces lets error pile up into streaks.
            const AgglomerativeClustering::KDTree::Point base = space.match(pixel[0], pixel[1], pixel[2]);
            float wanted[3];
            AgglomerativeClustering::KDTree::Point target;
            for (int c = 0; c < 3; c++) {
                wanted[c] = std::clamp(float(base[c]) + e[c], 0.0f, limit);
                target[c] = uint16_t(std::lround(wanted[c]));
                e[c] = 0.0f;
            }
            const int32_t index = color_space == ColorSpace::rgb ? nearest_index(uint8_t(target[0]), uint8_t(target[1]), uint8_t(target[2])) : tree.get_nearest(target);
            const std::array<uint8_t, 3>& chosen = colors[index];
            const ptrdiff_t ahead = forward ? 3 : -3;
            float* below = &next[3 * (x + 1)];
            for (int c = 0; c < 3; c++) {
                out[c] = chosen[c];
                float error = (wanted[c] - float(points[index][c])) * strength;
                e[c + ahead] += error * (7.0f / 16.0f);
                below[c - ahead] += error * (3.0f / 16.0f);
                below[c] += error * (5.0f / 16.0f);
                below[c + ahead] += error * (1.0f / 16.0f);
            }
        }
        std::swap(current, next);
        std::fill(next.begin(), next.end(), 0.0f);
    }

    return packed;

}

extern "C" {

EMSCRIPTEN_KEEPALIVE
uint8_t* get_clustering(uint8_t* image_data, int image_length, int image_format, int color_space, int precision) {
    std::vector<uint8_t> clustering = _get_clustering(image_data, image_length, image_format, ColorSpace(color_space), precision);
    return pack_variable_size(clustering);
}

EMSCRIPTEN_KEEPALIVE
uint8_t* get_palette(uint8_t* image_data, int image_length, int image_format, int k, int color_space, int precision) {
    std::vector<uint8_t> clustering = _get_clustering(image_data, image_length, image_format, ColorSpace(color_space), precision);
    std::vector<uint8_t> palette = _get_palette_from_clustering(clustering.data(), clustering.size(), k);
    return pack_variable_size(palette);
}

EMSCRIPTEN_KEEPALIVE
uint8_t* get_palette_from_clustering(uint8_t* clustering_data, int clustering_length, int k) {
    std::vector<uint8_t> palette = _get_palette_from_clustering(clustering_data, clustering_length, k);
    return pack_variable_size(palette);
}

EMSCRIPTEN_KEEPALIVE
uint8_t* quantize(uint8_t* image_data, int image_length, int image_format, int k, int color_space, int precision, double dither, int width) {
    std::vector<uint8_t> clustering = _get_clustering(image_data, image_length, image_format, ColorSpace(color_space), precision);
    std::vector<uint8_t> palette = _get_palette_from_clustering(clustering.data(), clustering.size(), k);
    return _quantize(image_data, image_length, image_format, palette.data(), palette.size(), ColorSpace(color_space), dither, width);
}

EMSCRIPTEN_KEEPALIVE
uint8_t* quantize_with_clustering(uint8_t* image_data, int image_length, int image_format, uint8_t* clustering_data, int clustering_length, int k, int color_space, double dither, int width) {
    std::vector<uint8_t> palette = _get_palette_from_clustering(clustering_data, clustering_length, k);
    return _quantize(image_data, image_length, image_format, palette.data(), palette.size(), ColorSpace(color_space), dither, width);
}

EMSCRIPTEN_KEEPALIVE
uint8_t* quantize_with_palette(uint8_t* image_data, int image_length, int image_format, uint8_t* palette_data, int palette_length, int color_space, double dither, int width) {
    return _quantize(image_data, image_length, image_format, palette_data, palette_length, ColorSpace(color_space), dither, width);
}

}