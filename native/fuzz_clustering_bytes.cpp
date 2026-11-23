// libFuzzer target: arbitrary bytes as a stored clustering. Users store clusterings and hand them back, and the
// JavaScript passes one with checksum 0 (3.0.0-beta.1 wrote zeros) to C without checking it, so every export that
// reads a stored clustering must survive any bytes: return a null pointer for a clustering that doesn't fit, never
// read out of bounds, and never cut to more than k colours. Built and run by scripts/native.sh (with ASan and UBSan).
#include "../src/clustering.cpp"
#include <cstdlib>

namespace {

// A small RGBA image to map with the clustering: 4x4, with alpha, so the transparent entry is exercised too.
const uint8_t image[64] = {
    255, 0, 0, 255,   0, 255, 0, 255,   0, 0, 255, 255,   255, 255, 255, 255,
    10, 20, 30, 0,    200, 100, 50, 128, 90, 90, 90, 255,  0, 0, 0, 255,
    255, 128, 0, 255, 128, 0, 255, 64,  30, 60, 90, 255,   250, 250, 0, 255,
    1, 2, 3, 255,     4, 5, 6, 3,       200, 200, 200, 255, 100, 0, 0, 255,
};

uint32_t payload_length(const uint8_t* packed) {
    uint32_t n;
    std::memcpy(&n, packed, 4);
    return n;
}

}  // namespace

extern "C" int LLVMFuzzerTestOneInput(const uint8_t* data, size_t size) {
    // The exports take non-const pointers; give them an exact-size copy, so ASan sees any read past the end.
    uint8_t* bytes = static_cast<uint8_t*>(std::malloc(size ? size : 1));
    if (size) {std::memcpy(bytes, data, size);}
    const int length = int(size);
    std::vector<uint8_t> input(image, image + sizeof image);

    for (const int k : {1, 2, 3, 7, 16, 255, 256, 1000}) {
        if (uint8_t* palette = get_palette_from_clustering(bytes, length, k)) {
            const uint32_t n = payload_length(palette);
            if (n % 3 != 0 || n / 3 > uint32_t(k)) {std::abort();}   // a cut never has more than k colours
            std::free(palette);
        }
        std::free(get_palette_weights(bytes, length, k));
        for (const int space : {-1, 0, 1}) {
            std::free(quantize_with_clustering(input.data(), int(input.size()), 0, bytes, length, k, space, 1.0, k % 3, 0, 4));
            if (uint8_t* packed = quantize_indices_with_clustering(input.data(), int(input.size()), 0, bytes, length, k, space, 0.5, (k + 1) % 3, 0, 4, 128)) {
                // [entries, transparent index, index bytes], the palette, then one index per pixel: each must point into it.
                const uint8_t* payload = packed + 4;
                uint32_t entries, index_bytes;
                std::memcpy(&entries, payload, 4);
                std::memcpy(&index_bytes, payload + 8, 4);
                if (index_bytes != 1 && index_bytes != 2 && index_bytes != 4) {std::abort();}
                const uint8_t* indices = payload + 12 + 3 * size_t(entries);
                for (size_t p = 0; p < 16; p++) {
                    uint32_t index = 0;
                    std::memcpy(&index, indices + p * index_bytes, index_bytes);
                    if (index >= entries) {std::abort();}
                }
                std::free(packed);
            }
        }
    }
    std::free(bytes);
    return 0;
}
