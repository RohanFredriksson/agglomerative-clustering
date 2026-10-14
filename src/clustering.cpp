// Hierarchical Agglomerative Color Clustering (Ward's method)
#include "clustering.hpp"
#include "colorspace.hpp"
#include <emscripten.h>
#include <cstdlib>
#include <cstring>
#include <vector>
#include <cmath>
#include <unordered_map>

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

typedef std::array<uint8_t, 3> Rgb;

void write_color(std::vector<uint8_t>& clustering, size_t offset, const Rgb& rgb) {
    for (int c = 0; c < 3; c++) {clustering[offset + c] = rgb[c];}
}

// Clustering format version 2: a 4-byte header, then the root colour, then one 9-byte record per merge.
// The header is [clustering_magic, clustering_version, colour space, precision]. Version 1 (1.x) had no header,
// so its length is 3 more than a multiple of 9 (or 0), while version 2's is 7 more (or exactly 4 when empty).
constexpr uint8_t clustering_magic = 0xAC;
constexpr uint8_t clustering_version = 2;
constexpr size_t clustering_header = 4;

// Writes merge record i: [merged rgb, a rgb, b rgb]. `a` is the heavier child.
void write_record(std::vector<uint8_t>& clustering, int i, const Rgb& m, const Rgb& a, const Rgb& b) {
    size_t offset = clustering_header + 3 + 9 * i;
    write_color(clustering, offset, m);
    write_color(clustering, offset + 3, a);
    write_color(clustering, offset + 6, b);
}

// Clusters the image's colours in `color_space`. With `weight_alpha`, an RGBA pixel counts in proportion to its
// opacity, so fully transparent pixels drop out and Ward minimises the error that is actually visible. With
// `precision` below 8, colours are first grouped by the top `precision` bits of each channel, and each group
// enters the clustering as one cluster at the weighted mean of its colours: at most 2^(3 * precision) clusters,
// so time is bounded on images with very many distinct colours, while the means keep the palette close to exact.
std::vector<uint8_t> _get_clustering(uint8_t* image_data, int image_length, int image_format, ColorSpace color_space, int precision, bool weight_alpha) {

    std::vector<uint8_t> clustering = {clustering_magic, clustering_version, uint8_t(color_space), uint8_t(precision)};
    AgglomerativeClustering::AgglomerativeHistogram histogram;
    const ColorCoordinates space(color_space);

    int limit = image_format == 1 ? image_length - 2 : image_length - 3;
    int increment = image_format == 1 ? 3 : 4;
    weight_alpha = weight_alpha && image_format == 0;

    // Pass 1: build histogram and collect unique colours. Alpha weights are in units of 1/255 of a pixel.
    bool partial = false;
    for (int i = 0; i < limit; i += increment) {
        uint32_t key = (uint32_t(image_data[i]) << 16) | (uint32_t(image_data[i+1]) << 8) | uint32_t(image_data[i+2]);
        if (!weight_alpha) {histogram.add(key); continue;}
        uint8_t alpha = image_data[i+3];
        if (alpha == 0) {continue;}
        partial = partial || alpha != 255;
        histogram.add(key, alpha);
    }

    std::vector<std::array<uint16_t, 3>> unique_colors;
    std::vector<uint64_t> unique_counts = histogram.counts();
    unique_colors.reserve(histogram.size());
    for (uint32_t key : histogram.colors()) {
        unique_colors.push_back(space.cluster(uint8_t(key >> 16), uint8_t(key >> 8), uint8_t(key)));
    }

    // With no partly transparent pixels every weight is a whole number of pixels: count in pixels, so an opaque
    // image (or one with only fully transparent holes) clusters exactly as with alpha ignored.
    if (weight_alpha && !partial) {
        for (uint64_t& count : unique_counts) {count /= 255u;}
    }

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

    // An image with no visible pixels has no hierarchy: return just the header, which cuts to an empty palette.
    size_t n = unique_colors.size();
    if (n == 0) {return clustering;}
    clustering.resize(clustering_header + 3 + 9 * (n - 1));

    // The grid counts in 32 bits. Weights only exceed that for partly transparent images above ~16.8 MP; scale
    // those down by the smallest power of two that fits, keeping every visible colour at least 1.
    uint64_t total = 0;
    for (uint64_t count : unique_counts) {total += count;}
    int shift = 0;
    while ((total >> shift) > std::numeric_limits<uint32_t>::max() / 2u) {shift++;}

    // Pass 2: one cluster per unique colour
    AgglomerativeClustering::WardGrid grid(n);
    for (size_t i = 0; i < n; i++) {grid.add(unique_colors[i], uint32_t(std::max<uint64_t>(unique_counts[i] >> shift, 1u)));}
    grid.reindex();

    // Merges come out of the nearest-neighbour chain in chain order, not cost order. A merge's height is its
    // cost, raised to its children's heights where centroid rounding would put it below them, so sorting by
    // height keeps every merge after the merges that formed its clusters.
    struct Merge {
        double height;
        int32_t merged, a, b;
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
        // The cluster below `a` in the chain is a live partner, so its cost bounds the search.
        int32_t b = grid.nearest(a, chain.size() >= 2 ? chain[chain.size() - 2] : AgglomerativeClustering::WardGrid::none);

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
        grid.remove(a);
        grid.remove(b);
        int32_t m = grid.add(merged, count);
        heights[m] = height;
        // Heavier child first, so cutting the hierarchy knows which half of a split keeps the parent's place.
        if (b_count > a_count) {merges.push_back({height, m, b, a});} else {merges.push_back({height, m, a, b});}
        grid.reindex();

    }

    // Every cluster (dead ones keep their coordinates) is converted to 8-bit sRGB once: in OKLab that takes
    // three powers, and most clusters appear in two records.
    std::vector<Rgb> rgb(grid.capacity());
    for (int32_t id = 0; id < grid.capacity(); id++) {rgb[id] = space.to_rgb(grid.coords(id));}

    std::stable_sort(merges.begin(), merges.end(), [](const Merge& x, const Merge& y) {return x.height < y.height;});
    for (size_t j = 0; j < merges.size(); j++) {
        write_record(clustering, int(merges.size() - 1 - j), rgb[merges[j].merged], rgb[merges[j].a], rgb[merges[j].b]);
    }

    // Add the k=1 clustering colour
    write_color(clustering, clustering_header, rgb[merges.empty() ? 0 : merges.back().merged]);
    return clustering;

}

// A clustering in either format, located: `body` is the root colour followed by the merge records.
struct ClusteringView {
    bool valid = false;
    int version = 1;
    ColorSpace color_space = ColorSpace::rgb;
    bool empty = true;
    const uint8_t* body = nullptr;
    size_t merges = 0;
};

// Version 2 lengths are 4 (empty) or 7 more than a multiple of 9; version 1 lengths are 0 or 3 more, so the two
// never collide. Version 1 clusterings were always clustered in RGB.
ClusteringView read_clustering(const uint8_t* data, size_t length) {
    ClusteringView view;
    if (length == 0 || length % 9 == 3) {
        view.valid = true;
        view.empty = length == 0;
        view.body = data;
        view.merges = length == 0 ? 0 : (length - 3) / 9;
        return view;
    }
    if ((length == clustering_header || length % 9 == 7) && data[0] == clustering_magic && data[1] == clustering_version && data[2] <= 1) {
        view.valid = true;
        view.version = 2;
        view.empty = length == clustering_header;
        view.color_space = ColorSpace(data[2]);
        view.body = data + clustering_header;
        view.merges = length == clustering_header ? 0 : (length - clustering_header - 3) / 9;
    }
    return view;
}

// Cuts a clustering to at most k colours, in split order: the root colour first, and each split keeps the
// parent's position for its heavier half and appends the lighter half, so the palette for k + 1 is the palette
// for k with one entry refined and one appended, and index 0 follows the dominant colour. Version 2 records list
// the heavier child first; for version 1 the heavier child is the one nearer the parent, which is their
// count-weighted mean. As a set, the result is the same as replaying the records into an unordered set.
std::vector<uint8_t> _get_palette_from_clustering(const uint8_t* clustering, size_t clustering_length, int k) {

    std::vector<uint8_t> palette;
    ClusteringView view = read_clustering(clustering, clustering_length);
    if (!view.valid || view.empty || k < 1) {return palette;}

    typedef std::array<uint8_t, 3> Color;
    auto key = [](const Color& c) {return (uint32_t(c[0]) << 16) | (uint32_t(c[1]) << 8) | uint32_t(c[2]);};
    auto read = [&](size_t offset) {return Color{view.body[offset], view.body[offset + 1], view.body[offset + 2]};};
    auto distance = [](const Color& x, const Color& y) {
        int d0 = int(x[0]) - int(y[0]), d1 = int(x[1]) - int(y[1]), d2 = int(x[2]) - int(y[2]);
        return d0 * d0 + d1 * d1 + d2 * d2;
    };

    std::vector<Color> order = {read(0)};
    std::unordered_map<uint32_t, size_t> where = {{key(order[0]), 0}};
    const size_t splits = std::min(size_t(k - 1), view.merges);

    for (size_t i = 0; i < splits; i++) {
        const Color parent = read(3 + 9 * i);
        Color heavy = read(6 + 9 * i), light = read(9 + 9 * i);
        if (view.version == 1 && distance(light, parent) < distance(heavy, parent)) {std::swap(heavy, light);}

        size_t slot = order.size();
        auto found = where.find(key(parent));
        if (found != where.end()) {slot = found->second; where.erase(found);}

        if (!where.count(key(heavy))) {
            if (slot < order.size()) {
                order[slot] = heavy;
                where[key(heavy)] = slot;
            } else {
                where[key(heavy)] = order.size();
                order.push_back(heavy);
            }
        } else if (slot < order.size()) {
            // The heavier half's colour is already listed (clusters can share a colour), so the parent's place
            // empties: close the gap. Rare, so re-indexing everything is fine.
            order.erase(order.begin() + slot);
            where.clear();
            for (size_t j = 0; j < order.size(); j++) {where[key(order[j])] = j;}
        }
        if (!where.count(key(light))) {
            where[key(light)] = order.size();
            order.push_back(light);
        }
    }

    palette.reserve(order.size() * 3);
    for (const Color& color : order) {palette.insert(palette.end(), color.begin(), color.end());}
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
    std::vector<uint32_t> keys;
    colors.reserve(palette_length / 3);
    points.reserve(palette_length / 3);
    keys.reserve(palette_length / 3);

    for (size_t i = 0; i + 2 < palette_length; i += 3) {
        colors.push_back({palette[i], palette[i+1], palette[i+2]});
        points.push_back(space.match(palette[i], palette[i+1], palette[i+2]));
        keys.push_back((uint32_t(palette[i]) << 16) | (uint32_t(palette[i+1]) << 8) | uint32_t(palette[i+2]));
    }

    // Up to 256 colours a lazily built cell index answers lookups fastest. Each cell it builds costs a pass over
    // the palette, so larger palettes (rare, and only through a custom palette) use the k-d tree. Both give
    // the same answers. The cell sizes were tuned on photos: OKLab colours fill less of their cube than RGB.
    const bool small = points.size() <= 256;
    AgglomerativeClustering::PaletteIndex cells;
    AgglomerativeClustering::KDTree tree;
    if (small) {cells.build(points, keys, color_space == ColorSpace::rgb ? 8 : 16, color_space == ColorSpace::rgb ? 4 : 5);} else {tree.build(points, keys);}
    auto lookup = [&](const AgglomerativeClustering::KDTree::Point& target) {return small ? cells.get_nearest(target) : tree.get_nearest(target);};

    int increment = image_format == 1 ? 3 : 4;
    size_t pixels = image_length > 0 ? static_cast<size_t>(image_length) / increment : 0;
    uint8_t* packed = allocate_variable_size(pixels * increment);
    uint8_t* output = packed + 4;

    // A direct-mapped memo of recent lookups: photos repeat colours, neighbouring pixels most of all, so most
    // pixels skip the lookup. A colour always maps to the same palette entry, so the output is unchanged.
    constexpr int memo_bits = 14;
    std::vector<uint32_t> memo_keys(size_t(1) << memo_bits, std::numeric_limits<uint32_t>::max());
    std::vector<int32_t> memo_values(size_t(1) << memo_bits);
    const std::array<uint8_t, 3> black = {0u, 0u, 0u};
    auto nearest_index = [&](uint8_t r, uint8_t g, uint8_t b) {
        uint32_t key = (uint32_t(r) << 16) | (uint32_t(g) << 8) | uint32_t(b);
        uint32_t slot = (key * 0x9E3779B1u) >> (32 - memo_bits);
        if (memo_keys[slot] != key) {
            memo_keys[slot] = key;
            memo_values[slot] = lookup(space.match(r, g, b));
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

    // OKLab conversion costs three cube roots, so dithering in OKLab memoises each pixel's coordinates the same
    // way as the lookups above.
    std::vector<uint32_t> match_keys(color_space == ColorSpace::rgb ? 0 : size_t(1) << memo_bits, std::numeric_limits<uint32_t>::max());
    std::vector<AgglomerativeClustering::KDTree::Point> match_values(match_keys.size());
    auto match = [&](uint8_t r, uint8_t g, uint8_t b) -> AgglomerativeClustering::KDTree::Point {
        if (color_space == ColorSpace::rgb) {return {r, g, b};}
        uint32_t key = (uint32_t(r) << 16) | (uint32_t(g) << 8) | uint32_t(b);
        uint32_t slot = (key * 0x9E3779B1u) >> (32 - memo_bits);
        if (match_keys[slot] != key) {
            match_keys[slot] = key;
            match_values[slot] = space.match(r, g, b);
        }
        return match_values[slot];
    };

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
            const AgglomerativeClustering::KDTree::Point base = match(pixel[0], pixel[1], pixel[2]);
            float wanted[3];
            AgglomerativeClustering::KDTree::Point target;
            for (int c = 0; c < 3; c++) {
                wanted[c] = std::clamp(float(base[c]) + e[c], 0.0f, limit);
                target[c] = uint16_t(std::lround(wanted[c]));
                e[c] = 0.0f;
            }
            const int32_t index = color_space == ColorSpace::rgb ? nearest_index(uint8_t(target[0]), uint8_t(target[1]), uint8_t(target[2])) : lookup(target);
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
uint8_t* get_clustering(uint8_t* image_data, int image_length, int image_format, int color_space, int precision, int weight_alpha) {
    std::vector<uint8_t> clustering = _get_clustering(image_data, image_length, image_format, ColorSpace(color_space), precision, weight_alpha != 0);
    return pack_variable_size(clustering);
}

EMSCRIPTEN_KEEPALIVE
uint8_t* get_palette(uint8_t* image_data, int image_length, int image_format, int k, int color_space, int precision, int weight_alpha) {
    std::vector<uint8_t> clustering = _get_clustering(image_data, image_length, image_format, ColorSpace(color_space), precision, weight_alpha != 0);
    std::vector<uint8_t> palette = _get_palette_from_clustering(clustering.data(), clustering.size(), k);
    return pack_variable_size(palette);
}

EMSCRIPTEN_KEEPALIVE
uint8_t* get_palette_from_clustering(uint8_t* clustering_data, int clustering_length, int k) {
    std::vector<uint8_t> palette = _get_palette_from_clustering(clustering_data, clustering_length, k);
    return pack_variable_size(palette);
}

EMSCRIPTEN_KEEPALIVE
uint8_t* quantize(uint8_t* image_data, int image_length, int image_format, int k, int color_space, int precision, int weight_alpha, double dither, int width) {
    std::vector<uint8_t> clustering = _get_clustering(image_data, image_length, image_format, ColorSpace(color_space), precision, weight_alpha != 0);
    std::vector<uint8_t> palette = _get_palette_from_clustering(clustering.data(), clustering.size(), k);
    return _quantize(image_data, image_length, image_format, palette.data(), palette.size(), ColorSpace(color_space), dither, width);
}

EMSCRIPTEN_KEEPALIVE
// A negative `color_space` matches in the space the clustering was made in.
uint8_t* quantize_with_clustering(uint8_t* image_data, int image_length, int image_format, uint8_t* clustering_data, int clustering_length, int k, int color_space, double dither, int width) {
    std::vector<uint8_t> palette = _get_palette_from_clustering(clustering_data, clustering_length, k);
    ColorSpace space = color_space < 0 ? read_clustering(clustering_data, clustering_length).color_space : ColorSpace(color_space);
    return _quantize(image_data, image_length, image_format, palette.data(), palette.size(), space, dither, width);
}

EMSCRIPTEN_KEEPALIVE
uint8_t* quantize_with_palette(uint8_t* image_data, int image_length, int image_format, uint8_t* palette_data, int palette_length, int color_space, double dither, int width) {
    return _quantize(image_data, image_length, image_format, palette_data, palette_length, ColorSpace(color_space), dither, width);
}

}