// Hierarchical Agglomerative Color Clustering (Ward's method)
#include "clustering.hpp"
#include "colorspace.hpp"
#include "version.hpp"
#include <emscripten.h>
#include <cstdlib>
#include <cstring>
#include <vector>
#include <cmath>
#include <unordered_map>
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
    std::memcpy(output + 4, vector.data(), vector.size() * sizeof(uint8_t));
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
uint32_t clustering_crc(const uint8_t* data, size_t length) {
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
    uint32_t crc = 0xFFFFFFFFu;
    for (size_t i = 0; i < length; i++) {
        const uint8_t byte = i >= clustering_checksum && i < clustering_checksum + 4 ? 0 : data[i];
        crc = table[(crc ^ byte) & 0xFF] ^ (crc >> 8);
    }
    return crc ^ 0xFFFFFFFFu;
}

// Clusters the image's colours in `color_space`. With `weight_alpha`, an RGBA pixel counts in proportion to its
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
        : image_data(image_data), image_format(image_format), color_space(color_space), precision(precision), cutoff(cutoff),
          space(color_space), clustering(clustering_header, 0) {
        this->clustering[0] = clustering_magic;
        this->clustering[1] = clustering_version;
        this->clustering[2] = uint8_t(clustering_header);
        this->clustering[3] = uint8_t(clustering_record);
        this->clustering[4] = uint8_t(color_space);
        this->clustering[5] = uint8_t(precision);
        this->limit = image_format == 1 ? int64_t(image_length) - 2 : int64_t(image_length) - 3;
        this->increment = image_format == 1 ? 3 : 4;
        // With a cutoff (RGBA only), pixels with alpha below it are left out and the rest count whole: it is the
        // indexed-output model, where a pixel is either transparent or fully shown.
        this->binary = cutoff > 0 && image_format == 0;
        this->weight_alpha = weight_alpha && image_format == 0 && !this->binary;
        this->clustering[12] = this->binary ? uint8_t(cutoff) : 0;
    }

    // Runs until the clustering is finished or `budget_ms` milliseconds have passed (checked between small units
    // of work, so a slice can overrun a little). An infinite budget never reads the clock. Returns whether finished.
    bool step(double budget_ms) {
        const bool timed = budget_ms < std::numeric_limits<double>::infinity();
        const double deadline = timed ? emscripten_get_now() + budget_ms : 0.0;
        if (this->stage == Stage::scan && !this->scan(timed, deadline)) {return false;}
        if (this->stage == Stage::build) {this->build();}
        if (this->stage == Stage::chain && !this->merge_some(timed, deadline)) {return false;}
        if (this->stage == Stage::write) {this->write();}
        return this->stage == Stage::done;
    }

    // How far along it is, 0 to 1000 (approximate, and not linear in time). Scanning is the first tenth, building
    // the next twentieth, merging most of the rest, writing the last twentieth.
    int progress() const {
        switch (this->stage) {
            case Stage::scan: return this->limit > 0 ? int(100.0 * double(this->position) / double(this->limit)) : 0;
            case Stage::build: return 100;
            case Stage::chain: return n > 1 ? 150 + int(800.0 * double(this->merges.size()) / double(this->n - 1)) : 150;
            case Stage::write: return 950;
            default: return 1000;
        }
    }

    // The finished clustering, sealed with its checksum.
    std::vector<uint8_t> take() {
        write_u32(&this->clustering[clustering_checksum], clustering_crc(this->clustering.data(), this->clustering.size()));
        return std::move(this->clustering);
    }

private:

    enum class Stage {scan, build, chain, write, done};

    struct Merge {
        double height;
        int32_t merged, a, b;
        double cost;
        uint32_t light;
    };

    const uint8_t* image_data;
    int image_format;
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

    // Building and merging
    size_t n = 0;
    int shift = 0;
    double grouped_error = 0;  // squared error lost by grouping, in unscaled weights times squared coordinates
    std::unique_ptr<AgglomerativeClustering::WardGrid> grid;
    std::vector<Merge> merges;
    std::vector<double> heights;
    std::vector<int32_t> chain;
    int32_t next_start = 0;

    // Pass 1: build the histogram and collect unique colours. Alpha weights are in units of 1/255 of a pixel.
    bool scan(bool timed, double deadline) {
        constexpr int64_t block = 65536;
        while (this->position < this->limit) {
            const int64_t end = std::min(this->limit, this->position + block * this->increment);
            for (; this->position < end; this->position += this->increment) {
                const uint8_t* pixel = this->image_data + this->position;
                uint32_t key = (uint32_t(pixel[0]) << 16) | (uint32_t(pixel[1]) << 8) | uint32_t(pixel[2]);
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

    // From the distinct colours to the grid, one cluster per colour (and the header fields that depend on them).
    void build() {
        std::vector<std::array<uint16_t, 3>> unique_colors;
        std::vector<uint64_t> unique_counts = this->histogram.counts();
        unique_colors.reserve(this->histogram.size());
        for (uint32_t key : this->histogram.colors()) {
            unique_colors.push_back(this->space.cluster(uint8_t(key >> 16), uint8_t(key >> 8), uint8_t(key)));
        }

        // With no partly transparent pixels every weight is a whole number of pixels: count in pixels, so an opaque
        // image (or one with only fully transparent holes) clusters exactly as with alpha ignored.
        if (this->weight_alpha && !this->partial) {
            for (uint64_t& count : unique_counts) {count /= 255u;}
        }
        this->clustering[6] = this->weight_alpha && this->partial ? 1 : 0;

        if (this->precision < 8) {
            const uint32_t channel = (0xFFu << (8 - this->precision)) & 0xFFu;
            const uint32_t mask = (channel << 16) | (channel << 8) | channel;
            AgglomerativeClustering::AgglomerativeHistogram bins;
            std::vector<std::array<uint64_t, 3>> sums;
            const std::vector<std::array<uint16_t, 3>> original_colors = unique_colors;
            const std::vector<uint64_t> original_counts = unique_counts;
            std::vector<uint32_t> bin_of(unique_colors.size());
            for (size_t i = 0; i < unique_colors.size(); i++) {
                uint32_t bin = bins.add(this->histogram.colors()[i] & mask, unique_counts[i]);
                bin_of[i] = bin;
                if (bin == sums.size()) {sums.push_back({0u, 0u, 0u});}
                for (int c = 0; c < 3; c++) {sums[bin][c] += uint64_t(unique_colors[i][c]) * unique_counts[i];}
            }
            unique_colors.resize(bins.size());
            unique_counts = bins.counts();
            for (size_t b = 0; b < bins.size(); b++) {
                for (int c = 0; c < 3; c++) {unique_colors[b][c] = uint16_t(sums[b][c] / unique_counts[b]);}
            }
            // What grouping discarded: each original colour's squared distance to the mean that now stands for it.
            for (size_t i = 0; i < original_colors.size(); i++) {
                double squared = 0;
                for (int c = 0; c < 3; c++) {
                    const double d = double(original_colors[i][c]) - double(unique_colors[bin_of[i]][c]);
                    squared += d * d;
                }
                this->grouped_error += squared * double(original_counts[i]);
            }
        }

        // An image with no visible pixels has no hierarchy: the result is just the header, which cuts to an empty palette.
        this->n = unique_colors.size();
        if (this->n == 0) {this->stage = Stage::done; return;}
        // Pad so the length is 7 more than a multiple of 9, which no 1.x clustering can be.
        size_t length = clustering_header + 3 + clustering_record * (this->n - 1);
        this->clustering.resize(length + (7 + 9 - length % 9) % 9, 0);

        // The grid counts in 32 bits. Weights only exceed that for partly transparent images above ~16.8 MP; scale
        // those down by the smallest power of two that fits, keeping every visible colour at least 1.
        uint64_t total = 0;
        for (uint64_t count : unique_counts) {total += count;}
        while ((total >> this->shift) > std::numeric_limits<uint32_t>::max() / 2u) {this->shift++;}
        this->clustering[7] = uint8_t(this->shift);

        // Pass 2: one cluster per unique colour
        this->grid = std::make_unique<AgglomerativeClustering::WardGrid>(this->n);
        uint32_t total_weight = 0;
        for (size_t i = 0; i < this->n; i++) {
            uint32_t weight = uint32_t(std::max<uint64_t>(unique_counts[i] >> this->shift, 1u));
            this->grid->add(unique_colors[i], weight);
            total_weight += weight;
        }
        write_u32(&this->clustering[8], total_weight);
        this->grid->reindex();

        // Merges come out of the nearest-neighbour chain in chain order, not cost order. A merge's height is its
        // cost, raised to its children's heights where centroid rounding would put it below them, so sorting by
        // height keeps every merge after the merges that formed its clusters.
        this->merges.reserve(this->n - 1);
        this->heights.assign(2 * this->n, 0.0);
        this->stage = Stage::chain;
    }

    // Ward's criterion is reducible, so merging mutual cheapest partners as the chain finds them gives the
    // same hierarchy as always merging the globally cheapest pair.
    bool merge_some(bool timed, double deadline) {
        AgglomerativeClustering::WardGrid& grid = *this->grid;
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
            grid.reindex();

        }
        this->stage = Stage::write;
        return true;
    }

    void write() {
        AgglomerativeClustering::WardGrid& grid = *this->grid;

        // Every cluster (dead ones keep their coordinates) is converted to 8-bit sRGB once: in OKLab that takes
        // three powers, and most clusters appear in two records.
        std::vector<Rgb> rgb(grid.capacity());
        for (int32_t id = 0; id < grid.capacity(); id++) {rgb[id] = this->space.to_rgb(grid.coords(id));}

        // Merged ids increase in chain order, so breaking height ties by them keeps chain order, as a stable sort would.
        std::sort(this->merges.begin(), this->merges.end(), [](const Merge& x, const Merge& y) {return x.height < y.height || (x.height == y.height && x.merged < y.merged);});

        // Costs are converted from 16-bit coordinates to squared 8-bit RGB values or squared OKLab units.
        const double scale = this->color_space == ColorSpace::rgb ? 65535.0 / 255.0 : 65535.0;
        {
            const float grouped = float(this->grouped_error / double(uint64_t(1) << this->shift) / (scale * scale));
            uint32_t bits;
            std::memcpy(&bits, &grouped, 4);
            write_u32(&this->clustering[13], bits);
        }
        // Records go in split order, the reverse of merge order. Each cluster's split-order index: the root is 0,
        // the heavier child keeps its parent's index, and record i's lighter child is i + 1.
        std::vector<uint32_t> index(grid.capacity(), 0);
        for (size_t i = 0; i < this->merges.size(); i++) {
            const Merge& merge = this->merges[this->merges.size() - 1 - i];
            index[merge.a] = index[merge.merged];
            index[merge.b] = uint32_t(i + 1);
            uint8_t* record = &this->clustering[clustering_header + 3 + clustering_record * i];
            write_color(this->clustering, record - this->clustering.data(), rgb[merge.merged]);
            write_color(this->clustering, record - this->clustering.data() + 3, rgb[merge.a]);
            write_color(this->clustering, record - this->clustering.data() + 6, rgb[merge.b]);
            write_u32(record + 9, index[merge.merged]);
            write_u32(record + 13, merge.light);
            float cost = float(merge.cost / (scale * scale));
            uint32_t bits;
            std::memcpy(&bits, &cost, 4);
            write_u32(record + 17, bits);
        }

        // Add the k=1 clustering colour
        write_color(this->clustering, clustering_header, rgb[this->merges.empty() ? 0 : this->merges.back().merged]);
        this->stage = Stage::done;
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

    // Each listed colour's place in `order` and how many current clusters have it.
    struct Entry {size_t slot; uint32_t clusters;};
    std::vector<Color> order = {read(0)};
    std::unordered_map<uint32_t, Entry> listed = {{key(order[0]), {0, 1}}};
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

        auto found = listed.find(key(parent));
        if (found == listed.end()) {valid = false; return {};}
        // Whether the parent's colour leaves the palette with this split (no other current cluster has it).
        const size_t slot = found->second.slot;
        const bool freed = --found->second.clusters == 0;
        if (freed) {listed.erase(found);}

        auto heavier = listed.find(key(heavy));
        if (heavier != listed.end()) {
            heavier->second.clusters++;
            if (freed) {
                // The parent's place empties and the heavier half's colour is listed elsewhere: close the gap. Rare, so
                // re-indexing everything is fine.
                order.erase(order.begin() + slot);
                for (auto& entry : listed) {if (entry.second.slot > slot) {entry.second.slot--;}}
            }
        } else if (freed) {
            order[slot] = heavy;
            listed[key(heavy)] = {slot, 1};
        } else {
            listed[key(heavy)] = {order.size(), 1};
            order.push_back(heavy);
        }
        auto lighter = listed.find(key(light));
        if (lighter != listed.end()) {
            lighter->second.clusters++;
        } else {
            listed[key(light)] = {order.size(), 1};
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

    std::unordered_map<uint32_t, size_t> slot;
    for (size_t j = 0; j < palette.size() / 3; j++) {slot[(uint32_t(palette[3 * j]) << 16) | (uint32_t(palette[3 * j + 1]) << 8) | uint32_t(palette[3 * j + 2])] = j;}
    std::vector<double> totals(palette.size() / 3, 0.0);
    for (size_t id = 0; id < colour.size(); id++) {
        auto found = slot.find(colour[id]);
        if (found == slot.end()) {return weights;}
        totals[found->second] += weight[id] * pixels;
    }
    return totals;

}

// Maps each pixel to its nearest palette colour, matching in `color_space`. With `dither` > 0 the
// remaining error is diffused to neighbouring pixels (serpentine Floyd-Steinberg, scaled by `dither`), which
// needs the image's `width`. For each pixel p it calls `emit(p, index)` with the chosen palette index, or -1
// when the palette is empty.
template <typename Emit>
void map_pixels(const uint8_t* image_data, int image_length, int image_format, const uint8_t* palette, size_t palette_length, ColorSpace color_space, double dither, int width, int skip_below, Emit emit) {

    const ColorCoordinates space(color_space);
    std::vector<AgglomerativeClustering::KDTree::Point> points;
    std::vector<uint32_t> keys;
    // The indexes are built over distinct colours only: a supplied palette can repeat a colour any number of times, and
    // equal entries would all land in the same cell lists and tree leaves, making each lookup a pass over the repeats
    // (a 200,000-entry palette of one colour took seconds for a thousand pixels). Equal entries tie, and ties go to
    // the first of them, so `first[u]` is the palette index of distinct colour `u`'s first occurrence.
    std::vector<int32_t> first;
    std::unordered_map<uint32_t, int32_t> seen;
    seen.reserve(std::min<size_t>(palette_length / 3, size_t(1) << 20));

    for (size_t i = 0; i + 2 < palette_length; i += 3) {
        const uint32_t key = (uint32_t(palette[i]) << 16) | (uint32_t(palette[i+1]) << 8) | uint32_t(palette[i+2]);
        if (!seen.emplace(key, int32_t(points.size())).second) {continue;}
        points.push_back(space.match(palette[i], palette[i+1], palette[i+2]));
        keys.push_back(key);
        first.push_back(int32_t(i / 3));
    }

    // Up to 1024 colours a lazily built cell index answers lookups fastest (2.5 to 3 times faster than the k-d tree
    // from 257 to 1024 colours, on photos and random palettes). Each cell it builds costs a pass over the palette, so
    // larger palettes (only through a custom palette) use the k-d tree, which wins from about 4096. Both give the same
    // answers. The cell sizes were tuned on photos: OKLab colours fill less of their cube than RGB.
    const bool small = points.size() <= 1024;
    AgglomerativeClustering::PaletteIndex cells;
    AgglomerativeClustering::KDTree tree;
    if (small) {cells.build(points, keys, color_space == ColorSpace::rgb ? 8 : 16, color_space == ColorSpace::rgb ? 4 : 5);} else {tree.build(points, keys);}
    auto lookup = [&](const AgglomerativeClustering::KDTree::Point& target) {return small ? cells.get_nearest(target) : tree.get_nearest(target);};

    int increment = image_format == 1 ? 3 : 4;
    size_t pixels = image_length > 0 ? static_cast<size_t>(image_length) / increment : 0;

    // A direct-mapped memo of recent lookups: photos repeat colours, neighbouring pixels most of all, so most
    // pixels skip the lookup. A colour always maps to the same palette entry, so the output is unchanged.
    constexpr int memo_bits = 14;
    std::vector<uint32_t> memo_keys(size_t(1) << memo_bits, std::numeric_limits<uint32_t>::max());
    std::vector<int32_t> memo_values(size_t(1) << memo_bits);
    auto nearest_index = [&](uint8_t r, uint8_t g, uint8_t b) {
        uint32_t key = (uint32_t(r) << 16) | (uint32_t(g) << 8) | uint32_t(b);
        uint32_t slot = (key * 0x9E3779B1u) >> (32 - memo_bits);
        if (memo_keys[slot] != key) {
            memo_keys[slot] = key;
            memo_values[slot] = lookup(space.match(r, g, b));
        }
        return memo_values[slot];
    };

    // Lookups give distinct-colour indices (see `first`); `palette_index` turns one into the caller's palette index.
    auto palette_index = [&](int32_t u) {return u < 0 ? u : first[size_t(u)];};

    if (dither <= 0.0 || width <= 0 || pixels % size_t(width) != 0 || points.empty()) {
        for (size_t p = 0; p < pixels; p++) {
            const uint8_t* pixel = image_data + p * increment;
            emit(p, palette_index(nearest_index(pixel[0], pixel[1], pixel[2])));
        }
        return;
    }

    // Error for the current and next rows, one pixel of padding on each side so neighbours need no checks.
    const size_t height = pixels / size_t(width);
    std::vector<float> current(3 * (size_t(width) + 2), 0.0f), next(3 * (size_t(width) + 2), 0.0f);
    const float strength = float(std::min(dither, 1.0));
    const float limit = color_space == ColorSpace::rgb ? 255.0f : 65535.0f;
    // The colour a pixel should take (its own plus the error it was given) can lie outside the cube. Close to it (dark areas
    // next to the palette's darkest colour) it is clamped to the cube, as most dithering does, and matched through the
    // index. Further out, the palette can't reach the image's colours (saturated cyan with a 7-colour e-ink palette):
    // clamping there would throw away the error that should move the next pixels to other entries, so the same entry
    // (blue, for cyan) would be picked every time. There the target is kept as it is and matched exactly, by a pass over
    // the palette: rare with palettes extracted from the image, and cheap with the small ones that can't cover it. The
    // error a pixel receives is limited in length (not per channel, which would push it into a corner where several
    // entries tie), so out-of-reach colours don't build it up without end and smear it across the image.
    const float near = limit / 8.0f;
    const float most = limit;
    auto nearest_outside = [&](const float* wanted) {
        int32_t best = 0;
        double best_distance = std::numeric_limits<double>::infinity();
        for (size_t i = 0; i < points.size(); i++) {
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
            float* e = &current[3 * (x + 1)];
            // Transparent pixels (alpha below `skip_below`) neither take error nor pass any on: their colour isn't seen.
            if (image_format == 0 && pixel[3] < skip_below) {
                emit(p, palette_index(nearest_index(pixel[0], pixel[1], pixel[2])));
                for (int c = 0; c < 3; c++) {e[c] = 0.0f;}
                continue;
            }
            // Error is carried in the matching coordinates (8-bit RGB values, or OKLab), so the colour chosen
            // is the one that best cancels it; mixing spaces lets error pile up into streaks.
            const AgglomerativeClustering::KDTree::Point base = match(pixel[0], pixel[1], pixel[2]);
            const float length = std::sqrt(e[0] * e[0] + e[1] * e[1] + e[2] * e[2]);
            const float scale = length > most ? most / length : 1.0f;
            float wanted[3];
            bool outside = false;
            for (int c = 0; c < 3; c++) {
                wanted[c] = float(base[c]) + e[c] * scale;
                if (wanted[c] < -near || wanted[c] > limit + near) {outside = true;}
                e[c] = 0.0f;
            }
            int32_t index;
            if (outside) {
                index = nearest_outside(wanted);
            } else {
                AgglomerativeClustering::KDTree::Point target;
                for (int c = 0; c < 3; c++) {
                    wanted[c] = std::clamp(wanted[c], 0.0f, limit);
                    target[c] = uint16_t(std::lround(wanted[c]));
                }
                index = color_space == ColorSpace::rgb ? nearest_index(uint8_t(target[0]), uint8_t(target[1]), uint8_t(target[2])) : lookup(target);
            }
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
        std::swap(current, next);
        std::fill(next.begin(), next.end(), 0.0f);
    }

}

// Maps the image to the palette (see map_pixels) and returns the mapped image, in the input's format with alpha
// preserved, as a length-prefixed buffer (see allocate_variable_size) so the output is written once, in place.
// With an empty palette every pixel becomes black.
uint8_t* _quantize(const uint8_t* image_data, int image_length, int image_format, const uint8_t* palette, size_t palette_length, ColorSpace color_space, double dither, int width) {
    const int increment = image_format == 1 ? 3 : 4;
    const size_t pixels = image_length > 0 ? static_cast<size_t>(image_length) / increment : 0;
    uint8_t* packed = allocate_variable_size(pixels * increment);
    uint8_t* output = packed + 4;
    map_pixels(image_data, image_length, image_format, palette, palette_length, color_space, dither, width, 1, [&](size_t p, int32_t index) {
        uint8_t* out = output + p * increment;
        const uint8_t* colour = index < 0 ? nullptr : palette + 3 * size_t(index);
        for (int c = 0; c < 3; c++) {out[c] = colour ? colour[c] : 0;}
        if (image_format == 0) {out[3] = image_data[p * increment + 3];}
    });
    return packed;
}

// Maps the image to the palette (see map_pixels) and returns each pixel's palette index instead of its colour.
// The length-prefixed payload is [entries (u32), transparent index (i32, -1 for none), index bytes (u32)], then
// the palette (3 bytes per entry), then one little-endian index of `index bytes` (1, 2 or 4) per pixel.
// With a `cutoff` (1-255) and RGBA input that has pixels with alpha below it, those pixels get an extra black entry
// appended after the palette, which takes no part in matching (the callers cut the palette one colour smaller to make room, see
// colours_for_entries: `k` counts the entries of the result); every other pixel maps to its nearest colour,
// fully opaque. Without one (0), all pixels map to their nearest colour like any other pixel. An empty palette stays empty unless some pixel needs an entry to point at, in which case it becomes a
// single black entry, as _quantize maps it: so an empty image has an empty palette, and a fully transparent image
// with a cutoff has just the transparent entry (index 0).
// Whether indexed output with this cutoff will have a transparent entry: the image is RGBA and some pixel is below it.
bool has_transparent_entry(const uint8_t* image_data, int image_length, int image_format, int cutoff) {
    if (cutoff <= 0 || image_format != 0 || image_length < 4) {return false;}
    for (size_t p = 0; p + 3 < size_t(image_length); p += 4) {if (image_data[p + 3] < cutoff) {return true;}}
    return false;
}

// The palette size to cut to so the indexed result has `k` entries in all: the transparent entry counts towards `k`, so a
// GIF or palette PNG asking for 256 gets 256, not 257. At least one colour is always kept.
int colours_for_entries(const uint8_t* image_data, int image_length, int image_format, int cutoff, int k) {
    return has_transparent_entry(image_data, image_length, image_format, cutoff) ? std::max(1, k - 1) : k;
}

uint8_t* _quantize_indices(const uint8_t* image_data, int image_length, int image_format, const uint8_t* palette, size_t palette_length, ColorSpace color_space, double dither, int width, int cutoff) {
    const int increment = image_format == 1 ? 3 : 4;
    const size_t pixels = image_length > 0 ? static_cast<size_t>(image_length) / increment : 0;

    std::vector<uint8_t> entries(palette, palette + palette_length / 3 * 3);
    bool transparent = false;
    if (cutoff > 0 && image_format == 0) {
        for (size_t p = 0; p < pixels && !transparent; p++) {transparent = image_data[p * 4 + 3] < cutoff;}
    }
    bool needs_entry = false;
    for (size_t p = 0; p < pixels && !needs_entry; p++) {needs_entry = !(transparent && image_data[p * 4 + 3] < cutoff);}
    if (entries.empty() && needs_entry) {entries.assign(3, 0);}
    const size_t colours = entries.size() / 3;
    const int32_t transparent_index = transparent ? int32_t(colours) : -1;
    if (transparent) {entries.insert(entries.end(), 3, 0);}
    const size_t count = entries.size() / 3;
    const uint32_t index_bytes = count <= 256 ? 1 : count <= 65536 ? 2 : 4;

    const size_t header = 12;
    uint8_t* packed = allocate_variable_size(header + entries.size() + pixels * index_bytes);
    uint8_t* output = packed + 4;
    auto write32 = [](uint8_t* at, uint32_t value) {for (int b = 0; b < 4; b++) {at[b] = (value >> (8 * b)) & 0xFF;}};
    write32(output, uint32_t(count));
    write32(output + 4, uint32_t(transparent_index));
    write32(output + 8, index_bytes);
    std::memcpy(output + header, entries.data(), entries.size());
    uint8_t* indices = output + header + entries.size();

    map_pixels(image_data, image_length, image_format, entries.data(), colours * 3, color_space, dither, width, transparent ? cutoff : 1, [&](size_t p, int32_t index) {
        if (transparent && image_data[p * 4 + 3] < cutoff) {index = transparent_index;}
        uint8_t* out = indices + p * index_bytes;
        for (uint32_t b = 0; b < index_bytes; b++) {out[b] = (uint32_t(index) >> (8 * b)) & 0xFF;}
    });
    return packed;
}

extern "C" {

// The library version this module was built for, as a NUL-terminated string. The JavaScript checks it against its own when
// the module loads, so a .wasm left over from another version (a stale cache or CDN copy) is reported, not run.
EMSCRIPTEN_KEEPALIVE
const char* library_version() {
    return AGGLOMERATIVE_CLUSTERING_VERSION;
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
    std::memcpy(output + 4, weights.data(), weights.size() * sizeof(double));
    return output;
}

EMSCRIPTEN_KEEPALIVE
uint8_t* quantize(uint8_t* image_data, int image_length, int image_format, int k, int color_space, int precision, int weight_alpha, double dither, int width, int transparent) {
    std::vector<uint8_t> clustering = _get_clustering(image_data, image_length, image_format, ColorSpace(color_space), precision, weight_alpha != 0, transparent);
    bool valid = false;
    std::vector<uint8_t> palette = _get_palette_from_clustering(clustering.data(), clustering.size(), k, valid);
    // Made a moment ago, so it is valid; if the check ever disagreed, the caller hears of it rather than getting an empty palette.
    if (!valid) {return nullptr;}
    return _quantize(image_data, image_length, image_format, palette.data(), palette.size(), ColorSpace(color_space), dither, width);
}

EMSCRIPTEN_KEEPALIVE
// A negative `color_space` matches in the space the clustering was made in.
uint8_t* quantize_with_clustering(uint8_t* image_data, int image_length, int image_format, uint8_t* clustering_data, int clustering_length, int k, int color_space, double dither, int width) {
    bool valid = false;
    std::vector<uint8_t> palette = _get_palette_from_clustering(clustering_data, clustering_length, k, valid);
    if (!valid) {return nullptr;}
    ColorSpace space = color_space < 0 ? read_clustering(clustering_data, clustering_length).color_space : ColorSpace(color_space);
    return _quantize(image_data, image_length, image_format, palette.data(), palette.size(), space, dither, width);
}

EMSCRIPTEN_KEEPALIVE
uint8_t* quantize_with_palette(uint8_t* image_data, int image_length, int image_format, uint8_t* palette_data, int palette_length, int color_space, double dither, int width) {
    return _quantize(image_data, image_length, image_format, palette_data, palette_length, ColorSpace(color_space), dither, width);
}

EMSCRIPTEN_KEEPALIVE
uint8_t* quantize_indices(uint8_t* image_data, int image_length, int image_format, int k, int color_space, int precision, int weight_alpha, double dither, int width, int transparent) {
    std::vector<uint8_t> clustering = _get_clustering(image_data, image_length, image_format, ColorSpace(color_space), precision, weight_alpha != 0, transparent);
    bool valid = false;
    std::vector<uint8_t> palette = _get_palette_from_clustering(clustering.data(), clustering.size(), colours_for_entries(image_data, image_length, image_format, transparent, k), valid);
    // Made a moment ago, so it is valid; if the check ever disagreed, the caller hears of it rather than getting an empty palette.
    if (!valid) {return nullptr;}
    return _quantize_indices(image_data, image_length, image_format, palette.data(), palette.size(), ColorSpace(color_space), dither, width, transparent);
}

EMSCRIPTEN_KEEPALIVE
// A negative `color_space` matches in the space the clustering was made in.
uint8_t* quantize_indices_with_clustering(uint8_t* image_data, int image_length, int image_format, uint8_t* clustering_data, int clustering_length, int k, int color_space, double dither, int width, int transparent) {
    bool valid = false;
    std::vector<uint8_t> palette = _get_palette_from_clustering(clustering_data, clustering_length, colours_for_entries(image_data, image_length, image_format, transparent, k), valid);
    if (!valid) {return nullptr;}
    ColorSpace space = color_space < 0 ? read_clustering(clustering_data, clustering_length).color_space : ColorSpace(color_space);
    return _quantize_indices(image_data, image_length, image_format, palette.data(), palette.size(), space, dither, width, transparent);
}

EMSCRIPTEN_KEEPALIVE
uint8_t* quantize_indices_with_palette(uint8_t* image_data, int image_length, int image_format, uint8_t* palette_data, int palette_length, int color_space, double dither, int width, int transparent) {
    return _quantize_indices(image_data, image_length, image_format, palette_data, palette_length, ColorSpace(color_space), dither, width, transparent);
}

}