// The longest ClusteringJob::step(10) (one 10 ms slice, as the JS sliced path asks for) on large images, and the
// progress it ran from and to (0-100 scan, 100-150 build, 150-950 merge, 950-1000 write). Built with em++ and run in
// Node, so it times the WebAssembly; SOURCE picks the clustering.cpp to time.
//   node bench/spikes/slicing-build/slices.mjs > bench/spikes/slicing-build/results-slices.txt
#include SOURCE
#include <cstdio>
#include <cstdlib>

static void run(const char* name, std::vector<uint8_t>& image, int precision, int space) {
    ClusteringJob job(image.data(), int(image.size()), 0, ColorSpace(space), precision, true, 0);
    double worst = 0, total = 0;
    int before = 0, after = 0, steps = 0;
    while (true) {
        const int p = job.progress();
        const double t0 = emscripten_get_now();
        const bool done = job.step(10.0);
        const double t = emscripten_get_now() - t0;
        total += t;
        steps++;
        if (t > worst) {worst = t; before = p; after = job.progress();}
        if (done) {break;}
    }
    const double t0 = emscripten_get_now();
    std::vector<uint8_t> clustering = job.take();
    const double take = emscripten_get_now() - t0;
    // The one-shot path (what every call without a signal or onProgress takes): best of two
    double one_shot = std::numeric_limits<double>::infinity();
    for (int rep = 0; rep < 2; rep++) {
        const double t1 = emscripten_get_now();
        std::vector<uint8_t> again = _get_clustering(image.data(), int(image.size()), 0, ColorSpace(space), precision, true);
        one_shot = std::min(one_shot, emscripten_get_now() - t1);
        if (again != clustering) {std::printf("MISMATCH between sliced and one-shot\n");}
    }
    std::printf("%-26s %4d slices, sliced %6.0f ms, one-shot %6.0f ms, longest slice %6.1f ms (progress %d -> %d), take %5.1f ms\n", name, steps, total + take, one_shot, worst, before, after, take);
}

int main(int argc, char** argv) {
    // argv[1]: a raw RGBA file of the 12 MP photo
    if (argc > 1) {
        std::FILE* file = std::fopen(argv[1], "rb");
        if (!file) {std::perror(argv[1]); return 1;}
        std::vector<uint8_t> photo;
        static uint8_t buffer[65536];  // not on the stack: Emscripten's default stack is 64 KB
        for (size_t n; (n = std::fread(buffer, 1, sizeof buffer, file)) > 0;) {photo.insert(photo.end(), buffer, buffer + n);}
        std::fclose(file);
        run("photo 12 MP, rgb", photo, 8, 0);
        run("photo 12 MP, oklab", photo, 8, 1);
        run("photo 12 MP, precision 6", photo, 6, 0);
    }
    for (int pass = 0; pass < 2; pass++) {
        const size_t pixels = pass == 0 ? 2000u * 2000u : 4240u * 2832u;
        std::vector<uint8_t> noise(pixels * 4);
        uint32_t s = 1;
        for (size_t i = 0; i < noise.size(); i++) {s = s * 1664525u + 1013904223u; noise[i] = (i & 3) == 3 ? 255 : uint8_t(s >> 24);}
        if (pass == 0) {
            run("noise 4 MP, rgb", noise, 8, 0);
            run("noise 4 MP, oklab", noise, 8, 1);
            run("noise 4 MP, precision 6", noise, 6, 0);
        } else {
            run("noise 12 MP, precision 6", noise, 6, 0);
        }
    }
}
