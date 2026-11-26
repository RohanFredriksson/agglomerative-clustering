// Mapping driver: clusters the image once (RGB or OKLab), cuts k colours, then runs _quantize (or _quantize_indices) <runs> times and prints
// each run's time and an FNV-1a hash of the output. Natively under callgrind, only `mapping_call` is collected (--toggle-collect).
//   mapdriver <image.rgba> <width> <space 0|1> <k> <dither method -1 none|0 fs|1 atkinson|2 ordered> <runs> [indices 0|1]
#include "clustering.cpp"
#include <cstdio>
#include <chrono>
static double now() {return std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now().time_since_epoch()).count();}
static uint64_t fnv(const uint8_t* p, size_t n) {uint64_t h = 1469598103934665603ull; for (size_t i = 0; i < n; i++) {h ^= p[i]; h *= 1099511628211ull;} return h;}
__attribute__((noinline)) uint8_t* mapping_call(const uint8_t* image, int length, const uint8_t* palette, size_t plen, int space, double dither, int method, int width, bool indices) {
    if (indices) {return _quantize_indices(image, length, 0, palette, plen, ColorSpace(space), dither, method < 0 ? 0 : method, 0, width, 0);}
    return _quantize(image, length, 0, palette, plen, ColorSpace(space), dither, method < 0 ? 0 : method, 0, width);
}
int main(int argc, char** argv) {
    if (argc < 7) {std::fprintf(stderr, "usage: mapdriver image.rgba width space k method runs [indices]\n"); return 2;}
    std::FILE* f = std::fopen(argv[1], "rb");
    if (!f) {std::perror(argv[1]); return 1;}
    std::fseek(f, 0, SEEK_END); size_t size = size_t(std::ftell(f)); std::fseek(f, 0, SEEK_SET);
    std::vector<uint8_t> image(size);
    if (std::fread(image.data(), 1, size, f) != size) {return 1;}
    std::fclose(f);
    const int width = std::atoi(argv[2]), space = std::atoi(argv[3]), k = std::atoi(argv[4]), method = std::atoi(argv[5]), runs = std::atoi(argv[6]);
    const bool indices = argc > 7 && std::atoi(argv[7]);
    // With PALFILE set, the palette is read from it if it exists and written to it if not (the clustering is not what is measured).
    std::vector<uint8_t> palette;
    const char* palfile = std::getenv("PALFILE");
    if (palfile) {if (std::FILE* p = std::fopen(palfile, "rb")) {palette.resize(size_t(k) * 3); palette.resize(std::fread(palette.data(), 1, palette.size(), p)); std::fclose(p);}}
    if (palette.empty()) {
        std::vector<uint8_t> clustering = _get_clustering(image.data(), int(size), 0, ColorSpace(space), 8, true, 0);
        bool valid = false;
        palette = _get_palette_from_clustering(clustering.data(), clustering.size(), k, valid);
        if (palfile) {std::FILE* p = std::fopen(palfile, "wb"); std::fwrite(palette.data(), 1, palette.size(), p); std::fclose(p);}
    }
    const double dither = method < 0 ? 0.0 : 1.0;
    for (int r = 0; r < runs; r++) {
        double t0 = now();
        uint8_t* out = mapping_call(image.data(), int(size), palette.data(), palette.size(), space, dither, method, width, indices);
        double t1 = now();
        uint32_t len = out[0] | out[1] << 8 | out[2] << 16 | uint32_t(out[3]) << 24;
        std::printf("RUN %d TOTAL %.3f\nHASH %016llx\n", r, t1 - t0, (unsigned long long) fnv(out + 4, len));
        std::fflush(stdout);
        free(out);
    }
    return 0;
}
