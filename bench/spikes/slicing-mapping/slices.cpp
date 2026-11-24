// Mapping in slices (3.7.0): the longest MappingTask::step of 10 ms (one slice, as the JS sliced path asks for) and
// the sliced total, against the one-shot _quantize. Built twice by slices.mjs with em++ and run in Node, so it times
// the WebAssembly: against this tree, and with OLD against the v3.6.0 sources (one-shot only), and slices.mjs joins
// the two and checks every output's hash matches.
//   node bench/spikes/slicing-mapping/slices.mjs > bench/spikes/slicing-mapping/results-slices.txt
#include SOURCE
#include <cstdio>
#include <limits>

static const char* only = nullptr;  // a fourth argument: run only this method

static uint32_t fnv(const uint8_t* data, size_t n) {uint32_t h = 2166136261u; for (size_t i = 0; i < n; i++) {h = (h ^ data[i]) * 16777619u;} return h;}

struct Method {const char* name; double dither; int method; int steps;};
static const Method methods[] = {{"none", 0, 0, 0}, {"floyd-steinberg", 1, 0, 0}, {"atkinson", 1, 1, 0}, {"ordered", 1, 2, 0}, {"ordered 64", 1, 2, 64}};

static void run(const char* name, std::vector<uint8_t>& image, int width, const std::vector<uint8_t>& palette, int space) {
    const int length = int(image.size());
    for (const Method& m : methods) {
        if (only && std::strcmp(only, m.name) != 0) {continue;}
        double worst = 0, total = 0;
        int steps = 0;
        uint32_t sliced_hash = 0;
#ifndef OLD
        MappingTask task(true, image.data(), length, 0, palette.data(), palette.size(), ColorSpace(space), m.dither, m.method, m.steps, width, 0);
        while (true) {
            const double t0 = emscripten_get_now();
            const bool done = task.step(true, t0 + 10.0);
            const double t = emscripten_get_now() - t0;
            total += t;
            steps++;
            worst = std::max(worst, t);
            if (done) {break;}
        }
        uint8_t* sliced = task.take();
        sliced_hash = fnv(sliced, 4 + image.size());
        free(sliced);
#endif
        double one_shot = std::numeric_limits<double>::infinity();
        uint32_t hash = 0;
        for (int rep = 0; rep < 2; rep++) {
            const double t0 = emscripten_get_now();
            uint8_t* a = _quantize(image.data(), length, 0, palette.data(), palette.size(), ColorSpace(space), m.dither, m.method, m.steps, width);
            one_shot = std::min(one_shot, emscripten_get_now() - t0);
            hash = fnv(a, 4 + image.size());
            free(a);
        }
        // name|colours|method|one-shot ms|hash|slices|longest ms|sliced ms|sliced hash
        std::printf("%s|%zu|%s|%.0f|%08x|%d|%.1f|%.0f|%08x\n", name, palette.size() / 3, m.name, one_shot, hash, steps, worst, total, sliced_hash);
    }
}

static std::vector<uint8_t> palette_of(std::vector<uint8_t>& image, int k) {
    std::vector<uint8_t> clustering = _get_clustering(image.data(), int(image.size()), 0, ColorSpace::rgb, 6, true);
    bool valid = false;
    return _get_palette_from_clustering(clustering.data(), clustering.size(), k, valid);
}

int main(int argc, char** argv) {
    std::FILE* file = std::fopen(argv[1], "rb");
    if (!file) {std::perror(argv[1]); return 1;}
    std::vector<uint8_t> photo;
    static uint8_t buffer[65536];
    for (size_t n; (n = std::fread(buffer, 1, sizeof buffer, file)) > 0;) {photo.insert(photo.end(), buffer, buffer + n);}
    std::fclose(file);
    const int width = std::atoi(argv[2]);
    std::vector<uint8_t> noise(2000u * 2000u * 4);
    uint32_t s = 1;
    for (size_t i = 0; i < noise.size(); i++) {s = s * 1664525u + 1013904223u; noise[i] = (i & 3) == 3 ? 255 : uint8_t(s >> 24);}
    // With a third argument (slices.mjs --quick), the photo at 16 and 256 colours only.
    const bool quick = argc > 3;
    if (argc > 4) {only = argv[4];}
    for (int k : {16, 256, 4096}) {
        if (quick && k > 256) {break;}
        std::vector<uint8_t> p = palette_of(photo, k), q = palette_of(noise, k);
        if (quick) {run("photo 6.3 MP, rgb", photo, width, p, 0); continue;}
        run("photo 6.3 MP, rgb", photo, width, p, 0);
        if (k == 256) {run("photo 6.3 MP, oklab", photo, width, p, 1);}
        run("noise 4 MP, rgb", noise, 2000, q, 0);
    }
}
