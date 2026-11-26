// Question 3: mapping split across threads, in a -pthread WebAssembly build (or natively with threads).
//   mapthreads <image.rgba> <width> <space 0|1> <runs> <threads,...>
// The palette (k = 16 and 256) is cut from a clustering made once. Per config and thread count it prints
//   "MAPT k kind threads ms hash identical_to_shipped differing_pixels"
// Kinds: none (stripes), ordered (stripes starting on rows that are multiples of 8, so the Bayer matrix lines up),
// fs-stripes (Floyd-Steinberg restarted at each stripe: NOT byte-identical, measured for speed only).
// The shipped single-threaded result (_quantize) is the reference for "identical".
#include "../build/src/clustering.cpp"
#include <cstdio>
#include <chrono>
#include <thread>
#include <string>
#include <sstream>
#include <algorithm>
static double now() {return std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now().time_since_epoch()).count();}
static uint64_t fnv(const uint8_t* p, size_t n) {uint64_t h = 1469598103934665603ull; for (size_t i = 0; i < n; i++) {h ^= p[i]; h *= 1099511628211ull;} return h;}

struct Kind {const char* name; double dither; int method; bool align;};

// Maps the image in `threads` stripes of whole rows into `out` (the image's size, RGBA); returns after all are joined.
static void map_stripes(const uint8_t* image, size_t width, size_t height, const std::vector<uint8_t>& palette, int space, const Kind& kind, int threads, uint8_t* out, double* spawn_ms) {
    size_t rows = (height + threads - 1) / threads;
    if (kind.align) {rows = (rows + 7) / 8 * 8;}
    std::vector<std::thread> pool;
    double t0 = now();
    for (int t = 0; t < threads; t++) {
        const size_t r0 = std::min(height, size_t(t) * rows), r1 = std::min(height, r0 + rows);
        if (r0 >= r1) {continue;}
        pool.emplace_back([=, &palette, &kind] {
            const size_t length = (r1 - r0) * width * 4;
            MappingTask task(true, image + r0 * width * 4, int(length), 0, palette.data(), palette.size(), ColorSpace(space), kind.dither, kind.method, 0, int(width), 0);
            task.step(false, 0);
            uint8_t* result = task.take();
            std::memcpy(out + r0 * width * 4, result + 4, length);
            std::free(result);
        });
    }
    if (spawn_ms) {*spawn_ms = now() - t0;}
    for (std::thread& th : pool) {th.join();}
}

int main(int argc, char** argv) {
    if (argc < 6) {std::fprintf(stderr, "usage\n"); return 2;}
    std::FILE* f = std::fopen(argv[1], "rb");
    if (!f) {std::perror(argv[1]); return 1;}
    std::fseek(f, 0, SEEK_END); size_t size = size_t(std::ftell(f)); std::fseek(f, 0, SEEK_SET);
    std::vector<uint8_t> image(size);
    if (std::fread(image.data(), 1, size, f) != size) {return 1;}
    std::fclose(f);
    const size_t width = size_t(std::atoi(argv[2])), height = size / 4 / width;
    const int space = std::atoi(argv[3]), runs = std::atoi(argv[4]);
    std::vector<int> thread_counts;
    {std::stringstream s(argv[5]); std::string item; while (std::getline(s, item, ',')) {thread_counts.push_back(std::atoi(item.c_str()));}}
    std::vector<uint8_t> clustering = _get_clustering(image.data(), int(size), 0, ColorSpace(space), 6, true, 0)  // precision 6: only the palette is needed, and it is quick on big images;
    const Kind kinds[] = {{"none", 0, 0, false}, {"ordered", 1, 2, true}, {"fs-stripes", 1, 0, false}};
    std::vector<uint8_t> out(size);
    for (int k : {16, 256}) {
        bool valid = false;
        std::vector<uint8_t> palette = _get_palette_from_clustering(clustering.data(), clustering.size(), k, valid);
        for (const Kind& kind : kinds) {
            // The reference: the shipped call, once for the hash (and timed as threads = 0).
            std::vector<double> times;
            uint64_t reference = 0;
            std::vector<uint8_t> reference_pixels;
            for (int r = 0; r < runs; r++) {
                double t0 = now();
                uint8_t* result = _quantize(image.data(), int(size), 0, palette.data(), palette.size(), ColorSpace(space), kind.dither, kind.method, 0, int(width));
                times.push_back(now() - t0);
                if (r == 0) {reference = fnv(result + 4, size); reference_pixels.assign(result + 4, result + 4 + size);}
                std::free(result);
            }
            std::sort(times.begin(), times.end());
            std::printf("MAPT %d %s 0 %.3f %016llx identical 0\n", k, kind.name, times[times.size() / 2], (unsigned long long) reference);
            std::fflush(stdout);
            for (int threads : thread_counts) {
                std::vector<double> ts, spawns;
                for (int r = 0; r < runs; r++) {
                    double spawn = 0;
                    double t0 = now();
                    map_stripes(image.data(), width, height, palette, space, kind, threads, out.data(), &spawn);
                    ts.push_back(now() - t0); spawns.push_back(spawn);
                }
                std::sort(ts.begin(), ts.end()); std::sort(spawns.begin(), spawns.end());
                const uint64_t h = fnv(out.data(), size);
                size_t differing = 0;
                if (h != reference) {for (size_t p = 0; p < size; p += 4) {if (std::memcmp(&out[p], &reference_pixels[p], 4) != 0) {differing++;}}}
                std::printf("MAPT %d %s %d %.3f %016llx %s %zu spawn_ms %.3f\n", k, kind.name, threads, ts[ts.size() / 2], (unsigned long long) h, h == reference ? "identical" : "DIFFERENT", differing, spawns[spawns.size() / 2]);
                std::fflush(stdout);
            }
        }
    }
    return 0;
}
