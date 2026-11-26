// Pixel-scan driver: runs only ClusteringJob::scan (the histogram fill) <runs> times on one raw RGBA image and prints each time and an FNV-1a hash of
// the histogram (colours in first-seen order, then their totals). Works on any variant's src/ (private members opened for the driver only).
//   scandriver <image.rgba> <format 0 rgba|1 rgb|2 bgra|3 rgbx|4 bgrx> <runs> [weight_alpha 0|1, default 1]
#include <vector>
#include <array>
#include <memory>
#include <string>
#include <algorithm>
#include <limits>
#include <cstring>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <chrono>
#include <utility>
#include <numeric>
#include <functional>
#include <new>
#include <cstdint>
#include <cstddef>
#define private public
#include "clustering.cpp"
#undef private
static double now() {return std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now().time_since_epoch()).count();}
static uint64_t fnv(uint64_t h, const void* q, size_t n) {const uint8_t* p = (const uint8_t*) q; for (size_t i = 0; i < n; i++) {h ^= p[i]; h *= 1099511628211ull;} return h;}
int main(int argc, char** argv) {
    if (argc < 4) {return 2;}
    std::FILE* f = std::fopen(argv[1], "rb");
    if (!f) {return 1;}
    std::fseek(f, 0, SEEK_END); size_t size = size_t(std::ftell(f)); std::fseek(f, 0, SEEK_SET);
    std::vector<uint8_t> image(size);
    if (std::fread(image.data(), 1, size, f) != size) {return 1;}
    std::fclose(f);
    const int format = std::atoi(argv[2]), runs = std::atoi(argv[3]);
    const bool weight = argc > 4 ? std::atoi(argv[4]) != 0 : true;
    for (int r = 0; r < runs; r++) {
        ClusteringJob job(image.data(), int(size), format, ColorSpace::rgb, 8, weight, 0);
        double t0 = now();
        job.scan(false, 0.0);
        double t1 = now();
        uint64_t h = 1469598103934665603ull;
        h = fnv(h, job.histogram.colors().data(), job.histogram.colors().size() * 4);
        h = fnv(h, job.histogram.counts().data(), job.histogram.counts().size() * 8);
        h = fnv(h, &job.partial, 1);
        std::printf("RUN %d SCAN %.3f colours %zu HASH %016llx\n", r, t1 - t0, job.histogram.colors().size(), (unsigned long long) h);
        std::fflush(stdout);
    }
    return 0;
}
