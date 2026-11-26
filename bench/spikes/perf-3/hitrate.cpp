// Direct-mapped front cache hit rate on an image's pixels (opaque RGBA): for cache sizes 2^8..2^16, the share of pixels whose colour is in the cache.
#include <cstdio>
#include <cstdint>
#include <vector>
int main(int, char** argv) {
    std::FILE* f = std::fopen(argv[1], "rb"); std::fseek(f, 0, SEEK_END); size_t n = std::ftell(f); std::fseek(f, 0, SEEK_SET);
    std::vector<uint8_t> im(n); if (std::fread(im.data(), 1, n, f) != n) return 1;
    for (int bits = 8; bits <= 16; bits += 2) {
        std::vector<uint32_t> keys(size_t(1) << bits, 0xFFFFFFFFu); size_t hits = 0, same = 0; uint32_t prev = 0xFFFFFFFFu;
        for (size_t p = 0; p + 3 < n; p += 4) {
            uint32_t k = im[p] << 16 | im[p+1] << 8 | im[p+2];
            uint32_t s = (k * 0x9E3779B1u) >> (32 - bits);
            if (k == prev) same++;
            if (keys[s] == k) hits++; else keys[s] = k;
            prev = k;
        }
        std::printf("%s bits %d hit %.1f%% (same as previous pixel %.1f%%)\n", argv[1], bits, 100.0 * hits / (n / 4), 100.0 * same / (n / 4));
    }
}
