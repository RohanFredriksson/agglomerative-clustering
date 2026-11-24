// Every resumable step of the mapping stopped at every chance: a MappingTask stepped with a deadline already past
// (each clock check ends the slice: every 16,384 pixels undithered, every 1,024 dithered, and after every 64 ordered
// recipes) for every method, both
// outputs, palettes on the cell index and the k-d tree, and odd shapes, compared byte for byte with the one-shot
// _quantize and _quantize_indices. Built with AddressSanitizer and UBSan by resume.mjs.
#include "../../../src/clustering.cpp"
#include <cstdio>

static size_t output_length(const uint8_t* packed) {return size_t(packed[0]) | size_t(packed[1]) << 8 | size_t(packed[2]) << 16 | size_t(packed[3]) << 24;}

static int check(const char* name, const std::vector<uint8_t>& image, int format, int width, const std::vector<uint8_t>& palette, int space, double dither, int method, int steps, bool indices, int cutoff) {
    MappingTask task(!indices, image.data(), int(image.size()), format, palette.data(), palette.size(), ColorSpace(space), dither, method, steps, width, cutoff);
    int slices = 1;
    while (!task.step(true, 0.0)) {slices++;}
    uint8_t* sliced = task.take();
    uint8_t* whole = indices
        ? _quantize_indices(image.data(), int(image.size()), format, palette.data(), palette.size(), ColorSpace(space), dither, method, steps, width, cutoff)
        : _quantize(image.data(), int(image.size()), format, palette.data(), palette.size(), ColorSpace(space), dither, method, steps, width);
    const size_t n = output_length(whole);
    const bool same = output_length(sliced) == n && std::memcmp(sliced, whole, 4 + n) == 0;
    free(sliced);
    free(whole);
    std::printf("%-58s %6d slices: %s\n", name, slices, same ? "identical" : "DIFFERENT");
    return same ? 0 : 1;
}

int main() {
    int failures = 0;
    uint32_t s = 7;
    auto next = [&]() {s = s * 1664525u + 1013904223u; return uint8_t(s >> 24);};
    // 400 x 400 with partial and zero alpha (over two blocks of 65,536 pixels undithered)
    const int w = 400, h = 400;
    std::vector<uint8_t> rgba(size_t(w) * h * 4);
    for (size_t p = 0; p < size_t(w) * h; p++) {
        const int x = int(p % w), y = int(p / w);
        rgba[4 * p] = uint8_t(x * 255 / w + (next() >> 4));
        rgba[4 * p + 1] = uint8_t(y * 255 / h + (next() >> 4));
        rgba[4 * p + 2] = next();
        rgba[4 * p + 3] = x < 20 ? 0 : x < 60 ? 128 : 255;
    }
    std::vector<uint8_t> rgb(size_t(w) * h * 3);
    for (size_t p = 0; p < size_t(w) * h; p++) {for (int c = 0; c < 3; c++) {rgb[3 * p + c] = rgba[4 * p + c];}}
    auto palette = [&](int n) {std::vector<uint8_t> p(size_t(n) * 3); for (auto& v : p) {v = next();} return p;};
    const std::vector<uint8_t> small = palette(40), large = palette(2000), empty;
    struct M {const char* name; double dither; int method; int steps;};
    const M methods[] = {{"none", 0, 0, 0}, {"floyd-steinberg", 1, 0, 0}, {"floyd-steinberg 0.5", 0.5, 0, 0}, {"atkinson", 1, 1, 0}, {"ordered", 1, 2, 0}, {"ordered 64", 0.7, 2, 64}};
    char name[128];
    for (const M& m : methods) {
        for (int space : {0, 1}) {
            for (const auto* p : {&small, &large}) {
                std::snprintf(name, sizeof name, "%s, %s, %zu colours, rgba", m.name, space ? "oklab" : "rgb", p->size() / 3);
                failures += check(name, rgba, 0, w, *p, space, m.dither, m.method, m.steps, false, 0);
                std::snprintf(name, sizeof name, "%s, %s, %zu colours, indices + transparent", m.name, space ? "oklab" : "rgb", p->size() / 3);
                failures += check(name, rgba, 0, w, *p, space, m.dither, m.method, m.steps, true, 128);
            }
        }
        std::snprintf(name, sizeof name, "%s, rgb input, indices", m.name);
        failures += check(name, rgb, 1, w, small, 0, m.dither, m.method, m.steps, true, 0);
        std::snprintf(name, sizeof name, "%s, no width", m.name);
        failures += check(name, rgba, 0, 0, small, 0, m.dither, m.method, m.steps, false, 0);
        std::snprintf(name, sizeof name, "%s, width 1", m.name);
        failures += check(name, rgba, 0, 1, small, 0, m.dither, m.method, m.steps, false, 0);
        std::snprintf(name, sizeof name, "%s, empty palette, indices + transparent", m.name);
        failures += check(name, rgba, 0, w, empty, 0, m.dither, m.method, m.steps, true, 128);
    }
    const std::vector<uint8_t> none;
    failures += check("empty image", none, 0, 0, small, 0, 1, 0, 0, true, 128);
    std::printf(failures ? "FAILED: %d\n" : "all identical\n", failures);
    return failures ? 1 : 0;
}
