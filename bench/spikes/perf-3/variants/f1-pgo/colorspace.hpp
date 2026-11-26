#ifndef AGGLOMERATIVE_CLUSTERING_COLORSPACE_HPP
#define AGGLOMERATIVE_CLUSTERING_COLORSPACE_HPP

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <limits>

namespace AgglomerativeClustering {

// The space colours are clustered and matched in. Codes match the JS wrapper's `colorSpace` option.
enum class ColorSpace : int {
    rgb = 0,    // sRGB values as stored: fast, and what MSE/PSNR measure
    oklab = 1,  // OKLab (Björn Ottosson, 2020): distances track perceived colour difference
};

inline uint16_t uint8_to_uint16(uint8_t value) {
    return (uint16_t(value) * std::numeric_limits<uint16_t>::max()) / std::numeric_limits<uint8_t>::max();
}

inline uint8_t uint16_to_uint8(uint16_t value) {
    return static_cast<uint8_t>((static_cast<uint32_t>(value) * std::numeric_limits<uint8_t>::max() + (std::numeric_limits<uint16_t>::max() / 2)) / std::numeric_limits<uint16_t>::max());
}

// sRGB <-> OKLab, with OKLab stored in 16-bit coordinates. All three axes share one scale (L, a + 0.5 and
// b + 0.5, times 65535), so squared coordinate distances stay proportional to squared OKLab distances, which
// is what Ward's criterion needs. For sRGB colours L is in [0, 1] and a, b in about [-0.32, 0.28].
class OKLab {

private:

    static constexpr double scale = 65535.0;

    static double to_linear(double c) {
        return c <= 0.04045 ? c / 12.92 : std::pow((c + 0.055) / 1.055, 2.4);
    }

    static double to_gamma(double c) {
        return c <= 0.0031308 ? 12.92 * c : 1.055 * std::pow(c, 1.0 / 2.4) - 0.055;
    }

    static uint16_t to_coordinate(double v) {
        return uint16_t(std::clamp(std::lround(v * scale), 0L, 65535L));
    }

    // sRGB 8-bit values decoded to linear light.
    std::array<double, 256> linear;

public:

    OKLab() {
        for (int i = 0; i < 256; i++) {this->linear[i] = to_linear(i / 255.0);}
    }

    std::array<uint16_t, 3> from_rgb(uint8_t r8, uint8_t g8, uint8_t b8) const {
        double r = this->linear[r8], g = this->linear[g8], b = this->linear[b8];
        double l = std::cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
        double m = std::cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
        double s = std::cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
        double L = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s;
        double A = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s;
        double B = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
        return {to_coordinate(L), to_coordinate(A + 0.5), to_coordinate(B + 0.5)};
    }

    // Averages of sRGB colours in OKLab can fall slightly outside the sRGB gamut, so channels are clamped.
    std::array<uint8_t, 3> to_rgb(const std::array<uint16_t, 3>& coords) const {
        double L = coords[0] / scale, A = coords[1] / scale - 0.5, B = coords[2] / scale - 0.5;
        double l = L + 0.3963377774 * A + 0.2158037573 * B;
        double m = L - 0.1055613458 * A - 0.0638541728 * B;
        double s = L - 0.0894841775 * A - 1.2914855480 * B;
        l = l * l * l; m = m * m * m; s = s * s * s;
        double rgb[3] = {
            +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
            -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
            -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
        };
        std::array<uint8_t, 3> out;
        for (int c = 0; c < 3; c++) {out[c] = uint8_t(std::lround(to_gamma(std::clamp(rgb[c], 0.0, 1.0)) * 255.0));}
        return out;
    }

};

// Converts between 8-bit sRGB and the 16-bit coordinates a colour space clusters in.
class ColorCoordinates {

private:

    ColorSpace space;
    OKLab oklab;

public:

    explicit ColorCoordinates(ColorSpace space) : space(space) {}

    // Coordinates for clustering: RGB is upscaled to 16 bits so weighted-average merges keep precision.
    std::array<uint16_t, 3> cluster(uint8_t r, uint8_t g, uint8_t b) const {
        if (this->space == ColorSpace::oklab) {return this->oklab.from_rgb(r, g, b);}
        return {uint8_to_uint16(r), uint8_to_uint16(g), uint8_to_uint16(b)};
    }

    // Coordinates for nearest-colour matching. RGB uses the 8-bit values as they are, which keeps matching
    // exactly as it was before colour spaces existed.
    std::array<uint16_t, 3> match(uint8_t r, uint8_t g, uint8_t b) const {
        if (this->space == ColorSpace::oklab) {return this->oklab.from_rgb(r, g, b);}
        return {r, g, b};
    }

    std::array<uint8_t, 3> to_rgb(const std::array<uint16_t, 3>& coords) const {
        if (this->space == ColorSpace::oklab) {return this->oklab.to_rgb(coords);}
        return {uint16_to_uint8(coords[0]), uint16_to_uint8(coords[1]), uint16_to_uint8(coords[2])};
    }

};

}

#endif
