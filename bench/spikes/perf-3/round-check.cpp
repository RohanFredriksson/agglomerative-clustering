// Checks int32(x + 0x1.fffffep-2f) == lroundf(x) for every float x in [0, 65535] (all bit patterns, so every distinct float).
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>
int main() {
    uint32_t bad = 0, n = 0;
    for (uint32_t bits = 0; bits <= 0x477FFF00u; bits++) {  // 0x477FFF00 = 65535.0f
        float x; std::memcpy(&x, &bits, 4);
        if (!(x >= 0.0f)) continue;
        n++;
        if (int32_t(x + 0x1.fffffep-2f) != int32_t(std::lround(x))) {if (bad++ < 5) std::printf("MISMATCH %a %d %ld\n", x, int32_t(x + 0x1.fffffep-2f), std::lround(x));}
    }
    std::printf("checked %u floats, %u mismatches\n", n, bad);
    return bad != 0;
}
