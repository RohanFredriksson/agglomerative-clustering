// How long one in-place pass over the heap copy takes in WebAssembly: un-premultiplying RGBA (min(255, round(c*255/a)),
// alpha 0 as black) and premultiplying again (round(c*a/255)). Two ways each: integer division, and a 64 KB table.
//   em++ -O3 -msimd128 bench/spikes/premultiplied/pass.cpp -o build/premul.mjs -s ALLOW_MEMORY_GROWTH=1 -s EXPORT_ES6=1 -s MODULARIZE=1 -s EXPORTED_FUNCTIONS="['_run','_malloc']" -s EXPORTED_RUNTIME_METHODS="['HEAPU8']"
//   node bench/spikes/premultiplied/run.mjs > bench/spikes/premultiplied/results.txt
#include <cstdint>
#include <cstdlib>
#include <chrono>
extern "C" {
static uint8_t table_un[256 * 256], table_pre[256 * 256];
static void build() {
    for (int a = 0; a < 256; a++) for (int c = 0; c < 256; c++) {
        {unsigned v = a == 0 ? 0 : (c * 255u + a / 2) / a; table_un[a * 256 + c] = v > 255 ? 255 : v;}
        table_pre[a * 256 + c] = (uint8_t)((c * a + 127) / 255);
    }
}
static void un_div(uint8_t* p, size_t n) {
    for (size_t i = 0; i < n; i += 4) {
        unsigned a = p[i + 3];
        if (a == 255) continue;
        if (a == 0) {p[i] = p[i + 1] = p[i + 2] = 0; continue;}
        for (int k = 0; k < 3; k++) {unsigned v = (p[i + k] * 255u + a / 2) / a; p[i + k] = v > 255 ? 255 : v;}
    }
}
static void un_table(uint8_t* p, size_t n) {
    for (size_t i = 0; i < n; i += 4) {
        unsigned a = p[i + 3];
        if (a == 255) continue;
        const uint8_t* t = table_un + a * 256;
        p[i] = t[p[i]]; p[i + 1] = t[p[i + 1]]; p[i + 2] = t[p[i + 2]];
    }
}
static void pre_div(uint8_t* p, size_t n) {
    for (size_t i = 0; i < n; i += 4) {
        unsigned a = p[i + 3];
        if (a == 255) continue;
        for (int k = 0; k < 3; k++) {p[i + k] = (p[i + k] * a + 127) / 255;}
    }
}
static void pre_table(uint8_t* p, size_t n) {
    for (size_t i = 0; i < n; i += 4) {
        unsigned a = p[i + 3];
        if (a == 255) continue;
        const uint8_t* t = table_pre + a * 256;
        p[i] = t[p[i]]; p[i + 1] = t[p[i + 1]]; p[i + 2] = t[p[i + 2]];
    }
}
// mode: 0 un_div, 1 un_table, 2 pre_div, 3 pre_table. Returns milliseconds.
double run(uint8_t* p, size_t n, int mode) {
    static bool built = false;
    if (!built) {build(); built = true;}
    auto t0 = std::chrono::steady_clock::now();
    if (mode == 0) un_div(p, n); else if (mode == 1) un_table(p, n); else if (mode == 2) pre_div(p, n); else pre_table(p, n);
    return std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t0).count();
}
}
