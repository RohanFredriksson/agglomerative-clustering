// A native run of one clustering, for instruction counts: wall-clock time on shared machines is noisy, so check speed
// work on WardGrid::search with callgrind too (CLAUDE.md). scripts/native.sh profile <image> runs it under valgrind.
//   profile <raw image file> [format 0-4] [precision 1-8] [color space 0-1] [output file]
// The file holds raw pixels in that format (RGBA by default); scripts/native.sh converts a PNG first. With an output
// file it also writes the clustering there, to compare with the WebAssembly build's (they are the same bytes).
#include "../src/clustering.cpp"
#include <cstdio>
#include <cstdlib>

int main(int argc, char** argv) {
    if (argc < 2) {std::fprintf(stderr, "usage: profile <raw image> [format] [precision] [color space] [output file]\n"); return 2;}
    std::FILE* file = std::fopen(argv[1], "rb");
    if (!file) {std::perror(argv[1]); return 1;}
    std::vector<uint8_t> image;
    uint8_t buffer[65536];
    for (size_t n; (n = std::fread(buffer, 1, sizeof buffer, file)) > 0;) {image.insert(image.end(), buffer, buffer + n);}
    std::fclose(file);
    const int format = argc > 2 ? std::atoi(argv[2]) : 0;
    const int precision = argc > 3 ? std::atoi(argv[3]) : 8;
    const int color_space = argc > 4 ? std::atoi(argv[4]) : 0;
    uint8_t* clustering = get_clustering(image.data(), int(image.size()), format, color_space, precision, 1, 0);
    uint32_t length;
    std::memcpy(&length, clustering, 4);
    std::printf("%zu bytes of pixels, clustering of %u bytes\n", image.size(), length);
    if (argc > 5) {
        std::FILE* out = std::fopen(argv[5], "wb");
        if (!out) {std::perror(argv[5]); return 1;}
        std::fwrite(clustering + 4, 1, length, out);
        std::fclose(out);
    }
    std::free(clustering);
    return 0;
}
