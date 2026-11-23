// Every resumable step stopped at every chance: a ClusteringJob stepped with a budget of 0 (each clock check ends the
// slice) on images with more distinct colours than a block (65,536), so every phase resumes part way through, compared
// byte for byte with the one-shot clustering. Built with AddressSanitizer and UBSan by resume.mjs.
#include "../../../src/clustering.cpp"
#include <cstdio>

static int check(const char* name, std::vector<uint8_t>& image, int format, int precision, int space, bool alpha, int cutoff) {
    ClusteringJob job(image.data(), int(image.size()), format, ColorSpace(space), precision, alpha, cutoff);
    int slices = 1;
    while (!job.step(0.0)) {slices++;}
    const std::vector<uint8_t> sliced = job.take();
    const std::vector<uint8_t> whole = _get_clustering(image.data(), int(image.size()), format, ColorSpace(space), precision, alpha, cutoff);
    const bool same = sliced == whole;
    std::printf("%-44s %7d slices, %8zu bytes: %s\n", name, slices, whole.size(), same ? "identical" : "DIFFERENT");
    return same ? 0 : 1;
}

int main() {
    int failures = 0;
    // Noise with partial alpha: about 600k distinct colours, several blocks in every phase
    const size_t pixels = 800u * 800u;
    std::vector<uint8_t> noise(pixels * 4);
    uint32_t s = 7;
    for (size_t i = 0; i < noise.size(); i++) {s = s * 1664525u + 1013904223u; noise[i] = (i & 3) == 3 ? uint8_t(128 + (s >> 25)) : uint8_t(s >> 24);}
    failures += check("noise, rgba, partial alpha weighted", noise, 0, 8, 0, true, 0);
    failures += check("noise, rgba, oklab", noise, 0, 8, 1, true, 0);
    failures += check("noise, rgba, precision 6", noise, 0, 6, 0, true, 0);
    failures += check("noise, rgba, precision 5, oklab", noise, 0, 5, 1, true, 0);
    failures += check("noise, rgba, transparent cutoff 200", noise, 0, 8, 0, true, 200);
    // Opaque RGB (format 1): whole-pixel weights
    std::vector<uint8_t> rgb(pixels * 3);
    for (size_t i = 0; i < rgb.size(); i++) {s = s * 1664525u + 1013904223u; rgb[i] = uint8_t(s >> 24);}
    failures += check("noise, rgb", rgb, 1, 8, 0, false, 0);
    // A smooth gradient (few colours per block, long merges) and an empty image
    std::vector<uint8_t> gradient(pixels * 4);
    for (size_t p = 0; p < pixels; p++) {gradient[4 * p] = uint8_t(p % 800 * 255 / 799); gradient[4 * p + 1] = uint8_t(p / 800 * 255 / 799); gradient[4 * p + 2] = uint8_t((p * 7) & 255); gradient[4 * p + 3] = 255;}
    failures += check("gradient", gradient, 0, 8, 0, true, 0);
    std::vector<uint8_t> clear(4096, 0);
    failures += check("fully transparent", clear, 0, 8, 0, true, 0);
    std::printf(failures ? "FAILED: %d\n" : "all identical\n", failures);
    return failures ? 1 : 0;
}
