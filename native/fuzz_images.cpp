// libFuzzer target: images and options, within what the JavaScript lets through (it validates every argument before
// calling C, so the format, lengths, width and option ranges here are always ones it accepts). Checks memory safety
// (with ASan and UBSan) and invariants:
//   - a clustering run in slices (the path with `signal` or `onProgress`) is byte-identical to one run in one go;
//   - indexed output points every pixel at an entry, and has at most k entries;
//   - mapping with a palette from the fuzzer's bytes (any colours, repeats included) doesn't fail.
// Built and run by scripts/native.sh.
#include "../src/clustering.cpp"
#include <cstdlib>

namespace {

struct Reader {
    const uint8_t* data;
    size_t size;
    size_t at = 0;
    uint8_t next() {return at < size ? data[at++] : 0;}
};

uint32_t payload_length(const uint8_t* packed) {
    uint32_t n;
    std::memcpy(&n, packed, 4);
    return n;
}

}  // namespace

extern "C" int LLVMFuzzerTestOneInput(const uint8_t* data, size_t size) {
    Reader in{data, size};
    const int format = in.next() % 5;                       // rgba, rgb, bgra, rgbx, bgrx
    const int stride = format == 1 ? 3 : 4;
    const int color_space = in.next() % 2;
    const int precision = 1 + in.next() % 8;
    const int weight_alpha = in.next() % 2;
    const int k = 1 + in.next() % 300;
    const double dither = (in.next() % 5) / 4.0;            // 0, 0.25, 0.5, 0.75, 1
    const int method = in.next() % 3;
    static const int steps_choices[] = {0, 2, 4, 8, 16, 32, 64};
    const int steps = steps_choices[in.next() % 7];
    const int transparent = in.next();                      // 0 (none) or a cutoff 1-255
    const int palette_colours = in.next() % 40;
    const uint8_t width_seed = in.next();

    std::vector<uint8_t> palette;
    for (int i = 0; i < 3 * palette_colours; i++) {palette.push_back(in.next());}

    // The rest is the image, cut to whole pixels and at most 4096 of them (larger inputs only slow the fuzzer).
    size_t pixels = std::min<size_t>((size - std::min(size, in.at)) / stride, 4096);
    std::vector<uint8_t> image(data + in.at, data + in.at + pixels * stride);
    const int length = int(image.size());
    // A width that divides the pixel count, as the JavaScript requires when dithering.
    int width = pixels ? int(1 + width_seed % pixels) : 0;
    while (width > 1 && pixels % size_t(width) != 0) {width--;}
    const int map_width = dither > 0 ? width : 0;

    // Sliced clustering equals the one-shot clustering.
    uint8_t* whole = get_clustering(image.data(), length, format, color_space, precision, weight_alpha, transparent);
    ClusteringJob* job = clustering_job_start(image.data(), length, format, color_space, precision, weight_alpha, transparent);
    while (clustering_job_step(job, 0.0) != 1000) {}
    uint8_t* sliced = clustering_job_result(job);
    clustering_job_free(job);
    if (!whole || !sliced) {std::abort();}
    const uint32_t whole_length = payload_length(whole);
    if (whole_length != payload_length(sliced) || std::memcmp(whole, sliced, 4 + whole_length) != 0) {std::abort();}
    std::free(sliced);

    // Indexed output: every index points into the palette, which has at most k entries (the transparent one counts).
    if (uint8_t* packed = quantize_indices(image.data(), length, format, k, color_space, precision, weight_alpha, dither, method, steps, map_width, transparent)) {
        const uint8_t* payload = packed + 4;
        uint32_t entries, index_bytes;
        std::memcpy(&entries, payload, 4);
        std::memcpy(&index_bytes, payload + 8, 4);
        // k counts the transparent entry, but at least one colour is kept, so k = 1 with transparency gives 2.
        if (entries > uint32_t(std::max(k, 2))) {std::abort();}
        const uint8_t* indices = payload + 12 + 3 * size_t(entries);
        for (size_t p = 0; p < pixels; p++) {
            uint32_t index = 0;
            std::memcpy(&index, indices + p * index_bytes, index_bytes);
            if (index >= entries) {std::abort();}
        }
        std::free(packed);
    } else {
        std::abort();
    }

    std::free(quantize(image.data(), length, format, k, color_space, precision, weight_alpha, dither, method, steps, map_width, transparent));
    std::free(quantize_with_palette(image.data(), length, format, palette.data(), int(palette.size()), color_space, dither, method, steps, map_width));
    std::free(quantize_indices_with_palette(image.data(), length, format, palette.data(), int(palette.size()), color_space, dither, method, steps, map_width, transparent));
    // And with the clustering just made, cut to k, as the …FromClustering functions do.
    std::free(quantize_indices_with_clustering(image.data(), length, format, whole + 4, int(whole_length), k, -1, dither, method, steps, map_width, transparent));
    std::free(whole);
    return 0;
}
