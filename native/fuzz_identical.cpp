// libFuzzer target: speed work must not change a clustering. Every input is an image and clustering options, within what the
// JavaScript lets through, and the clustering from src/ must be byte-identical to the one from the copy of the 4.0.0 code in
// native/reference/ (compiled into the same binary under its own namespace; see reference/reference.cpp). Both run with
// ASan and UBSan, so memory errors in either also fail. Built and run by scripts/native.sh.
//
// The input is read as fuzz_images.cpp's is, so its seeds are valid here: [format, colour space, precision, weight alpha,
// k (here: how many generated pixels), dither (here: how far they scatter), method (here: how they are drawn), steps (here:
// how many centres), transparent cutoff, palette colours (here: centres from the data), width seed], those palette colours,
// then pixels taken as they are. A short input can still make a large image: the generated pixels (up to 16,384) are
// scattered around the centres, so they give the many colours and the heavy clusters that the search's caches and bounds
// act on, which a few thousand bytes of fuzzer data cannot.
#include "../src/clustering.cpp"
#include "reference/reference.hpp"
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

// A small deterministic generator (xorshift64*), seeded from the input.
struct Random {
    uint64_t state;
    uint32_t next() {
        state ^= state >> 12; state ^= state << 25; state ^= state >> 27;
        return uint32_t((state * 0x2545F4914F6CDD1DULL) >> 32);
    }
};

}  // namespace

extern "C" int LLVMFuzzerTestOneInput(const uint8_t* data, size_t size) {
    Reader in{data, size};
    const int format = in.next() % 5;                       // rgba, rgb, bgra, rgbx, bgrx
    const int stride = format == 1 ? 3 : 4;
    const int color_space = in.next() % 2;
    const int precision = 1 + in.next() % 8;
    const int weight_alpha = in.next() % 2;
    const int generated_exponent = in.next() % 15;          // 0: none, else 2^(e-1) pixels (1 to 8192)
    const int spread_exponent = in.next() % 9;              // scatter of 1 to 256 levels
    const int mode = in.next() % 3;
    const int centre_count = 1 + in.next() % 64;
    const int transparent = in.next();                      // 0 (none) or a cutoff 1-255
    const int palette_colours = in.next() % 40;
    const uint8_t width_seed = in.next();

    std::vector<uint8_t> centres;
    uint64_t seed = 0x9E3779B97F4A7C15ULL ^ (uint64_t(width_seed) << 8) ^ uint64_t(palette_colours);
    for (int i = 0; i < 3 * palette_colours; i++) {
        centres.push_back(in.next());
        seed = seed * 1099511628211ULL + centres.back();
    }
    Random random{seed | 1u};
    while (centres.size() < 3u * size_t(centre_count)) {centres.push_back(uint8_t(random.next() >> 7));}

    std::vector<uint8_t> image;
    // The generated pixels. Mode 0: noise around one of the centres, a different scatter in each channel. Mode 1: the same
    // scatter in all three channels (a lighter or darker version of the centre, as in a smooth gradient), and the
    // centres picked unevenly, so a few of them grow heavy. Mode 2: a ramp along the image plus noise, so near colours
    // come in order (as in a scan) rather than at random.
    const size_t generated = generated_exponent ? size_t(1) << (generated_exponent - 1) : 0;
    const int spread = 1 << spread_exponent;
    auto scatter = [&](int value, int amount) {
        if (amount <= 1) {return uint8_t(value);}
        return uint8_t(std::min(255, std::max(0, value + int(random.next() % uint32_t(2 * amount)) - amount)));
    };
    for (size_t i = 0; i < generated; i++) {
        uint32_t pick = random.next();
        size_t centre = mode == 1 ? size_t(std::min(pick % centre_count, (pick >> 8) % centre_count)) : size_t(pick % centre_count);
        const int base[3] = {centres[3 * centre], centres[3 * centre + 1], centres[3 * centre + 2]};
        int channel[3];
        if (mode == 1) {
            const int shift = int(random.next() % uint32_t(2 * spread + 1)) - spread;
            for (int c = 0; c < 3; c++) {channel[c] = std::min(255, std::max(0, base[c] + shift));}
        } else if (mode == 2) {
            const int ramp = int(i * 256 / generated);
            for (int c = 0; c < 3; c++) {channel[c] = scatter((base[c] + ramp * (c + 1)) & 255, spread);}
        } else {
            for (int c = 0; c < 3; c++) {channel[c] = scatter(base[c], spread);}
        }
        const uint8_t alpha = uint8_t(random.next() % 4 == 0 ? random.next() : 255);
        if (format == 1) {image.insert(image.end(), {uint8_t(channel[0]), uint8_t(channel[1]), uint8_t(channel[2])});}
        else if (format == 2 || format == 4) {image.insert(image.end(), {uint8_t(channel[2]), uint8_t(channel[1]), uint8_t(channel[0]), alpha});}
        else {image.insert(image.end(), {uint8_t(channel[0]), uint8_t(channel[1]), uint8_t(channel[2]), alpha});}
    }

    // The rest of the input is pixels as they are, cut to whole pixels and at most 4096 of them.
    const size_t literal = std::min<size_t>((size - std::min(size, in.at)) / stride, 4096);
    image.insert(image.end(), data + in.at, data + in.at + literal * stride);
    const int length = int(image.size());

    uint8_t* expected = reference_get_clustering(image.data(), length, format, color_space, precision, weight_alpha, transparent);
    uint8_t* actual = get_clustering(image.data(), length, format, color_space, precision, weight_alpha, transparent);
    if (!expected || !actual) {std::abort();}
    const uint32_t expected_length = payload_length(expected);
    if (expected_length != payload_length(actual) || std::memcmp(expected, actual, 4 + size_t(expected_length)) != 0) {std::abort();}
    std::free(expected);
    std::free(actual);
    return 0;
}
