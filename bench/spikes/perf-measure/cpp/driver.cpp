// Driver for the perf spike: one image through the instrumented ClusteringJob and (optionally) the mapping, with
// stage times printed as lines. The same file builds with em++ (run in Node) and natively (clang++, callgrind).
//   driver <image.rgba> <space 0|1> <precision> <runs> [map]
// Output: "STAGE name ms", "TOTAL ms", "SEARCHES n", "MAP k dither space ms", "HASH fnv".
#ifdef ROUNDS
#include "../build/rounds/clustering.cpp"
#else
#include "../build/src/clustering.cpp"
#endif
#include <algorithm>
#include <cstdio>
#include <chrono>
#include <string>
static double now() {return std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now().time_since_epoch()).count();}

static uint64_t fnv(const uint8_t* p, size_t n) {uint64_t h = 1469598103934665603ull; for (size_t i = 0; i < n; i++) {h ^= p[i]; h *= 1099511628211ull;} return h;}

int main(int argc, char** argv) {
    if (argc < 5) {std::fprintf(stderr, "usage\n"); return 2;}
    std::FILE* f = std::fopen(argv[1], "rb");
    if (!f) {std::perror(argv[1]); return 1;}
    std::fseek(f, 0, SEEK_END); size_t size = size_t(std::ftell(f)); std::fseek(f, 0, SEEK_SET);
    std::vector<uint8_t> image(size);
    if (std::fread(image.data(), 1, size, f) != size) {return 1;}
    std::fclose(f);
    const int space = std::atoi(argv[2]), precision = std::atoi(argv[3]), runs = std::atoi(argv[4]);
#ifdef ROUNDS
    if (const char* t = std::getenv("ROUNDS_THREADS")) {g_rounds_threads = std::atoi(t);}
    if (std::getenv("CHAIN_REVERSE")) {g_chain_reverse = true;}
    if (std::getenv("NO_CACHE")) {g_no_cache = true;}
    if (const char* t = std::getenv("PARALLEL_MIN")) {g_parallel_minimum = size_t(std::atoi(t));}
#endif
    const bool map = argc > 5 && std::string(argv[5]) == "map";
    std::vector<uint8_t> clustering;
    for (int r = 0; r < runs; r++) {
        g_stamps.clear(); g_searches = 0;
#ifdef ROUNDS
        g_rounds.clear(); g_t_search = g_t_merge = g_t_other = 0; g_searches_total = 0;
#endif
        double t0 = now();
        clustering = _get_clustering(image.data(), int(size), 0, ColorSpace(space), precision, true, 0);
        double t1 = now();
        std::printf("RUN %d\n", r);
        double prev = 0; bool first = true;
        for (const Stamp& s : g_stamps) {
            if (first) {prev = s.t; first = false; continue;}
            std::printf("STAGE %s %.3f\n", s.name, s.t - prev); prev = s.t;
        }
        std::printf("TOTAL %.3f\nSEARCHES %llu\n", t1 - t0, (unsigned long long) g_searches);
#ifdef ROUNDS
        if (g_rounds_threads > 0) {
            std::vector<size_t> m; for (const RoundStat& s : g_rounds) {m.push_back(s.merges);}
            std::vector<size_t> sorted = m; std::sort(sorted.begin(), sorted.end());
            std::printf("ROUNDS %zu merges_first %zu merges_median %zu merges_last %zu searches %zu t_search %.3f t_merge %.3f t_other %.3f\n", g_rounds.size(), m.front(), sorted[sorted.size() / 2], m.back(), g_searches_total, g_t_search, g_t_merge, g_t_other);
            std::FILE* rf = std::fopen("rounds.csv", "w");
            if (rf && r == 0) {for (const RoundStat& s : g_rounds) {std::fprintf(rf, "%zu,%zu\n", s.merges, s.searches);} }
            if (rf) {std::fclose(rf);}
        }
#endif
        std::printf("HASH %016llx\n", (unsigned long long) fnv(clustering.data(), clustering.size()));
        std::fflush(stdout);
    }
    if (const char* dump = std::getenv("DUMP")) {std::FILE* d = std::fopen(dump, "wb"); std::fwrite(clustering.data(), 1, clustering.size(), d); std::fclose(d);}
    if (map) {
        struct Cfg {int k; double dither; int method;};
        for (int k : {16, 256}) {
            bool valid = false;
            std::vector<uint8_t> palette = _get_palette_from_clustering(clustering.data(), clustering.size(), k, valid);
            for (Cfg c : {Cfg{k, 0, 0}, Cfg{k, 1, 0}, Cfg{k, 1, 2}}) {
                for (int r = 0; r < runs; r++) {
#ifdef STAMP_CALLGRIND
                    CALLGRIND_ZERO_STATS;
#endif
                    double t0 = now();
                    uint8_t* out = _quantize(image.data(), int(size), 0, palette.data(), palette.size(), ColorSpace(space), c.dither, c.method, 0, int(argc > 6 ? std::atoi(argv[6]) : 0));
#ifdef STAMP_CALLGRIND
                    {char label[64]; std::snprintf(label, sizeof label, "map k%d %s", k, c.dither == 0 ? "none" : c.method == 0 ? "fs" : "ordered"); CALLGRIND_DUMP_STATS_AT(label);}
#endif
                    double t1 = now();
                    std::printf("MAP %d %s %d %.3f %016llx\n", k, c.dither == 0 ? "none" : c.method == 0 ? "fs" : "ordered", space, t1 - t0, (unsigned long long) fnv(out + 4, size));
                    std::fflush(stdout);
                    std::free(out);
                }
            }
        }
    }
    return 0;
}
