// Hierarchical Agglomerative Color Clustering (Ward's method)
// The clock comes first: the grid in clustering.hpp checks it too, to slice its reviews.
#ifdef __EMSCRIPTEN__
#include <emscripten.h>
#else
// A native build (fuzzers and profiling, scripts/native.sh) has no Emscripten: exports are plain functions, and the
// clock that slices a ClusteringJob is std::chrono's.
#include <chrono>
#define EMSCRIPTEN_KEEPALIVE
static double emscripten_get_now() {
    return std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now().time_since_epoch()).count();
}
#endif
#include "clustering.hpp"
#include "colorspace.hpp"
#include "version.hpp"
#include <cstdlib>
#include <cstring>
#include <vector>
#include <cmath>
#include <memory>
#include <limits>

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
    if (!vector.empty()) {std::memcpy(output + 4, vector.data(), vector.size() * sizeof(uint8_t));}   // memcpy from an empty vector's null data() is undefined
    return output;
}

typedef std::array<uint8_t, 3> Rgb;

void write_color(std::vector<uint8_t>& clustering, size_t offset, const Rgb& rgb) {
    for (int c = 0; c < 3; c++) {clustering[offset + c] = rgb[c];}
}

// Clustering format version 3: a header, then the root colour, then one record per merge in split order, then
// zero padding. Multi-byte values are little-endian.
//   header (22 bytes): [magic 0xAC, version 3, header length, record length, colour space, precision,
//                       weight unit (0 = pixels, 1 = 1/255 of a pixel), weight shift, total weight (u32), transparent cutoff,
//                       grouped error (f32), checksum (u32), 1 zero byte]
// The checksum is the CRC-32 (the one zlib and PNG use) of the whole clustering with the checksum's own 4 bytes read as
// zeros, so a stored clustering that was damaged (truncated, a flipped bit, other bytes) is reported, not cut into a wrong
// palette. 0 means none: 3.0.0-beta.1 wrote zeros there, and its clusterings are read unchecked (a real checksum of 0 is
// written as 0 too, and goes unchecked: one clustering in four billion).
// The transparent cutoff is the alpha cutoff (1-255) the clustering was made with, which left RGBA pixels below it out and
// counted the rest whole; 0 when there was none. Indexed output reads it as its default cutoff, so clustering and mapping agree.
// The grouped error is the squared error that `precision` below 8 discards before clustering (colours are grouped
// and replaced by their mean), in the same units as the costs; 0 at precision 8. Readers add it to the costs for the
// error of the leaf clusters. Headers of 13 bytes (before this field) are read as having 0. The header is 22 bytes
// so that the header alone, which an empty image gives, is still 4 more than a multiple of 9.
//   record (21 bytes): [merged rgb, heavier rgb, lighter rgb, parent (u32), lighter weight (u32), cost (f32)]
// Record i splits cluster `parent` (its index in split order: the root is 0, and record i's lighter child is
// i + 1) into its heavier child, which keeps the index, and its lighter child. Weights times 2^shift are in the
// weight unit; the cost is the merge's increase in squared error, in weight units times squared 8-bit RGB values
// (RGB) or squared OKLab units (OKLab). Readers find records by the stored lengths and ignore fields past the
// ones they know, so fields can be added without a new version.
// Version 2 (2.x) had a 4-byte header [magic, 2, colour space, precision] and 9-byte records of colours only.
// Versions 2 and 3 are identified by their version byte and pad their end so the length is 4 (empty) or 7 more than a
// multiple of 9. That padding dates from when version 1 (1.x: no header, 9-byte records, a length of 0 or 3 more than a
// multiple of 9) had to be told apart by length alone; 1.x clusterings are no longer read, and the padding stays so that
// version 3 bytes stay stable.
constexpr uint8_t clustering_magic = 0xAC;
constexpr uint8_t clustering_version = 3;
constexpr size_t clustering_header = 22;
constexpr size_t clustering_min_header = 13;
constexpr size_t clustering_record = 21;
constexpr size_t clustering_checksum = 17;

void write_u32(uint8_t* at, uint32_t value) {
    for (int b = 0; b < 4; b++) {at[b] = (value >> (8 * b)) & 0xFF;}
}

uint32_t read_u32(const uint8_t* at) {
    return uint32_t(at[0]) | (uint32_t(at[1]) << 8) | (uint32_t(at[2]) << 16) | (uint32_t(at[3]) << 24);
}

// CRC-32 (reflected, polynomial 0xEDB88320) of a clustering, reading the checksum field as zeros. The JavaScript
// (shared.js) computes the same to check a clustering before it is used.
// CRC-32 of bytes [from, to) of a clustering, continuing from `crc` (start at 0xFFFFFFFF, finish by inverting), with the
// checksum's own 4 bytes read as zeros.
uint32_t clustering_crc_update(uint32_t crc, const uint8_t* data, size_t from, size_t to) {
    static uint32_t table[256];
    static bool ready = false;
    if (!ready) {
        for (uint32_t n = 0; n < 256; n++) {
            uint32_t c = n;
            for (int b = 0; b < 8; b++) {c = (c & 1) ? 0xEDB88320u ^ (c >> 1) : c >> 1;}
            table[n] = c;
        }
        ready = true;
    }
    for (size_t i = from; i < to; i++) {
        const uint8_t byte = i >= clustering_checksum && i < clustering_checksum + 4 ? 0 : data[i];
        crc = table[(crc ^ byte) & 0xFF] ^ (crc >> 8);
    }
    return crc;
}
uint32_t clustering_crc(const uint8_t* data, size_t length) {
    return clustering_crc_update(0xFFFFFFFFu, data, 0, length) ^ 0xFFFFFFFFu;
}

// Where an image format keeps its channels: the bytes per pixel, the offsets of red and blue (green is always byte 1),
// whether byte 3 is alpha, and whether it is padding instead (the 'x' formats: every pixel is opaque, and mapped output
// writes 255 there). Read at run time rather than compiled per format, so the pixel loops exist once.
// Format codes: rgba 0, rgb 1, bgra 2, rgbx 3, bgrx 4 (`codes` in index.js).
struct PixelLayout {
    int stride;
    int r;
    int b;
    bool alpha;
    bool opaque;
};

PixelLayout layout_of(int image_format) {
    switch (image_format) {
        case 1: return {3, 0, 2, false, false};
        case 2: return {4, 2, 0, true, false};
        case 3: return {4, 0, 2, false, true};
        case 4: return {4, 2, 0, false, true};
        default: return {4, 0, 2, true, false};  // rgba; JS validates the format before any code reaches here
    }
}

// Clusters the image's colours in `color_space`. With `weight_alpha`, an RGBA (or BGRA) pixel counts in proportion to its
// opacity, so fully transparent pixels drop out and Ward minimises the error that is actually visible. With
// `precision` below 8, colours are first grouped by the top `precision` bits of each channel, and each group
// enters the clustering as one cluster at the weighted mean of its colours: at most 2^(3 * precision) clusters,
// so time is bounded on images with very many distinct colours, while the means keep the palette close to exact.
//
// The work is a job that runs in slices: `step(budget)` does as much as fits the time budget and returns whether it
// has finished, so a caller can look at the world between slices (to cancel, or report progress). The stages are
// scanning the pixels, building the grid from the distinct colours, merging clusters, and writing the records;
// scanning and merging are interruptible, the other two are short next to them. Slicing never changes the result:
// the same steps run in the same order however they are divided.
class ClusteringJob {

public:

    // The image must stay where it is until the job has scanned it (the first stage).
    ClusteringJob(const uint8_t* image_data, int image_length, int image_format, ColorSpace color_space, int precision, bool weight_alpha, int cutoff)
        : image_data(image_data), layout(layout_of(image_format)), color_space(color_space), precision(precision), cutoff(cutoff),
          space(color_space), clustering(clustering_header, 0) {
        this->clustering[0] = clustering_magic;
        this->clustering[1] = clustering_version;
        this->clustering[2] = uint8_t(clustering_header);
        this->clustering[3] = uint8_t(clustering_record);
        this->clustering[4] = uint8_t(color_space);
        this->clustering[5] = uint8_t(precision);
        this->limit = int64_t(image_length) - (this->layout.stride - 1);
        this->increment = this->layout.stride;
        // With a cutoff (formats with alpha only), pixels with alpha below it are left out and the rest count whole: it is the
        // indexed-output model, where a pixel is either transparent or fully shown.
        this->binary = cutoff > 0 && this->layout.alpha;
        this->weight_alpha = weight_alpha && this->layout.alpha && !this->binary;
        this->clustering[12] = this->binary ? uint8_t(cutoff) : 0;
    }

    // Runs until the clustering is finished or `budget_ms` milliseconds have passed (checked between small units
    // of work, so a slice can overrun a little). An infinite budget never reads the clock. Returns whether finished.
    bool step(double budget_ms) {
        const bool timed = budget_ms < std::numeric_limits<double>::infinity();
        const double deadline = timed ? emscripten_get_now() + budget_ms : 0.0;
        if (this->stage == Stage::scan && !this->scan(timed, deadline)) {return false;}
        if (this->stage == Stage::build && !this->build(timed, deadline)) {return false;}
        if (this->stage == Stage::chain && !this->merge_some(timed, deadline)) {return false;}
        if (this->stage == Stage::write && !this->write(timed, deadline)) {return false;}
        return this->stage == Stage::done;
    }

    // How far along it is, 0 to 1000 (approximate, and not linear in time). Scanning is the first tenth, building
    // the next twentieth, merging most of the rest, writing the last twentieth; building and writing report where
    // they start (they are short next to merging, and JS keeps the reports monotonic).
    int progress() const {
        switch (this->stage) {
            case Stage::scan: return this->limit > 0 ? int(100.0 * double(this->position) / double(this->limit)) : 0;
            case Stage::build: return 100;
            case Stage::chain: return n > 1 ? 150 + int(800.0 * double(this->merges.size()) / double(this->n - 1)) : 150;
            case Stage::write: return 950;
            default: return 1000;
        }
    }

    // The finished clustering, sealed with its checksum (computed while writing, or here for a header-only one).
    std::vector<uint8_t> take() {
        if (this->crc_cursor < this->clustering.size()) {
            this->crc = clustering_crc_update(this->crc, this->clustering.data(), this->crc_cursor, this->clustering.size());
            this->crc_cursor = this->clustering.size();
        }
        write_u32(&this->clustering[clustering_checksum], this->crc ^ 0xFFFFFFFFu);
        return std::move(this->clustering);
    }

private:

    enum class Stage {scan, build, chain, write, done};
    enum class Phase {convert, group, grouped_error, grid, index};
    enum class Writing {colors, sort, records, checksum};

    struct Merge {
        double height;
        int32_t merged, a, b;
        double cost;
        uint32_t light;
    };

    const uint8_t* image_data;
    PixelLayout layout;
    ColorSpace color_space;
    int precision;
    int cutoff;
    ColorCoordinates space;
    std::vector<uint8_t> clustering;
    Stage stage = Stage::scan;

    // Scanning
    AgglomerativeClustering::AgglomerativeHistogram histogram;
    int64_t limit = 0;
    int64_t position = 0;
    int increment = 4;
    bool binary = false;
    bool weight_alpha = false;
    bool partial = false;

    // Building
    Phase phase = Phase::convert;
    size_t cursor = 0;
    std::vector<std::array<uint16_t, 3>> unique_colors;
    std::vector<uint64_t> unique_counts;
    AgglomerativeClustering::AgglomerativeHistogram bins;  // the groups, with `precision` below 8
    std::vector<std::array<uint64_t, 3>> sums;
    std::vector<std::array<uint16_t, 3>> group_colors;
    std::vector<uint32_t> bin_of;
    uint32_t total_weight = 0;

    // Building and merging
    size_t n = 0;
    int shift = 0;
    double grouped_error = 0;  // squared error lost by grouping, in unscaled weights times squared coordinates
    std::unique_ptr<AgglomerativeClustering::WardGrid> grid;
    std::vector<Merge> merges;
    std::vector<double> heights;
    std::vector<int32_t> chain;
    int32_t next_start = 0;

    // Writing
    Writing writing = Writing::colors;
    std::vector<Rgb> rgb;
    std::vector<Merge> sorted;
    size_t sort_width = 1, sort_left = 0, sort_i = 0, sort_j = 0, sort_k = 0;
    bool sort_active = false;
    std::vector<uint32_t> index;
    uint32_t crc = 0xFFFFFFFFu;
    size_t crc_cursor = 0;

    // Pass 1: build the histogram and collect unique colours. Alpha weights are in units of 1/255 of a pixel.
    bool scan(bool timed, double deadline) {
        constexpr int64_t block = 65536;
        while (this->position < this->limit) {
            const int64_t end = std::min(this->limit, this->position + block * this->increment);
            // Room for this block's new colours first, so the table never grows (rehashing every colour) in one go.
            if (!this->histogram.make_room(size_t(block), timed, deadline)) {return false;}
            for (; this->position < end; this->position += this->increment) {
                const uint8_t* pixel = this->image_data + this->position;
                uint32_t key = (uint32_t(pixel[this->layout.r]) << 16) | (uint32_t(pixel[1]) << 8) | uint32_t(pixel[this->layout.b]);
                if (this->binary) {
                    if (pixel[3] >= this->cutoff) {this->histogram.add(key);}
                    continue;
                }
                if (!this->weight_alpha) {this->histogram.add(key); continue;}
                uint8_t alpha = pixel[3];
                if (alpha == 0) {continue;}
                this->partial = this->partial || alpha != 255;
                this->histogram.add(key, alpha);
            }
            if (timed && this->position < this->limit && emscripten_get_now() >= deadline) {return false;}
        }
        this->stage = Stage::build;
        return true;
    }

    // From the distinct colours to the grid, one cluster per colour (and the header fields that depend on them). It is a
    // pass over the distinct colours, several with `precision` below 8, so on an image of millions of colours it is
    // interruptible like the scan: each phase keeps its place (`cursor`) and checks the clock every `block` colours.
    // The phases run the same operations in the same order however they are sliced.
    bool build(bool timed, double deadline) {
        constexpr size_t block = 65536;
        const auto expired = [&](size_t done, size_t total) {return timed && done < total && emscripten_get_now() >= deadline;};
        const std::vector<uint32_t>& keys = this->histogram.colors();

        // Each distinct colour to clustering coordinates. With no partly transparent pixels every weight is a whole
        // number of pixels: count in pixels, so an opaque image (or one with only fully transparent holes) clusters
        // exactly as with alpha ignored.
        if (this->phase == Phase::convert) {
            if (this->cursor == 0) {
                this->unique_counts = std::vector<uint64_t>(this->histogram.counts());
                this->unique_colors.reserve(keys.size());
                this->clustering[6] = this->weight_alpha && this->partial ? 1 : 0;
            }
            const bool whole_pixels = this->weight_alpha && !this->partial;
            while (this->cursor < keys.size()) {
                const size_t end = std::min(keys.size(), this->cursor + block);
                for (; this->cursor < end; this->cursor++) {
                    const uint32_t key = keys[this->cursor];
                    this->unique_colors.push_back(this->space.cluster(uint8_t(key >> 16), uint8_t(key >> 8), uint8_t(key)));
                    if (whole_pixels) {this->unique_counts[this->cursor] /= 255u;}
                }
                if (expired(this->cursor, keys.size())) {return false;}
            }
            this->cursor = 0;
            this->phase = this->precision < 8 ? Phase::group : Phase::grid;
        }

        // With `precision` below 8: colours grouped by their top bits, each group entering as one cluster at the
        // count-weighted mean of its colours.
        if (this->phase == Phase::group) {
            const uint32_t channel = (0xFFu << (8 - this->precision)) & 0xFFu;
            const uint32_t mask = (channel << 16) | (channel << 8) | channel;
            if (this->cursor == 0) {this->bin_of = std::vector<uint32_t>(this->unique_colors.size());}
            while (this->cursor < this->unique_colors.size()) {
                const size_t end = std::min(this->unique_colors.size(), this->cursor + block);
                for (size_t i = this->cursor; i < end; i++) {
                    uint32_t bin = this->bins.add(keys[i] & mask, this->unique_counts[i]);
                    this->bin_of[i] = bin;
                    if (bin == this->sums.size()) {this->sums.push_back({0u, 0u, 0u});}
                    for (int c = 0; c < 3; c++) {this->sums[bin][c] += uint64_t(this->unique_colors[i][c]) * this->unique_counts[i];}
                }
                this->cursor = end;
                if (expired(this->cursor, this->unique_colors.size())) {return false;}
            }
            // The groups' means (at most 2^(3 * precision) of them, so this part is short)
            const std::vector<uint64_t>& group_counts = this->bins.counts();
            this->group_colors.resize(this->bins.size());
            for (size_t b = 0; b < this->bins.size(); b++) {
                for (int c = 0; c < 3; c++) {this->group_colors[b][c] = uint16_t(this->sums[b][c] / group_counts[b]);}
            }
            this->cursor = 0;
            this->phase = Phase::grouped_error;
        }

        // What grouping discarded: each original colour's squared distance to the mean that now stands for it. Then the
        // groups replace the colours.
        if (this->phase == Phase::grouped_error) {
            while (this->cursor < this->unique_colors.size()) {
                const size_t end = std::min(this->unique_colors.size(), this->cursor + block);
                for (size_t i = this->cursor; i < end; i++) {
                    double squared = 0;
                    for (int c = 0; c < 3; c++) {
                        const double d = double(this->unique_colors[i][c]) - double(this->group_colors[this->bin_of[i]][c]);
                        squared += d * d;
                    }
                    this->grouped_error += squared * double(this->unique_counts[i]);
                }
                this->cursor = end;
                if (expired(this->cursor, this->unique_colors.size())) {return false;}
            }
            this->unique_colors = std::move(this->group_colors);
            this->unique_counts = std::vector<uint64_t>(this->bins.counts());
            this->bin_of = {};
            this->sums = {};
            this->cursor = 0;
            this->phase = Phase::grid;
        }

        if (this->phase == Phase::grid) {
            if (this->cursor == 0) {
                // An image with no visible pixels has no hierarchy: the result is just the header, which cuts to an
                // empty palette.
                this->n = this->unique_colors.size();
                if (this->n == 0) {this->stage = Stage::done; return true;}
                // Pad so the length is 7 more than a multiple of 9, which no 1.x clustering can be.
                size_t length = clustering_header + 3 + clustering_record * (this->n - 1);
                this->clustering.resize(length + (7 + 9 - length % 9) % 9, 0);

                // The grid counts in 32 bits. Weights only exceed that for partly transparent images above ~16.8 MP;
                // scale those down by the smallest power of two that fits, keeping every visible colour at least 1.
                uint64_t total = 0;
                for (uint64_t count : this->unique_counts) {total += count;}
                while ((total >> this->shift) > std::numeric_limits<uint32_t>::max() / 2u) {this->shift++;}
                this->clustering[7] = uint8_t(this->shift);
                this->grid = std::make_unique<AgglomerativeClustering::WardGrid>(this->n);
            }
            // Pass 2: one cluster per unique colour
            while (this->cursor < this->n) {
                const size_t end = std::min(this->n, this->cursor + block);
                for (; this->cursor < end; this->cursor++) {
                    uint32_t weight = uint32_t(std::max<uint64_t>(this->unique_counts[this->cursor] >> this->shift, 1u));
                    this->grid->add(this->unique_colors[this->cursor], weight);
                    this->total_weight += weight;
                }
                if (expired(this->cursor, this->n)) {return false;}
            }
            write_u32(&this->clustering[8], this->total_weight);
            this->unique_colors = {};
            this->unique_counts = {};
            this->cursor = 0;  // writing uses it next
            this->phase = Phase::index;
        }

        // The grid's first size, picked from how crowded the colours are (resumable too: on millions of clusters
        // it is the longest part of building).
        if (this->phase == Phase::index && !this->grid->reindex(timed, deadline)) {return false;}

        // Merges come out of the nearest-neighbour chain in chain order, not cost order. A merge's height is its
        // cost, raised to its children's heights where centroid rounding would put it below them, so sorting by
        // height keeps every merge after the merges that formed its clusters.
        this->merges.reserve(this->n - 1);
        this->heights.assign(2 * this->n, 0.0);
        this->stage = Stage::chain;
        return true;
    }

    // Ward's criterion is reducible, so merging mutual cheapest partners as the chain finds them gives the
    // same hierarchy as always merging the globally cheapest pair.
    bool merge_some(bool timed, double deadline) {
        AgglomerativeClustering::WardGrid& grid = *this->grid;
        // A review of the grid's size left unfinished by the last slice comes first: nothing may query the grid during one.
        if (grid.reviewing() && !grid.reindex(timed, deadline)) {return false;}
        unsigned iterations = 0;
        while (grid.size() > 1) {

            if (timed && (++iterations & 3u) == 0 && emscripten_get_now() >= deadline) {return false;}

            if (this->chain.empty()) {
                while (!grid.is_alive(this->next_start)) {this->next_start++;}
                this->chain.push_back(this->next_start);
            }

            int32_t a = this->chain.back();
            // The cluster below `a` in the chain is a live partner, so its cost bounds the search.
            int32_t b = grid.nearest(a, this->chain.size() >= 2 ? this->chain[this->chain.size() - 2] : AgglomerativeClustering::WardGrid::none);

            if (this->chain.size() < 2 || this->chain[this->chain.size() - 2] != b) {
                this->chain.push_back(b);
                continue;
            }

            this->chain.pop_back();
            this->chain.pop_back();

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

            double cost = grid.cost(a, b);
            double height = std::max({cost, this->heights[a], this->heights[b]});
            grid.remove(a);
            grid.remove(b);
            int32_t m = grid.add(merged, count);
            this->heights[m] = height;
            // Heavier child first, so cutting the hierarchy knows which half of a split keeps the parent's place.
            if (b_count > a_count) {this->merges.push_back({height, m, b, a, cost, a_count});} else {this->merges.push_back({height, m, a, b, cost, b_count});}
            if (!grid.reindex(timed, deadline)) {return false;}

        }
        this->stage = Stage::write;
        return true;
    }

    // Writing the records, interruptible like the other stages: on millions of merges it is a conversion of every
    // cluster, a sort and the records themselves, so each part keeps its place and checks the clock every `block`
    // steps. The steps and their order are the same however it is sliced.
    bool write(bool timed, double deadline) {
        constexpr size_t block = 65536;
        AgglomerativeClustering::WardGrid& grid = *this->grid;

        // Every cluster (dead ones keep their coordinates) is converted to 8-bit sRGB once: in OKLab that takes
        // three powers, and most clusters appear in two records.
        if (this->writing == Writing::colors) {
            if (this->cursor == 0) {this->rgb = std::vector<Rgb>(size_t(grid.capacity()));}
            const size_t total = size_t(grid.capacity());
            while (this->cursor < total) {
                const size_t end = std::min(total, this->cursor + block);
                for (; this->cursor < end; this->cursor++) {this->rgb[this->cursor] = this->space.to_rgb(grid.coords(int32_t(this->cursor)));}
                if (timed && this->cursor < total && emscripten_get_now() >= deadline) {return false;}
            }
            this->cursor = 0;
            this->sorted.reserve(this->merges.size());
            this->writing = Writing::sort;
        }

        // Merged ids increase in chain order, so breaking height ties by them keeps chain order, as a stable sort would.
        // The order is total (merged ids are unique), so any sort gives these bytes. A plain bottom-up merge sort, not
        // std::sort: its unrolled instantiation for Merge was 16 KB of WebAssembly, an eighth of the module. It keeps
        // its place within a merge of two runs, since the last merges are as long as the whole list.
        if (this->writing == Writing::sort) {
            auto before = [](const Merge& x, const Merge& y) {return x.height < y.height || (x.height == y.height && x.merged < y.merged);};
            std::vector<Merge>& a = this->merges;
            std::vector<Merge>& b = this->sorted;
            const size_t n = a.size();
            // The second buffer, zeroed in parts first: it is as large as the merges (160 MB at four million).
            while (b.size() < n) {
                b.resize(std::min(n, b.size() + block * 16));
                if (timed && b.size() < n && emscripten_get_now() >= deadline) {return false;}
            }
            size_t done = 0;
            while (this->sort_width < n) {
                const size_t width = this->sort_width;
                while (this->sort_left < n) {
                    const size_t middle = std::min(this->sort_left + width, n), right = std::min(this->sort_left + 2 * width, n);
                    if (!this->sort_active) {
                        this->sort_i = this->sort_left;
                        this->sort_j = middle;
                        this->sort_k = this->sort_left;
                        this->sort_active = true;
                    }
                    size_t& i = this->sort_i;
                    size_t& j = this->sort_j;
                    size_t& k = this->sort_k;
                    while (k < right) {
                        // The left run's element first unless the right one is strictly before it.
                        if (i < middle && (j >= right || !before(a[j], a[i]))) {b[k++] = a[i++];} else {b[k++] = a[j++];}
                        if (++done % block == 0 && timed && k < right && emscripten_get_now() >= deadline) {return false;}
                    }
                    this->sort_active = false;
                    this->sort_left += 2 * width;
                }
                a.swap(b);
                this->sort_width *= 2;
                this->sort_left = 0;
                if (timed && this->sort_width < n && emscripten_get_now() >= deadline) {return false;}
            }
            this->sorted = {};
            this->index = std::vector<uint32_t>(size_t(grid.capacity()), 0u);
            // The error that grouping discarded, in the same units as the costs.
            const double scale = this->color_space == ColorSpace::rgb ? 65535.0 / 255.0 : 65535.0;
            const float grouped = float(this->grouped_error / double(uint64_t(1) << this->shift) / (scale * scale));
            uint32_t bits;
            std::memcpy(&bits, &grouped, 4);
            write_u32(&this->clustering[13], bits);
            this->writing = Writing::records;
        }

        // Records go in split order, the reverse of merge order. Each cluster's split-order index: the root is 0,
        // the heavier child keeps its parent's index, and record i's lighter child is i + 1. Costs are converted from
        // 16-bit coordinates to squared 8-bit RGB values or squared OKLab units.
        if (this->writing == Writing::records) {
            const double scale = this->color_space == ColorSpace::rgb ? 65535.0 / 255.0 : 65535.0;
            const size_t total = this->merges.size();
            while (this->cursor < total) {
                const size_t end = std::min(total, this->cursor + block);
                for (; this->cursor < end; this->cursor++) {
                    const size_t i = this->cursor;
                    const Merge& merge = this->merges[total - 1 - i];
                    this->index[merge.a] = this->index[merge.merged];
                    this->index[merge.b] = uint32_t(i + 1);
                    uint8_t* record = &this->clustering[clustering_header + 3 + clustering_record * i];
                    write_color(this->clustering, record - this->clustering.data(), this->rgb[merge.merged]);
                    write_color(this->clustering, record - this->clustering.data() + 3, this->rgb[merge.a]);
                    write_color(this->clustering, record - this->clustering.data() + 6, this->rgb[merge.b]);
                    write_u32(record + 9, this->index[merge.merged]);
                    write_u32(record + 13, merge.light);
                    float cost = float(merge.cost / (scale * scale));
                    uint32_t bits;
                    std::memcpy(&bits, &cost, 4);
                    write_u32(record + 17, bits);
                }
                if (timed && this->cursor < total && emscripten_get_now() >= deadline) {return false;}
            }
            // Add the k=1 clustering colour
            write_color(this->clustering, clustering_header, this->rgb[this->merges.empty() ? 0 : this->merges.back().merged]);
            this->rgb = {};
            this->index = {};
            this->writing = Writing::checksum;
        }

        // The checksum, over the finished bytes (take() writes it).
        constexpr size_t bytes = size_t(1) << 20;
        while (this->crc_cursor < this->clustering.size()) {
            const size_t end = std::min(this->clustering.size(), this->crc_cursor + bytes);
            this->crc = clustering_crc_update(this->crc, this->clustering.data(), this->crc_cursor, end);
            this->crc_cursor = end;
            if (timed && this->crc_cursor < this->clustering.size() && emscripten_get_now() >= deadline) {return false;}
        }
        this->stage = Stage::done;
        return true;
    }

};

// The whole clustering in one go.
std::vector<uint8_t> _get_clustering(uint8_t* image_data, int image_length, int image_format, ColorSpace color_space, int precision, bool weight_alpha, int cutoff = 0) {
    ClusteringJob job(image_data, image_length, image_format, color_space, precision, weight_alpha, cutoff);
    job.step(std::numeric_limits<double>::infinity());
    return job.take();
}

// A clustering (version 2 or 3), located: `body` is the root colour followed by `merges` records of `record` bytes each.
struct ClusteringView {
    bool valid = false;
    int version = 0;
    ColorSpace color_space = ColorSpace::rgb;
    bool empty = true;
    const uint8_t* body = nullptr;
    size_t record = 9;
    size_t merges = 0;
};

// Versions are told apart by their version byte. (Clusterings from 1.x had no header and were recognised only by their
// length, which many other byte strings share, so they are no longer read.) The JS wrapper rejects anything this
// doesn't accept before calling in.
ClusteringView read_clustering(const uint8_t* data, size_t length) {
    ClusteringView view;
    if (length < 4 || data[0] != clustering_magic) {return view;}
    if (data[1] == 2 && data[2] <= 1 && (length == 4 || length % 9 == 7)) {
        view.valid = true;
        view.version = 2;
        view.empty = length == 4;
        view.color_space = ColorSpace(data[2]);
        view.body = data + 4;
        view.merges = length == 4 ? 0 : (length - 4 - 3) / 9;
    }
    // The checksum is checked by the JavaScript before calling in.
    if (data[1] == 3 && length >= clustering_min_header) {
        const size_t header = data[2], record = data[3];
        if (header < clustering_min_header || record < clustering_record || header > length || data[4] > 1) {return view;}
        view.valid = true;
        view.version = 3;
        view.color_space = ColorSpace(data[4]);
        view.empty = length < header + 3;
        view.body = data + header;
        view.record = record;
        // The end is padded with fewer than 9 bytes, so this rounds the padding away.
        view.merges = view.empty ? 0 : (length - header - 3) / record;
    }
    return view;
}

// Cuts a clustering to at most k colours, in split order: the root colour first, and each split keeps the
// parent's position for its heavier half and appends the lighter half, so the palette for k + 1 is the palette
// for k with one entry refined and one appended, and index 0 follows the dominant colour. Records list
// the heavier child first. As a set, the result is the same as replaying the records into an unordered set.
// Different clusters can share an 8-bit colour (their 16-bit centroids round to the same value), so the palette is the set
// of colours of the current clusters, kept with a count of the clusters that have each colour: a colour leaves the palette
// only when its last cluster is split. (Keeping a plain set, as 2.x did and 3.0.0-beta.2 checked against, loses a colour
// while another cluster still has it: palettes at very large k came out one short, and beta.2 rejected such clusterings.)
// Clusterings are untrusted bytes, so the records are checked as they are replayed: each must split a colour some
// current cluster has (and, from version 3, the cluster its parent index names, which has that colour). A clustering whose
// records don't fit together sets `valid` to false (the exports then return a null pointer, which the JavaScript reports
// as an invalid clustering) rather than giving a palette of the wrong size or colours.
std::vector<uint8_t> _get_palette_from_clustering(const uint8_t* clustering, size_t clustering_length, int k, bool& valid) {

    std::vector<uint8_t> palette;
    ClusteringView view = read_clustering(clustering, clustering_length);
    valid = view.valid;
    if (!view.valid || view.empty || k < 1) {return palette;}

    typedef std::array<uint8_t, 3> Color;
    auto key = [](const Color& c) {return (uint32_t(c[0]) << 16) | (uint32_t(c[1]) << 8) | uint32_t(c[2]);};
    auto read = [&](size_t offset) {return Color{view.body[offset], view.body[offset + 1], view.body[offset + 2]};};

    // Each colour seen so far, its place in `order` and how many current clusters have it: a colour none has is no
    // longer listed (the table doesn't erase, so it keeps the colour with a count of 0).
    struct Entry {size_t slot; uint32_t clusters;};
    std::vector<Color> order = {read(0)};
    AgglomerativeClustering::AgglomerativeHistogram seen;
    std::vector<Entry> entries;
    auto listed = [&](const Color& c) -> Entry* {
        const int64_t at = seen.find(key(c));
        return at >= 0 && entries[size_t(at)].clusters > 0 ? &entries[size_t(at)] : nullptr;
    };
    auto list = [&](const Color& c, size_t slot) {
        const uint32_t at = seen.add(key(c));
        if (at == entries.size()) {entries.push_back({slot, 1});} else {entries[at] = {slot, 1};}
    };
    list(order[0], 0);
    const size_t splits = std::min(size_t(k - 1), view.merges);
    // From version 3, each cluster's colour by split-order index, to check the records' parent indices against.
    std::vector<uint32_t> cluster_colour;
    if (view.version >= 3) {cluster_colour.push_back(key(order[0]));}

    for (size_t i = 0; i < splits; i++) {
        const size_t at = 3 + view.record * i;
        const Color parent = read(at);
        const Color heavy = read(at + 3), light = read(at + 6);

        if (view.version >= 3) {
            const uint32_t index = read_u32(view.body + at + 9);
            if (index > i || cluster_colour[index] != key(parent)) {valid = false; return {};}
            cluster_colour[index] = key(heavy);
            cluster_colour.push_back(key(light));
        }

        Entry* found = listed(parent);
        if (found == nullptr) {valid = false; return {};}
        // Whether the parent's colour leaves the palette with this split (no other current cluster has it).
        const size_t slot = found->slot;
        const bool freed = --found->clusters == 0;

        Entry* heavier = listed(heavy);
        if (heavier != nullptr) {
            heavier->clusters++;
            if (freed) {
                // The parent's place empties and the heavier half's colour is listed elsewhere: close the gap. Rare, so
                // re-indexing everything is fine.
                order.erase(order.begin() + slot);
                for (Entry& entry : entries) {if (entry.clusters > 0 && entry.slot > slot) {entry.slot--;}}
            }
        } else if (freed) {
            order[slot] = heavy;
            list(heavy, slot);
        } else {
            list(heavy, order.size());
            order.push_back(heavy);
        }
        Entry* lighter = listed(light);
        if (lighter != nullptr) {
            lighter->clusters++;
        } else {
            list(light, order.size());
            order.push_back(light);
        }
    }

    palette.reserve(order.size() * 3);
    for (const Color& color : order) {palette.insert(palette.end(), color.begin(), color.end());}
    return palette;

}

// The weight, in pixels, of each colour in the k-colour palette (in the palette's order), from a version 3
// clustering. Clusters are followed by their split-order index, since different clusters can share a colour;
// each palette colour's weight is the total of the clusters with that colour. Returns nothing for clusterings
// without weights (versions 1 and 2), or whose records don't fit together: a parent that isn't an earlier cluster
// with the record's merged colour, a lighter half heavier than its parent, or a cluster colour not in the palette.
// Clusterings are untrusted bytes, and an exception here would abort the module (it is built without them).
std::vector<double> _get_palette_weights(const uint8_t* clustering, size_t clustering_length, int k) {

    std::vector<double> weights;
    ClusteringView view = read_clustering(clustering, clustering_length);
    if (!view.valid || view.version < 3 || k < 1) {return weights;}
    bool valid = false;
    std::vector<uint8_t> palette = _get_palette_from_clustering(clustering, clustering_length, k, valid);
    if (!valid || view.empty) {return weights;}

    const double pixels = std::ldexp(1.0, clustering[7]) / (clustering[6] == 1 ? 255.0 : 1.0);
    const size_t splits = std::min(size_t(k - 1), view.merges);
    auto key = [&](size_t offset) {return (uint32_t(view.body[offset]) << 16) | (uint32_t(view.body[offset + 1]) << 8) | uint32_t(view.body[offset + 2]);};
    std::vector<uint32_t> colour = {key(0)};
    std::vector<uint32_t> weight = {read_u32(clustering + 8)};
    for (size_t i = 0; i < splits; i++) {
        const size_t at = 3 + view.record * i;
        const uint32_t parent = read_u32(view.body + at + 9), light = read_u32(view.body + at + 13);
        if (parent > i || colour[parent] != key(at) || light > weight[parent]) {return weights;}
        weight[parent] -= light;
        colour[parent] = key(at + 3);
        weight.push_back(light);
        colour.push_back(key(at + 6));
    }

    // The palette's colours are distinct, so each one's index in the table is its place in the palette.
    AgglomerativeClustering::AgglomerativeHistogram slot;
    for (size_t j = 0; j < palette.size() / 3; j++) {slot.add((uint32_t(palette[3 * j]) << 16) | (uint32_t(palette[3 * j + 1]) << 8) | uint32_t(palette[3 * j + 2]));}
    std::vector<double> totals(palette.size() / 3, 0.0);
    for (size_t id = 0; id < colour.size(); id++) {
        const int64_t found = slot.find(colour[id]);
        if (found < 0) {return weights;}
        totals[size_t(found)] += weight[id] * pixels;
    }
    return totals;

}

// What a MappingJob does with each pixel's index: write its colour (_quantize) or the index itself (_quantize_indices). One
// type with a mode, not a template parameter, so the pixel loops are compiled once (they are most of the module; two
// copies cost about 19 KB of WebAssembly). The mode test is the same for every pixel, so it predicts perfectly.
// lround for a float in [0, 2^23): adding the largest float below one half and truncating gives the same integer as rounding halves away from zero
// (checked over every float in range by bench/spikes/perf-3/round-check.cpp), without lroundf's call.
static inline int32_t round_nonnegative(float x) {return int32_t(x + 0x1.fffffep-2f);}

struct PixelSink {
    bool colours;                 // true: colours (_quantize); false: indices (_quantize_indices)
    PixelLayout L;
    const uint8_t* image_data;
    uint8_t* output;
    const uint8_t* palette;       // colours: the palette the indices point into
    uint32_t index_bytes;         // indices: 1, 2 or 4
    int cutoff;                   // indices: alpha below this takes transparent_index (with `transparent`)
    bool transparent;
    int32_t transparent_index;

    void operator()(size_t p, int32_t index) const {
        if (colours) {
            const int increment = L.stride;
            uint8_t* out = output + p * increment;
            const uint8_t* colour = index < 0 ? nullptr : palette + 3 * size_t(index);
            out[L.r] = colour ? colour[0] : 0;
            out[1] = colour ? colour[1] : 0;
            out[L.b] = colour ? colour[2] : 0;
            if (L.opaque) {out[3] = 255;} else if (L.alpha) {out[3] = image_data[p * increment + 3];}
        } else {
            if (transparent && image_data[p * 4 + 3] < cutoff) {index = transparent_index;}
            uint8_t* out = output + p * index_bytes;
            for (uint32_t b = 0; b < index_bytes; b++) {out[b] = (uint32_t(index) >> (8 * b)) & 0xFF;}
        }
    }
};

// The mapping of one image to one palette, run in slices (see step): everything that lives across pixels, set up once
// in the constructor, so a slice resumes exactly where the last one stopped. Without a time budget step() runs the
// whole image in one go, never reading the clock: the one-shot exports (_quantize, _quantize_indices) take exactly
// the steps they always did. For each pixel p it calls `emit(p, index)` with the chosen palette index, or -1 when the
// palette is empty. With `dither` > 0 the remaining error is diffused to neighbouring pixels (see the methods below),
// which needs the image's `width`.
class MappingJob {

    typedef AgglomerativeClustering::KDTree::Point Point;
    static constexpr int memo_bits = 14;
    enum class Method {plain, floyd_steinberg, atkinson, ordered};

    const uint8_t* image_data;
    ColorSpace color_space;
    ColorCoordinates space;
    PixelLayout L;
    size_t pixels;
    size_t width;
    size_t height = 0;
    int skip_below;
    PixelSink emit;
    Method method = Method::plain;
    size_t cursor = 0;  // how many pixels are done, in the order the method visits them (serpentine rows dithered)

    std::vector<Point> points;
    std::vector<uint32_t> keys;
    // The indexes are built over distinct colours only: a supplied palette can repeat a colour any number of times, and
    // equal entries would all land in the same cell lists and tree leaves, making each lookup a pass over the repeats
    // (a 200,000-entry palette of one colour took seconds for a thousand pixels). Equal entries tie, and ties go to
    // the first of them, so `first[u]` is the palette index of distinct colour `u`'s first occurrence.
    std::vector<int32_t> first;
    bool small = true;
    AgglomerativeClustering::PaletteIndex cells;
    AgglomerativeClustering::KDTree tree;
    // A direct-mapped memo of recent lookups: photos repeat colours, neighbouring pixels most of all, so most
    // pixels skip the lookup. A colour always maps to the same palette entry, so the output is unchanged.
    std::vector<uint32_t> memo_keys;
    std::vector<int32_t> memo_values;

    // Dithering (see step for what each is)
    float strength = 0.0f, limit = 0.0f, near = 0.0f, most = 0.0f;
    std::vector<uint32_t> match_keys;
    std::vector<Point> match_values;
    std::vector<float> current, next;  // Floyd-Steinberg: the error for this row and the next
    size_t atkinson_stride = 0;
    std::vector<float> rows;           // Atkinson: three rows of error
    // Ordered
    size_t steps = 0;
    float recipe_strength = 0.0f;
    int recipe_bits = 0;
    std::vector<uint32_t> recipe_keys;
    std::vector<int32_t> recipes;
    std::vector<uint64_t> brightness;
    typedef int32_t i32x4 __attribute__((vector_size(16)));
    bool scan = false;
    size_t groups = 0;
    std::vector<i32x4> scan_r, scan_g, scan_b;
    std::vector<int32_t> scan_index;

public:

    MappingJob(const uint8_t* image_data, int image_length, int image_format, const uint8_t* palette, size_t palette_length, ColorSpace color_space, double dither, int dither_method, int dither_steps, int width, int skip_below, const PixelSink& emit)
        : image_data(image_data), color_space(color_space), space(color_space), L(layout_of(image_format)), width(width > 0 ? size_t(width) : 0), skip_below(skip_below), emit(emit) {

        this->pixels = image_length > 0 ? static_cast<size_t>(image_length) / L.stride : 0;
        AgglomerativeClustering::AgglomerativeHistogram seen;
        for (size_t i = 0; i + 2 < palette_length; i += 3) {
            const uint32_t key = (uint32_t(palette[i]) << 16) | (uint32_t(palette[i+1]) << 8) | uint32_t(palette[i+2]);
            if (seen.add(key) < this->points.size()) {continue;}
            this->points.push_back(space.match(palette[i], palette[i+1], palette[i+2]));
            this->keys.push_back(key);
            this->first.push_back(int32_t(i / 3));
        }

        // Up to 1024 colours a lazily built cell index answers lookups fastest (2.5 to 3 times faster than the k-d tree
        // from 257 to 1024 colours, on photos and random palettes). Each cell it builds costs a pass over the palette, so
        // larger palettes (only through a custom palette) use the k-d tree, which wins from about 4096. Both give the same
        // answers. The cell sizes were tuned on photos: OKLab colours fill less of their cube than RGB.
        this->small = this->points.size() <= 1024;
        if (this->small) {this->cells.build(this->points, this->keys, color_space == ColorSpace::rgb ? 8 : 16, color_space == ColorSpace::rgb ? 4 : 5);} else {this->tree.build(this->points, this->keys);}
        this->memo_keys.assign(size_t(1) << memo_bits, std::numeric_limits<uint32_t>::max());
        this->memo_values.resize(size_t(1) << memo_bits);

        if (dither <= 0.0 || this->width == 0 || this->pixels % this->width != 0 || this->points.empty()) {return;}

        this->height = this->pixels / this->width;
        this->strength = float(std::min(dither, 1.0));
        this->limit = color_space == ColorSpace::rgb ? 255.0f : 65535.0f;
        // The colour a pixel should take (its own plus the error it was given) can lie outside the cube. Close to it (dark
        // areas next to the palette's darkest colour) it is clamped to the cube, as most dithering does, and matched
        // through the index. Further out, the palette can't reach the image's colours (saturated cyan with a 7-colour
        // e-ink palette): clamping there would throw away the error that should move the next pixels to other entries,
        // so the same entry (blue, for cyan) would be picked every time. There the target is kept as it is and matched
        // exactly, by a pass over the palette: rare with palettes extracted from the image, and cheap with the small
        // ones that can't cover it. The error a pixel receives is limited in length (not per channel, which would push
        // it into a corner where several entries tie), so out-of-reach colours don't build it up without end and smear
        // it across the image.
        this->near = this->limit / 8.0f;
        this->most = this->limit;
        // OKLab conversion costs three cube roots, so dithering in OKLab memoises each pixel's coordinates the same
        // way as the lookups.
        this->match_keys.assign(color_space == ColorSpace::rgb ? 0 : size_t(1) << memo_bits, std::numeric_limits<uint32_t>::max());
        this->match_values.resize(this->match_keys.size());

        if (dither_method == 2) {
            this->method = Method::ordered;
            // Steps 0 is the default: 64 for two colours, where every one of the matrix's 65 shades shows on a smooth
            // gradient (black and white), and 16 otherwise, where colours are closer together and 16 is where more steps
            // stop paying for their time (each doubling about doubles it).
            this->steps = dither_steps > 0 ? size_t(dither_steps) : this->points.size() <= 2 ? 64 : 16;
            // The error a recipe carries is scaled by an internal strength, which the strength given maps to through a
            // table per step count. Ordered dithering responds very steeply to it (with 64 steps, 0.01 already does a
            // third of what 1 does), and more steeply the more steps there are. The table was measured so that the share
            // of pixels a strength changes, against full strength, follows Floyd-Steinberg's at 0.05, 0.1, 0.25, 0.5 and
            // 0.75 (on photos, gradients and a grey ramp, with black and white, four greys, seven e-ink inks, and 4 and 16
            // colours from each image), so a strength means about the same for every method. Between the knots it is
            // interpolated geometrically, as the response is roughly logarithmic in the internal strength.
            static constexpr double knot_strengths[7] = {0.0, 0.05, 0.1, 0.25, 0.5, 0.75, 1.0};
            static constexpr double knot_internal[6][7] = {
                {0.0, 0.0322, 0.0669, 0.167, 0.408, 0.691, 1.0},      // 2 steps
                {0.0, 0.0180, 0.0392, 0.102, 0.278, 0.570, 1.0},      // 4
                {0.0, 0.00930, 0.0208, 0.0576, 0.166, 0.411, 1.0},    // 8
                {0.0, 0.00463, 0.0108, 0.0304, 0.0938, 0.285, 1.0},   // 16
                {0.0, 0.00241, 0.00555, 0.0158, 0.0505, 0.179, 1.0},  // 32
                {0.0, 0.00124, 0.00283, 0.00811, 0.0272, 0.107, 1.0}, // 64
            };
            size_t row = 0;
            for (size_t m = this->steps; m > 2; m >>= 1) {row++;}
            double internal = 1.0;
            for (size_t k = 1; k < 7; k++) {
                if (double(this->strength) <= knot_strengths[k]) {
                    const double t = (double(this->strength) - knot_strengths[k - 1]) / (knot_strengths[k] - knot_strengths[k - 1]);
                    const double low = knot_internal[row][k - 1], high = knot_internal[row][k];
                    internal = low == 0.0 ? t * high : low * std::pow(high / low, t);
                    break;
                }
            }
            this->recipe_strength = float(internal);
            // Recipes are memoised by colour in a direct-mapped table. Up to 16 steps it holds 2^21 / steps recipes (8 MB
            // of entries, plus 4 MB of keys at 2 steps down to 0.5 MB at 16). Above that it holds 2^17, since a photo has
            // 50,000 to 100,000 colours and a slot two colours share is a recipe built twice: 16 MB of entries at 32
            // steps and 32 MB at 64 (the default for black and white), plus 0.5 MB of keys. It never holds more than
            // twice the image's pixels, so a small image doesn't pay for a large table. A recipe depends on nothing but
            // its colour, so the table changes speed only.
            int bits = 21;
            for (size_t m = this->steps; m > 1; m >>= 1) {bits--;}
            bits = std::max(bits, 17);
            int image_bits = 1;
            while (image_bits < bits && (size_t(1) << image_bits) < 2 * this->pixels) {image_bits++;}
            this->recipe_bits = std::max(4, std::min(bits, image_bits));
            this->recipe_keys.assign(size_t(1) << this->recipe_bits, std::numeric_limits<uint32_t>::max());
            this->recipes.resize((size_t(1) << this->recipe_bits) * this->steps);
            // Brightness for sorting a recipe: luma in RGB (in integers, so ties are exact), L in OKLab. Ties go to the
            // smaller packed RGB key, so the order, and the output, don't depend on the palette's order. Both go into
            // one 64-bit order key per entry, so a comparison is one load and one compare.
            this->brightness.resize(this->points.size());
            for (size_t i = 0; i < this->points.size(); i++) {
                const Point& point = this->points[i];
                const uint32_t luma = color_space == ColorSpace::rgb ? 299u * point[0] + 587u * point[1] + 114u * point[2] : point[0];
                this->brightness[i] = uint64_t(luma) << 32 | this->keys[i];
            }
            // A recipe's targets are new colours step after step, so the lookup memo rarely saves a search for them. For
            // RGB palettes up to 96 colours a step compares the target with every colour, four at a time: squared 8-bit
            // RGB distances fit in 32 bits, so this is exact. The colours are laid out in packed-key order, four to a
            // group, so keeping only strictly nearer colours in each lane, then the nearest across lanes with ties to the
            // earlier position, gives ties to the smaller key, as the index does. Larger palettes and OKLab use `pick`.
            // The limit was measured on video frames (bench/spikes/recipe-reuse/sizes.mjs): the scan is 7-21% faster
            // than the index from 65 to 96 colours, about even at 128 and slower above (30% at 255).
            this->scan = color_space == ColorSpace::rgb && this->points.size() <= 96;
            this->groups = this->scan ? (this->points.size() + 3) / 4 : 0;
            this->scan_r.resize(this->groups);
            this->scan_g.resize(this->groups);
            this->scan_b.resize(this->groups);
            this->scan_index.assign(this->groups * 4, 0);
            if (this->scan) {
                std::vector<int32_t> order(this->points.size());
                for (size_t i = 0; i < order.size(); i++) {order[i] = int32_t(i);}
                AgglomerativeClustering::insertion_sort(order.data(), order.size(), [&](int32_t a, int32_t b) {return this->keys[size_t(a)] < this->keys[size_t(b)];});
                for (size_t i = 0; i < this->groups * 4; i++) {
                    // Unused lanes repeat the last colour: never strictly nearer than it, and later in order, so never chosen.
                    const int32_t source = order[std::min(i, order.size() - 1)];
                    this->scan_r[i / 4][i % 4] = this->points[size_t(source)][0];
                    this->scan_g[i / 4][i % 4] = this->points[size_t(source)][1];
                    this->scan_b[i / 4][i % 4] = this->points[size_t(source)][2];
                    this->scan_index[i] = source;
                }
            }
        } else if (dither_method == 1) {
            // Atkinson: three rows of error, with two pixels of padding on each side so no neighbour needs a check.
            this->method = Method::atkinson;
            this->atkinson_stride = 3 * (this->width + 4);
            this->rows.assign(3 * this->atkinson_stride, 0.0f);
        } else {
            // Floyd-Steinberg: error for the current and next rows, one pixel of padding on each side.
            this->method = Method::floyd_steinberg;
            this->current.assign(3 * (this->width + 2), 0.0f);
            this->next.assign(3 * (this->width + 2), 0.0f);
        }
    }

    // How far the mapping has got, from 0 to 999.
    int progress() const {
        // In doubles: size_t is 32 bits in WebAssembly, so cursor * 1000 overflowed above 4.29 million pixels.
        return this->pixels == 0 ? 0 : std::min(999, int(1000.0 * double(this->cursor) / double(this->pixels)));
    }

    // Maps pixels until `deadline` (with `timed`) or the end, and returns whether the whole image is done. The clock is
    // read every 16,384 pixels without dithering and every 1,024 with it (a dithered pixel costs more; ordered also reads
    // it after every 64 recipes it builds), and
    // a slice may end anywhere in a row: everything the dithering methods carry from pixel to pixel is in the error
    // rows and recipe table, which are members.
    bool step(bool timed, double deadline) {
        // The hot loops read these through local pointers: the output is written through a uint8_t pointer, which could
        // alias the job's own fields, so reading them through `this` would reload them after every pixel.
        const uint8_t* const image = this->image_data;
        const PixelLayout L = this->L;
        const size_t increment = size_t(L.stride);
        // A reference, not a copy: a local copy let its body be inlined at every call site below (4 KB of WebAssembly)
        // for no measured speed.
        const PixelSink& emit = this->emit;
        const ColorCoordinates space = this->space;
        const size_t start = this->cursor;
        const Point* const points = this->points.data();
        const size_t count = this->points.size();
        const uint32_t* const keys = this->keys.data();
        const int32_t* const first = this->first.data();
        uint32_t* const memo_keys = this->memo_keys.data();
        int32_t* const memo_values = this->memo_values.data();
        const bool small = this->small;
        AgglomerativeClustering::PaletteIndex& cells = this->cells;
        const AgglomerativeClustering::KDTree& tree = this->tree;
        const bool rgb = this->color_space == ColorSpace::rgb;
        const int skip_below = this->skip_below;
        const size_t width = this->width;

        auto lookup = [&](const Point& target) {return small ? cells.get_nearest(target) : tree.get_nearest(target);};
        // Lookups give distinct-colour indices (see `first`); `palette_index` turns one into the caller's palette index.
        auto palette_index = [&](int32_t u) {return u < 0 ? u : first[size_t(u)];};
        // Without dithering nothing but the output reads the memo, so it holds palette indices; with it, distinct-colour indices.
        const bool direct = this->method == Method::plain;
        auto nearest_index = [&](uint8_t r, uint8_t g, uint8_t b) {
            uint32_t key = (uint32_t(r) << 16) | (uint32_t(g) << 8) | uint32_t(b);
            uint32_t slot = (key * 0x9E3779B1u) >> (32 - memo_bits);
            if (memo_keys[slot] != key) {
                memo_keys[slot] = key;
                const int32_t u = lookup(space.match(r, g, b));
                memo_values[slot] = direct ? palette_index(u) : u;
            }
            return memo_values[slot];
        };

        if (this->method == Method::plain) {
            constexpr size_t check = 16384;
            const size_t pixels = this->pixels;
            if (emit.colours && count > 0 && L.stride == 4) {
                // Four-byte pixels (RGBA, BGRA, RGBX, BGRX) to mapped output: the memo is keyed by the pixel's first three bytes as they lie (no
                // reordering) and holds the output pixel itself, so a hit is one compare, a load, and a store with the alpha byte put back.
                struct Memo {uint32_t raw; uint32_t out;};
                std::vector<Memo> table(size_t(1) << memo_bits, Memo{0xFFFFFFFFu, 0u});
                Memo* const memo = table.data();
                uint8_t* const output = emit.output;
                const int ro = L.r, bo = L.b;
                const uint32_t alpha_mask = L.alpha ? 0xFF000000u : 0u, opaque_bits = L.opaque ? 0xFF000000u : 0u;
                for (size_t p = start; p < pixels; p++) {
                    if (timed && p > start && (p & (check - 1)) == 0 && emscripten_get_now() >= deadline) {this->cursor = p; return false;}
                    uint32_t v;
                    std::memcpy(&v, image + p * 4, 4);
                    const uint32_t raw = v & 0x00FFFFFFu;
                    Memo& entry = memo[(raw * 0x9E3779B1u) >> (32 - memo_bits)];
                    if (entry.raw != raw) {
                        const int32_t u = lookup(space.match(uint8_t(raw >> (8 * ro)), uint8_t(raw >> 8), uint8_t(raw >> (8 * bo))));
                        const uint32_t key = keys[size_t(u)];
                        entry.raw = raw;
                        entry.out = (((key >> 16) & 0xFFu) << (8 * ro)) | (((key >> 8) & 0xFFu) << 8) | ((key & 0xFFu) << (8 * bo)) | opaque_bits;
                    }
                    const uint32_t out = entry.out | (v & alpha_mask);
                    std::memcpy(output + p * 4, &out, 4);
                }
                this->cursor = this->pixels;
                return true;
            }
            if (emit.colours && count > 0) {
                // Mapped output with a palette: written here, the sink's writes done inline (every pixel went through its call).
                const uint8_t* const palette = emit.palette;
                uint8_t* const output = emit.output;
                const int ro = L.r, bo = L.b;
                const bool opaque = L.opaque, has_alpha = L.alpha;
                for (size_t p = start; p < pixels; p++) {
                    if (timed && p > start && (p & (check - 1)) == 0 && emscripten_get_now() >= deadline) {this->cursor = p; return false;}
                    const uint8_t* pixel = image + p * increment;
                    const uint8_t* colour = palette + 3 * size_t(nearest_index(pixel[ro], pixel[1], pixel[bo]));
                    uint8_t* out = output + p * increment;
                    out[ro] = colour[0];
                    out[1] = colour[1];
                    out[bo] = colour[2];
                    if (opaque) {out[3] = 255;} else if (has_alpha) {out[3] = pixel[3];}
                }
                this->cursor = this->pixels;
                return true;
            }
            for (size_t p = start; p < pixels; p++) {
                if (timed && p > start && (p & (check - 1)) == 0 && emscripten_get_now() >= deadline) {this->cursor = p; return false;}
                const uint8_t* pixel = image + p * increment;
                emit(p, nearest_index(pixel[L.r], pixel[1], pixel[L.b]));
            }
            this->cursor = this->pixels;
            return true;
        }

        const float strength = this->strength, limit = this->limit, near = this->near, most = this->most;
        const size_t height = this->height;
        // Whether a slice should end before the pixel `done` pixels into the image (see step's comment).
        constexpr size_t check = 1024;
        auto stop = [&](size_t done) {return timed && done > start && (done & (check - 1)) == 0 && emscripten_get_now() >= deadline;};
        uint32_t* const match_keys = this->match_keys.data();
        Point* const match_values = this->match_values.data();
        auto nearest_outside = [&](const float* wanted) {
            int32_t best = 0;
            double best_distance = std::numeric_limits<double>::infinity();
            for (size_t i = 0; i < count; i++) {
                double distance = 0.0;
                for (int c = 0; c < 3; c++) {
                    const double d = double(wanted[c]) - double(points[i][c]);
                    distance += d * d;
                }
                // Exact ties go to the smaller packed RGB key, as in the indexes (and the first of equal entries).
                if (distance < best_distance || (distance == best_distance && keys[i] < keys[best])) {
                    best = int32_t(i);
                    best_distance = distance;
                }
            }
            return best;
        };
        auto match = [&](uint8_t r, uint8_t g, uint8_t b) -> Point {
            if (rgb) {return {r, g, b};}
            uint32_t key = (uint32_t(r) << 16) | (uint32_t(g) << 8) | uint32_t(b);
            uint32_t slot = (key * 0x9E3779B1u) >> (32 - memo_bits);
            if (match_keys[slot] != key) {
                match_keys[slot] = key;
                match_values[slot] = space.match(r, g, b);
            }
            return match_values[slot];
        };
        // The colour a pixel should take is its own plus the error it was given, that error limited in length (see
        // `most`). Clears the error once read.
        auto carry = [&](const Point& base, float* e, float* wanted) {
            const float length = std::sqrt(e[0] * e[0] + e[1] * e[1] + e[2] * e[2]);
            const float scale = length > most ? most / length : 1.0f;
            for (int c = 0; c < 3; c++) {
                wanted[c] = float(base[c]) + e[c] * scale;
                e[c] = 0.0f;
            }
        };
        // The distinct-colour index nearest a wanted colour in matching coordinates, by the rule described in the
        // constructor: near the cube it is clamped to the cube (in place, so the error left over is measured from the
        // clamped colour) and looked up in the index; further out it is matched exactly, unclamped. Every method picks
        // its colours through this.
        auto pick = [&](float* wanted) -> int32_t {
            bool outside = false;
            for (int c = 0; c < 3; c++) {
                if (wanted[c] < -near || wanted[c] > limit + near) {outside = true;}
            }
            if (outside) {return nearest_outside(wanted);}
            Point target;
            for (int c = 0; c < 3; c++) {
                wanted[c] = std::clamp(wanted[c], 0.0f, limit);
                target[c] = uint16_t(round_nonnegative(wanted[c]));
            }
            return rgb ? nearest_index(uint8_t(target[0]), uint8_t(target[1]), uint8_t(target[2])) : lookup(target);
        };

        if (this->method == Method::ordered) {
            // Ordered (pattern) dithering, after Knoll: each colour gets a recipe of `steps` palette entries whose average
            // is close to it, built by picking the entry nearest the colour plus the error carried so far, `steps` times.
            // The recipe is sorted dark to light, and a pixel takes the entry its cell in an 8x8 Bayer matrix points to,
            // so two colours blend in steps + 1 shades. A pixel's colour depends only on its own colour and position, so
            // a still area of an animation dithers the same way in every frame, whatever changes elsewhere.
            static constexpr uint8_t bayer[8][8] = {
                { 0, 32,  8, 40,  2, 34, 10, 42}, {48, 16, 56, 24, 50, 18, 58, 26},
                {12, 44,  4, 36, 14, 46,  6, 38}, {60, 28, 52, 20, 62, 30, 54, 22},
                { 3, 35, 11, 43,  1, 33,  9, 41}, {51, 19, 59, 27, 49, 17, 57, 25},
                {15, 47,  7, 39, 13, 45,  5, 37}, {63, 31, 55, 23, 61, 29, 53, 21}};
            const size_t steps = this->steps;
            const float recipe_strength = this->recipe_strength;
            const int recipe_bits = this->recipe_bits;
            uint32_t* const recipe_keys = this->recipe_keys.data();
            int32_t* const recipes = this->recipes.data();
            const uint64_t* const brightness = this->brightness.data();
            const bool scan = this->scan;
            const size_t groups = this->groups;
            const i32x4* const scan_r = this->scan_r.data();
            const i32x4* const scan_g = this->scan_g.data();
            const i32x4* const scan_b = this->scan_b.data();
            const int32_t* const scan_index = this->scan_index.data();
            auto darker = [&](int32_t a, int32_t b) {return brightness[size_t(a)] < brightness[size_t(b)];};
            // Inlined by force here and in pick_recipe: in a function this size the compiler kept them out of line, and
            // ordered dithering at 16 colours took 7% longer than when map_pixels was one function (3.6.0).
            auto scan_nearest = [&](const int32_t* target) __attribute__((always_inline)) -> int32_t {
                const i32x4 tr = {target[0], target[0], target[0], target[0]};
                const i32x4 tg = {target[1], target[1], target[1], target[1]};
                const i32x4 tb = {target[2], target[2], target[2], target[2]};
                i32x4 best = {INT32_MAX, INT32_MAX, INT32_MAX, INT32_MAX};
                i32x4 best_group = {0, 0, 0, 0};
                for (size_t g = 0; g < groups; g++) {
                    const i32x4 dr = scan_r[g] - tr, dg = scan_g[g] - tg, db = scan_b[g] - tb;
                    const i32x4 distance = dr * dr + dg * dg + db * db;
                    const i32x4 nearer = distance < best;
                    best = nearer ? distance : best;
                    const int32_t gi = int32_t(g);
                    const i32x4 here = {gi, gi, gi, gi};
                    best_group = nearer ? here : best_group;
                }
                size_t chosen = 0;
                int32_t chosen_distance = INT32_MAX;
                for (int lane = 0; lane < 4; lane++) {
                    const size_t position = size_t(best_group[lane]) * 4 + size_t(lane);
                    if (best[lane] < chosen_distance || (best[lane] == chosen_distance && position < chosen)) {
                        chosen_distance = best[lane];
                        chosen = position;
                    }
                }
                return scan_index[chosen];
            };
            auto pick_recipe = [&](float* wanted) __attribute__((always_inline)) -> int32_t {
                if (!scan) {return pick(wanted);}
                bool outside = false;
                for (int c = 0; c < 3; c++) {
                    if (wanted[c] < -near || wanted[c] > limit + near) {outside = true;}
                }
                int32_t target[3];
                if (outside) {
                    // Far outside the cube the target is matched as it is, unclamped (see `pick`). At full strength it is
                    // a whole number (whole colours plus whole errors), and then the scan's integer distances are the
                    // exact ones nearest_outside computes in doubles, as long as they fit in 32 bits: a target within
                    // 20,000 of the cube keeps every squared distance under 1.3 billion.
                    for (int c = 0; c < 3; c++) {
                        const float whole = std::nearbyint(wanted[c]);
                        if (whole != wanted[c] || std::fabs(whole) > 20000.0f) {return nearest_outside(wanted);}
                        target[c] = int32_t(whole);
                    }
                    return scan_nearest(target);
                }
                for (int c = 0; c < 3; c++) {
                    wanted[c] = std::clamp(wanted[c], 0.0f, limit);
                    target[c] = round_nonnegative(wanted[c]);
                }
                return scan_nearest(target);
            };
            // A recipe of many steps over a large palette can take tens of microseconds, so the clock is also read after
            // every 64 recipes built.
            size_t built = 0;
            for (size_t y = start / width; y < height; y++) {
                for (size_t x = y == start / width ? start % width : 0; x < width; x++) {
                    const size_t p = y * width + x;
                    if (stop(p)) {this->cursor = p; return false;}
                    const uint8_t* pixel = image + p * increment;
                    if (L.alpha && pixel[3] < skip_below) {
                        emit(p, palette_index(nearest_index(pixel[L.r], pixel[1], pixel[L.b])));
                        continue;
                    }
                    const uint32_t key = (uint32_t(pixel[L.r]) << 16) | (uint32_t(pixel[1]) << 8) | uint32_t(pixel[L.b]);
                    const uint32_t slot = (key * 0x9E3779B1u) >> (32 - recipe_bits);
                    int32_t* recipe = &recipes[size_t(slot) * steps];
                    if (recipe_keys[slot] != key) {
                        recipe_keys[slot] = key;
                        const Point base = match(pixel[L.r], pixel[1], pixel[L.b]);
                        float e[3] = {0.0f, 0.0f, 0.0f};
                        for (size_t i = 0; i < steps; i++) {
                            float wanted[3];
                            for (int c = 0; c < 3; c++) {wanted[c] = float(base[c]) + e[c] * recipe_strength;}
                            const int32_t chosen = pick_recipe(wanted);
                            recipe[i] = chosen;
                            for (int c = 0; c < 3; c++) {e[c] += float(base[c]) - float(points[size_t(chosen)][c]);}
                        }
                        AgglomerativeClustering::insertion_sort(recipe, steps, darker);
                        if (timed && (++built & 63) == 0 && emscripten_get_now() >= deadline) {
                            emit(p, palette_index(recipe[size_t(bayer[y & 7][x & 7]) * steps / 64]));
                            this->cursor = p + 1;
                            return false;
                        }
                    }
                    emit(p, palette_index(recipe[size_t(bayer[y & 7][x & 7]) * steps / 64]));
                }
            }
            this->cursor = this->pixels;
            return true;
        }

        if (this->method == Method::atkinson) {
            // Atkinson: serpentine like Floyd-Steinberg, but 1/8 of the error goes to each of six neighbours (two ahead,
            // three on the next row, one two rows down) and the remaining quarter is dropped, which keeps highlights and
            // shadows clean.
            const size_t stride = this->atkinson_stride;
            float* const rows = this->rows.data();
            for (size_t y = start / width; y < height; y++) {
                float* row0 = &rows[(y % 3) * stride];
                float* row1 = &rows[((y + 1) % 3) * stride];
                float* row2 = &rows[((y + 2) % 3) * stride];
                const bool forward = y % 2 == 0;
                for (size_t i = y == start / width ? start % width : 0; i < width; i++) {
                    if (stop(y * width + i)) {this->cursor = y * width + i; return false;}
                    const size_t x = forward ? i : width - 1 - i;
                    const size_t p = y * width + x;
                    const uint8_t* pixel = image + p * increment;
                    float* e = &row0[3 * (x + 2)];
                    if (L.alpha && pixel[3] < skip_below) {
                        emit(p, palette_index(nearest_index(pixel[L.r], pixel[1], pixel[L.b])));
                        for (int c = 0; c < 3; c++) {e[c] = 0.0f;}
                        continue;
                    }
                    float wanted[3];
                    carry(match(pixel[L.r], pixel[1], pixel[L.b]), e, wanted);
                    const int32_t index = pick(wanted);
                    emit(p, palette_index(index));
                    const ptrdiff_t ahead = forward ? 3 : -3;
                    float* below = &row1[3 * (x + 2)];
                    float* under = &row2[3 * (x + 2)];
                    for (int c = 0; c < 3; c++) {
                        const float error = (wanted[c] - float(points[index][c])) * strength * (1.0f / 8.0f);
                        e[c + ahead] += error;
                        e[c + 2 * ahead] += error;
                        below[c - ahead] += error;
                        below[c] += error;
                        below[c + ahead] += error;
                        under[c] += error;
                    }
                }
                std::fill(row0, row0 + stride, 0.0f);
            }
            this->cursor = this->pixels;
            return true;
        }

        // Floyd-Steinberg, serpentine.
        for (size_t y = start / width; y < height; y++) {
            const bool forward = y % 2 == 0;
            float* const current = this->current.data();
            float* const next = this->next.data();
            for (size_t i = y == start / width ? start % width : 0; i < width; i++) {
                if (stop(y * width + i)) {this->cursor = y * width + i; return false;}
                const size_t x = forward ? i : width - 1 - i;
                const size_t p = y * width + x;
                const uint8_t* pixel = image + p * increment;
                float* e = &current[3 * (x + 1)];
                // Transparent pixels (alpha below `skip_below`) neither take error nor pass any on: their colour isn't seen.
                if (L.alpha && pixel[3] < skip_below) {
                    emit(p, palette_index(nearest_index(pixel[L.r], pixel[1], pixel[L.b])));
                    for (int c = 0; c < 3; c++) {e[c] = 0.0f;}
                    continue;
                }
                // Error is carried in the matching coordinates (8-bit RGB values, or OKLab), so the colour chosen
                // is the one that best cancels it; mixing spaces lets error pile up into streaks.
                const Point base = match(pixel[L.r], pixel[1], pixel[L.b]);
                float wanted[3];
                carry(base, e, wanted);
                const int32_t index = pick(wanted);
                emit(p, palette_index(index));
                const ptrdiff_t ahead = forward ? 3 : -3;
                float* below = &next[3 * (x + 1)];
                for (int c = 0; c < 3; c++) {
                    float error = (wanted[c] - float(points[index][c])) * strength;
                    e[c + ahead] += error * (7.0f / 16.0f);
                    below[c - ahead] += error * (3.0f / 16.0f);
                    below[c] += error * (5.0f / 16.0f);
                    below[c + ahead] += error * (1.0f / 16.0f);
                }
            }
            std::swap(this->current, this->next);
            std::fill(this->next.begin(), this->next.end(), 0.0f);
        }
        this->cursor = this->pixels;
        return true;
    }

};

// What a mapping call returns, made in slices: the output buffer (length-prefixed, see allocate_variable_size), what
// the indexed header needs, and the job that fills it. `colours` chooses _quantize's output (the mapped image, in the
// input's format with alpha preserved; black for an empty palette) or _quantize_indices' (see there). The image must
// stay allocated until the mapping is done.
class MappingTask {

    std::vector<uint8_t> entries;  // the palette (for indices, with any added entries); it must outlive the job
    uint8_t* packed = nullptr;
    std::unique_ptr<MappingJob> job;

public:

    MappingTask(bool colours, const uint8_t* image_data, int image_length, int image_format, const uint8_t* palette, size_t palette_length, ColorSpace color_space, double dither, int dither_method, int dither_steps, int width, int cutoff) {
        const PixelLayout L = layout_of(image_format);
        const size_t pixels = image_length > 0 ? static_cast<size_t>(image_length) / L.stride : 0;
        if (colours) {
            // Its own copy of the palette, which the output's colours are read from, so the caller's can go.
            this->entries.assign(palette, palette + palette_length);
            this->packed = allocate_variable_size(pixels * size_t(L.stride));
            const PixelSink sink = {true, L, image_data, this->packed + 4, this->entries.data(), 0, 0, false, -1};
            this->job.reset(new MappingJob(image_data, image_length, image_format, this->entries.data(), palette_length, color_space, dither, dither_method, dither_steps, width, 1, sink));
            return;
        }
        // Each pixel's palette index instead of its colour. The length-prefixed payload is [entries (u32), transparent
        // index (i32, -1 for none), index bytes (u32)], then the palette (3 bytes per entry), then one little-endian index
        // of `index bytes` (1, 2 or 4) per pixel. With a `cutoff` (1-255) and input with alpha (RGBA or BGRA) that has
        // pixels with alpha below it, those pixels get an extra black entry appended after the palette, which takes no
        // part in matching (the callers cut the palette one colour smaller to make room, see colours_for_entries: `k`
        // counts the entries of the result); every other pixel maps to its nearest colour, fully opaque. Without one
        // (0), all pixels map to their nearest colour like any other pixel. An empty palette stays empty unless some
        // pixel needs an entry to point at, in which case it becomes a single black entry, as _quantize maps it: so an
        // empty image has an empty palette, and a fully transparent image with a cutoff has just the transparent entry
        // (index 0).
        this->entries.assign(palette, palette + palette_length / 3 * 3);
        bool transparent = false;
        if (cutoff > 0 && L.alpha) {
            for (size_t p = 0; p < pixels && !transparent; p++) {transparent = image_data[p * 4 + 3] < cutoff;}
        }
        bool needs_entry = false;
        for (size_t p = 0; p < pixels && !needs_entry; p++) {needs_entry = !(transparent && image_data[p * 4 + 3] < cutoff);}
        if (this->entries.empty() && needs_entry) {this->entries.assign(3, 0);}
        const size_t colour_count = this->entries.size() / 3;
        const int32_t transparent_index = transparent ? int32_t(colour_count) : -1;
        if (transparent) {this->entries.insert(this->entries.end(), 3, 0);}
        const size_t count = this->entries.size() / 3;
        const uint32_t index_bytes = count <= 256 ? 1 : count <= 65536 ? 2 : 4;

        const size_t header = 12;
        this->packed = allocate_variable_size(header + this->entries.size() + pixels * index_bytes);
        uint8_t* output = this->packed + 4;
        auto write32 = [](uint8_t* at, uint32_t value) {for (int b = 0; b < 4; b++) {at[b] = (value >> (8 * b)) & 0xFF;}};
        write32(output, uint32_t(count));
        write32(output + 4, uint32_t(transparent_index));
        write32(output + 8, index_bytes);
        if (!this->entries.empty()) {std::memcpy(output + header, this->entries.data(), this->entries.size());}
        uint8_t* indices = output + header + this->entries.size();

        const PixelSink sink = {false, L, image_data, indices, nullptr, index_bytes, cutoff, transparent, transparent_index};
        this->job.reset(new MappingJob(image_data, image_length, image_format, this->entries.data(), colour_count * 3, color_space, dither, dither_method, dither_steps, width, transparent ? cutoff : 1, sink));
    }

    ~MappingTask() {free(this->packed);}

    bool step(bool timed, double deadline) {return this->job->step(timed, deadline);}
    int progress() const {return this->job->progress();}

    // The output, which the caller frees. Only once the mapping is done.
    uint8_t* take() {
        uint8_t* result = this->packed;
        this->packed = nullptr;
        return result;
    }

};

// Maps the image to the palette in one go (see MappingTask).
uint8_t* _quantize(const uint8_t* image_data, int image_length, int image_format, const uint8_t* palette, size_t palette_length, ColorSpace color_space, double dither, int dither_method, int dither_steps, int width) {
    MappingTask task(true, image_data, image_length, image_format, palette, palette_length, color_space, dither, dither_method, dither_steps, width, 0);
    task.step(false, 0);
    return task.take();
}

// Whether indexed output with this cutoff will have a transparent entry: the image has alpha and some pixel is below it.
bool has_transparent_entry(const uint8_t* image_data, int image_length, int image_format, int cutoff) {
    if (cutoff <= 0 || !layout_of(image_format).alpha || image_length < 4) {return false;}
    for (size_t p = 0; p + 3 < size_t(image_length); p += 4) {if (image_data[p + 3] < cutoff) {return true;}}
    return false;
}

// The palette size to cut to so the indexed result has `k` entries in all: the transparent entry counts towards `k`, so a
// GIF or palette PNG asking for 256 gets 256, not 257. At least one colour is always kept.
int colours_for_entries(const uint8_t* image_data, int image_length, int image_format, int cutoff, int k) {
    return has_transparent_entry(image_data, image_length, image_format, cutoff) ? std::max(1, k - 1) : k;
}

// Maps the image to the palette in one go and returns each pixel's palette index (see MappingTask for the layout).
uint8_t* _quantize_indices(const uint8_t* image_data, int image_length, int image_format, const uint8_t* palette, size_t palette_length, ColorSpace color_space, double dither, int dither_method, int dither_steps, int width, int cutoff) {
    MappingTask task(false, image_data, image_length, image_format, palette, palette_length, color_space, dither, dither_method, dither_steps, width, cutoff);
    task.step(false, 0);
    return task.take();
}

extern "C" {

// The library version this module was built for, as a NUL-terminated string. The JavaScript checks it against its own when
// the module loads, so a .wasm left over from another version (a stale cache or CDN copy) is reported, not run.
EMSCRIPTEN_KEEPALIVE
const char* library_version() {
    return AGGLOMERATIVE_CLUSTERING_VERSION;
}

// Premultiplied pixels, converted in place on the heap copy of an image (the caller's array is never touched). Both work on 4-byte
// pixels [start, end) with alpha in byte 3, so they serve RGBA and BGRA alike; alpha 255 is skipped and alpha is never changed.
// A 256 x 256 table per direction (table[alpha][channel]), built on first use: 17-18 ms for 12 MP with every alpha present,
// against 27-52 ms with integer division (bench/spikes/premultiplied/).
// unpremultiply: min(255, round(c * 255 / a)), alpha 0 as black. premultiply: round(c * a / 255).
static uint8_t* premultiply_table(bool undo) {
    static uint8_t* tables[2] = {nullptr, nullptr};
    uint8_t*& table = tables[undo ? 1 : 0];
    if (!table) {
        table = static_cast<uint8_t*>(std::malloc(256 * 256));
        for (unsigned a = 0; a < 256; a++) {
            for (unsigned c = 0; c < 256; c++) {
                unsigned v = undo ? (a == 0 ? 0 : (c * 255u + a / 2) / a) : (c * a + 127) / 255;
                table[a * 256 + c] = uint8_t(v > 255 ? 255 : v);
            }
        }
    }
    return table;
}

static void convert_pixels(uint8_t* pixels, uint32_t start, uint32_t end, bool undo) {
    const uint8_t* table = premultiply_table(undo);
    for (uint8_t* p = pixels + size_t(start) * 4, *stop = pixels + size_t(end) * 4; p < stop; p += 4) {
        const unsigned a = p[3];
        if (a == 255) {continue;}
        const uint8_t* t = table + a * 256;
        p[0] = t[p[0]]; p[1] = t[p[1]]; p[2] = t[p[2]];
    }
}

EMSCRIPTEN_KEEPALIVE
void unpremultiply(uint8_t* pixels, uint32_t start, uint32_t end) {
    convert_pixels(pixels, start, end, true);
}

EMSCRIPTEN_KEEPALIVE
void premultiply(uint8_t* pixels, uint32_t start, uint32_t end) {
    convert_pixels(pixels, start, end, false);
}

// A clustering run in slices (see ClusteringJob): start it, step it until it returns 1000, take the result, free it.
// The image must stay allocated until the job has finished.
EMSCRIPTEN_KEEPALIVE
ClusteringJob* clustering_job_start(uint8_t* image_data, int image_length, int image_format, int color_space, int precision, int weight_alpha, int transparent) {
    return new ClusteringJob(image_data, image_length, image_format, ColorSpace(color_space), precision, weight_alpha != 0, transparent);
}

// Runs for about `budget_ms` milliseconds; returns 1000 when finished, else the progress so far (0 to 999).
EMSCRIPTEN_KEEPALIVE
int clustering_job_step(ClusteringJob* job, double budget_ms) {
    return job->step(budget_ms) ? 1000 : std::min(999, job->progress());
}

EMSCRIPTEN_KEEPALIVE
uint8_t* clustering_job_result(ClusteringJob* job) {
    std::vector<uint8_t> clustering = job->take();
    return pack_variable_size(clustering);
}

EMSCRIPTEN_KEEPALIVE
void clustering_job_free(ClusteringJob* job) {
    delete job;
}

// A mapping run in slices (see MappingJob): start it, step it until it returns 1000, take the result, free it. The
// palette is given (`palette_data`) or, when `clustering_data` isn't null, cut from that clustering to `k` colours (for
// indexed output `k` counts the transparent entry, see colours_for_entries), and a negative `color_space` then matches
// in the clustering's space. `indices` 0 gives _quantize's output, 1 _quantize_indices' (with `cutoff`). Returns null
// when the clustering's records don't fit together. The image must stay allocated until the job is done.
EMSCRIPTEN_KEEPALIVE
MappingTask* mapping_job_start(const uint8_t* image_data, int image_length, int image_format, const uint8_t* palette_data, int palette_length, const uint8_t* clustering_data, int clustering_length, int k, int color_space, double dither, int dither_method, int dither_steps, int width, int indices, int cutoff) {
    std::vector<uint8_t> palette;
    ColorSpace space = ColorSpace(color_space < 0 ? 0 : color_space);
    if (clustering_data) {
        bool valid = false;
        palette = _get_palette_from_clustering(clustering_data, size_t(clustering_length), indices ? colours_for_entries(image_data, image_length, image_format, cutoff, k) : k, valid);
        if (!valid) {return nullptr;}
        if (color_space < 0) {space = read_clustering(clustering_data, size_t(clustering_length)).color_space;}
    } else {
        palette.assign(palette_data, palette_data + (palette_length > 0 ? palette_length : 0));
    }
    return new MappingTask(indices == 0, image_data, image_length, image_format, palette.data(), palette.size(), space, dither, dither_method, dither_steps, width, cutoff);
}

// Maps for about `budget_ms` milliseconds; returns 1000 when finished, else the progress so far (0 to 999).
EMSCRIPTEN_KEEPALIVE
int mapping_job_step(MappingTask* task, double budget_ms) {
    return task->step(true, emscripten_get_now() + budget_ms) ? 1000 : task->progress();
}

EMSCRIPTEN_KEEPALIVE
uint8_t* mapping_job_result(MappingTask* task) {
    return task->take();
}

EMSCRIPTEN_KEEPALIVE
void mapping_job_free(MappingTask* task) {
    delete task;
}

EMSCRIPTEN_KEEPALIVE
uint8_t* get_clustering(uint8_t* image_data, int image_length, int image_format, int color_space, int precision, int weight_alpha, int transparent) {
    std::vector<uint8_t> clustering = _get_clustering(image_data, image_length, image_format, ColorSpace(color_space), precision, weight_alpha != 0, transparent);
    return pack_variable_size(clustering);
}

EMSCRIPTEN_KEEPALIVE
uint8_t* get_palette(uint8_t* image_data, int image_length, int image_format, int k, int color_space, int precision, int weight_alpha, int transparent) {
    std::vector<uint8_t> clustering = _get_clustering(image_data, image_length, image_format, ColorSpace(color_space), precision, weight_alpha != 0, transparent);
    bool valid = false;
    std::vector<uint8_t> palette = _get_palette_from_clustering(clustering.data(), clustering.size(), k, valid);
    // Made a moment ago, so it is valid; if the check ever disagreed, the caller hears of it rather than getting an empty palette.
    if (!valid) {return nullptr;}
    return pack_variable_size(palette);
}

EMSCRIPTEN_KEEPALIVE
uint8_t* get_palette_from_clustering(uint8_t* clustering_data, int clustering_length, int k) {
    bool valid = false;
    std::vector<uint8_t> palette = _get_palette_from_clustering(clustering_data, clustering_length, k, valid);
    if (!valid) {return nullptr;}
    return pack_variable_size(palette);
}

EMSCRIPTEN_KEEPALIVE
uint8_t* get_palette_weights(uint8_t* clustering_data, int clustering_length, int k) {
    std::vector<double> weights = _get_palette_weights(clustering_data, clustering_length, k);
    uint8_t* output = allocate_variable_size(weights.size() * sizeof(double));
    if (!weights.empty()) {std::memcpy(output + 4, weights.data(), weights.size() * sizeof(double));}
    return output;
}

EMSCRIPTEN_KEEPALIVE
uint8_t* quantize(uint8_t* image_data, int image_length, int image_format, int k, int color_space, int precision, int weight_alpha, double dither, int dither_method, int dither_steps, int width, int transparent) {
    std::vector<uint8_t> clustering = _get_clustering(image_data, image_length, image_format, ColorSpace(color_space), precision, weight_alpha != 0, transparent);
    bool valid = false;
    std::vector<uint8_t> palette = _get_palette_from_clustering(clustering.data(), clustering.size(), k, valid);
    // Made a moment ago, so it is valid; if the check ever disagreed, the caller hears of it rather than getting an empty palette.
    if (!valid) {return nullptr;}
    return _quantize(image_data, image_length, image_format, palette.data(), palette.size(), ColorSpace(color_space), dither, dither_method, dither_steps, width);
}

EMSCRIPTEN_KEEPALIVE
// A negative `color_space` matches in the space the clustering was made in.
uint8_t* quantize_with_clustering(uint8_t* image_data, int image_length, int image_format, uint8_t* clustering_data, int clustering_length, int k, int color_space, double dither, int dither_method, int dither_steps, int width) {
    bool valid = false;
    std::vector<uint8_t> palette = _get_palette_from_clustering(clustering_data, clustering_length, k, valid);
    if (!valid) {return nullptr;}
    ColorSpace space = color_space < 0 ? read_clustering(clustering_data, clustering_length).color_space : ColorSpace(color_space);
    return _quantize(image_data, image_length, image_format, palette.data(), palette.size(), space, dither, dither_method, dither_steps, width);
}

EMSCRIPTEN_KEEPALIVE
uint8_t* quantize_with_palette(uint8_t* image_data, int image_length, int image_format, uint8_t* palette_data, int palette_length, int color_space, double dither, int dither_method, int dither_steps, int width) {
    return _quantize(image_data, image_length, image_format, palette_data, palette_length, ColorSpace(color_space), dither, dither_method, dither_steps, width);
}

EMSCRIPTEN_KEEPALIVE
uint8_t* quantize_indices(uint8_t* image_data, int image_length, int image_format, int k, int color_space, int precision, int weight_alpha, double dither, int dither_method, int dither_steps, int width, int transparent) {
    std::vector<uint8_t> clustering = _get_clustering(image_data, image_length, image_format, ColorSpace(color_space), precision, weight_alpha != 0, transparent);
    bool valid = false;
    std::vector<uint8_t> palette = _get_palette_from_clustering(clustering.data(), clustering.size(), colours_for_entries(image_data, image_length, image_format, transparent, k), valid);
    // Made a moment ago, so it is valid; if the check ever disagreed, the caller hears of it rather than getting an empty palette.
    if (!valid) {return nullptr;}
    return _quantize_indices(image_data, image_length, image_format, palette.data(), palette.size(), ColorSpace(color_space), dither, dither_method, dither_steps, width, transparent);
}

EMSCRIPTEN_KEEPALIVE
// A negative `color_space` matches in the space the clustering was made in.
uint8_t* quantize_indices_with_clustering(uint8_t* image_data, int image_length, int image_format, uint8_t* clustering_data, int clustering_length, int k, int color_space, double dither, int dither_method, int dither_steps, int width, int transparent) {
    bool valid = false;
    std::vector<uint8_t> palette = _get_palette_from_clustering(clustering_data, clustering_length, colours_for_entries(image_data, image_length, image_format, transparent, k), valid);
    if (!valid) {return nullptr;}
    ColorSpace space = color_space < 0 ? read_clustering(clustering_data, clustering_length).color_space : ColorSpace(color_space);
    return _quantize_indices(image_data, image_length, image_format, palette.data(), palette.size(), space, dither, dither_method, dither_steps, width, transparent);
}

EMSCRIPTEN_KEEPALIVE
uint8_t* quantize_indices_with_palette(uint8_t* image_data, int image_length, int image_format, uint8_t* palette_data, int palette_length, int color_space, double dither, int dither_method, int dither_steps, int width, int transparent) {
    return _quantize_indices(image_data, image_length, image_format, palette_data, palette_length, ColorSpace(color_space), dither, dither_method, dither_steps, width, transparent);
}

}