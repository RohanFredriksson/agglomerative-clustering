// Spike: runs a clustering in 10 ms slices natively; reports the longest slice per stage and the longest single nearest().
#include "inst/clustering.cpp"
#include <cstdio>
#include <cstdlib>
int main(int argc, char** argv) {
    std::FILE* f = std::fopen(argv[1], "rb"); std::vector<uint8_t> img; uint8_t buf[65536];
    for (size_t n; (n = std::fread(buf, 1, sizeof buf, f)) > 0;) img.insert(img.end(), buf, buf + n);
    int cs = argc > 2 ? std::atoi(argv[2]) : 0;
    ClusteringJob job(img.data(), int(img.size()), 0, ColorSpace(cs), 8, true, 0);
    double worst = 0; int slices = 0; double wp = 0;
    for (;;) {
        double t = emscripten_get_now(); bool done = job.step(10.0); double d = emscripten_get_now() - t; slices++;
        if (d > worst) {worst = d; wp = job.progress();}
        if (done) break;
    }
    std::printf("slices %d longest slice %.1f ms (at progress %.0f) | nearest: max %.1f ms (alive %zu) total %.0f ms n %zu over5ms %zu | reindex max %.1f ms\n",
        slices, worst, wp, spike_nearest_max, spike_nearest_alive, spike_nearest_total, spike_nearest_n, spike_over5, spike_reindex_max);
}
