// Driver for the chain spike: clusters one raw RGBA image with the variant's src/ (on the include path: -I build/<variant>/src),
// prints the time of each run and an FNV-1a hash of the clustering, writes the clustering to $DUMP, and, in a build with
// -DCOUNTERS (variants/count), the search counters. The same file builds with em++ (node) and natively (clang++, callgrind).
//   driver <image.rgba> <space 0|1> <precision> <runs>
#include "clustering.cpp"
#include <cstdio>
#include <chrono>
#include <algorithm>
#include <string>
static double now() {return std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now().time_since_epoch()).count();}
static uint64_t fnv(const uint8_t* p, size_t n) {uint64_t h = 1469598103934665603ull; for (size_t i = 0; i < n; i++) {h ^= p[i]; h *= 1099511628211ull;} return h;}

#ifdef COUNTERS
static void print_counters() {
    using namespace AgglomerativeClustering;
    const SearchCounters& s = g_sc;
    const char* names[3] = {"fresh", "exposed", "start"};
    auto sum2 = [](const uint64_t (&a)[3][3], int c) {return a[c][0] + a[c][1];};
    std::printf("C merges %llu chain_starts %llu chain_pushes %llu chain_max %llu\n", (unsigned long long) s.merges, (unsigned long long) s.chain_starts, (unsigned long long) s.chain_pushes, (unsigned long long) s.chain_max);
    uint64_t nt = 0, st = 0;
    for (int c = 0; c < 3; c++) {
        nt += s.nearest_calls[c]; st += sum2(s.searches, c);
        std::printf("C cat %s nearest %llu cached_entry %llu cache_hit %llu cache_fallback %llu searches1 %llu searches16 %llu\n", names[c], (unsigned long long) s.nearest_calls[c], (unsigned long long) s.cached_entry[c], (unsigned long long) s.cache_hit[c], (unsigned long long) s.cache_fallback[c], (unsigned long long) s.searches[c][0], (unsigned long long) s.searches[c][1]);
        for (int l = 0; l < 3; l++) {
            std::printf("C cat %s limit %s examined %llu rings %llu cells_visited %llu cells_skipped %llu chunks_seen %llu chunks_exact %llu lanes_offered %llu\n", names[c], l == 2 ? "oracle" : l ? "16" : "1", (unsigned long long) s.examined[c][l], (unsigned long long) s.rings[c][l], (unsigned long long) s.cells_visited[c][l], (unsigned long long) s.cells_skipped[c][l], (unsigned long long) s.chunks_seen[c][l], (unsigned long long) s.chunks_exact[c][l], (unsigned long long) s.lanes_offered[c][l]);
        }
    }
    std::printf("C nearest_total %llu searches_total %llu cache_built %llu expensive_marked %llu ring_stop_bound %llu ring_stop_edge %llu hint_used %llu rebuilds %llu relinked %llu\n", (unsigned long long) nt, (unsigned long long) st, (unsigned long long) s.cache_built, (unsigned long long) s.expensive_marked, (unsigned long long) s.ring_stop_bound, (unsigned long long) s.ring_stop_edge, (unsigned long long) s.hint_used, (unsigned long long) s.rebuilds, (unsigned long long) s.relinked);
    // histogram of nearest() calls per cluster id
    uint64_t hist[8] = {};
    for (uint32_t n : s.per_id_nearest) {hist[std::min<uint32_t>(n, 7)]++;}
    std::printf("C per_id_nearest_hist");
    for (int i = 0; i < 8; i++) {std::printf(" %d%s:%llu", i, i == 7 ? "+" : "", (unsigned long long) hist[i]);}
    std::printf("\n");
    uint64_t maxn = 0, over100 = 0, sum_over100 = 0; for (uint32_t n : s.per_id_nearest) {maxn = std::max<uint64_t>(maxn, n); if (n > 100) {over100++; sum_over100 += n;}}
    std::printf("C per_id_nearest max %llu clusters_over_100_calls %llu their_calls %llu\n", (unsigned long long) maxn, (unsigned long long) over100, (unsigned long long) sum_over100);
    for (int l = 0; l < 32; l++) {if (s.by_log2_searches[l]) {std::printf("C by_log2count %d searches %llu examined %llu chunks_exact %llu\n", l, (unsigned long long) s.by_log2_searches[l], (unsigned long long) s.by_log2_examined[l], (unsigned long long) s.by_log2_exact[l]);}}
}
#endif

int main(int argc, char** argv) {
    if (argc < 5) {std::fprintf(stderr, "usage: driver image.rgba space precision runs\n"); return 2;}
    std::FILE* f = std::fopen(argv[1], "rb");
    if (!f) {std::perror(argv[1]); return 1;}
    std::fseek(f, 0, SEEK_END); size_t size = size_t(std::ftell(f)); std::fseek(f, 0, SEEK_SET);
    std::vector<uint8_t> image(size);
    if (std::fread(image.data(), 1, size, f) != size) {return 1;}
    std::fclose(f);
    const int space = std::atoi(argv[2]), precision = std::atoi(argv[3]), runs = std::atoi(argv[4]);
    std::vector<uint8_t> clustering;
    for (int r = 0; r < runs; r++) {
        double t0 = now();
        clustering = _get_clustering(image.data(), int(size), 0, ColorSpace(space), precision, true, 0);
        double t1 = now();
        std::printf("RUN %d TOTAL %.3f\n", r, t1 - t0);
        std::printf("HASH %016llx\n", (unsigned long long) fnv(clustering.data(), clustering.size()));
        std::fflush(stdout);
#ifdef COUNTERS
        if (r == 0) {print_counters();}
#endif
    }
    if (const char* dump = std::getenv("DUMP")) {std::FILE* d = std::fopen(dump, "wb"); std::fwrite(clustering.data(), 1, clustering.size(), d); std::fclose(d);}
    return 0;
}
