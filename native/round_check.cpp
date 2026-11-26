// Exhaustive check of round_nonnegative (src/clustering.cpp), which replaced lroundf in the dithering loops: for every float from 0 to
// 65,535 (every bit pattern, 1,199,570,689 values) it must give the integer lround gives. The dither targets are clamped to [0, limit]
// with limit at most 65,535 before they are rounded, so this covers every value it sees. Built and run by `scripts/native.sh round`
// (about 10 s; CI runs it in the fuzz job).
#include "../src/clustering.cpp"
#include <cstdio>

int main() {
    uint64_t checked = 0, bad = 0;
    for (uint32_t bits = 0; bits <= 0x477FFF00u; bits++) {  // 0x477FFF00 is 65535.0f; positive floats order like their bit patterns
        float x;
        std::memcpy(&x, &bits, 4);
        if (!(x >= 0.0f)) {continue;}  // skips NaNs (bit patterns above infinity are beyond the loop anyway)
        checked++;
        if (round_nonnegative(x) != int32_t(std::lround(x))) {
            if (bad++ < 5) {std::printf("MISMATCH %a: %d against %ld\n", x, round_nonnegative(x), std::lround(x));}
        }
    }
    std::printf("checked %llu floats, %llu mismatches\n", (unsigned long long) checked, (unsigned long long) bad);
    return bad != 0;
}
