// The fast swap pass (FastPAM-style) in C++, for comparing with the JavaScript recipes in speed.mjs. Same algorithm
// and order as fastImprove there: per pass, each swatch's nearest and second-nearest chosen thread; then for each
// unchosen thread j one sweep over the swatches gives the change in error for swapping j with every chosen position;
// take the best strictly lower, repeat until no swap helps. Built by speed.mjs with em++ -O3 -msimd128.
#include <cstdint>
#include <cstdlib>
#include <vector>
#include <cmath>
#include <emscripten.h>

extern "C" {

// distance: t*m squared distances (thread j, swatch i at j*m+i); weights: m; chosen: n positions, updated in place.
EMSCRIPTEN_KEEPALIVE int improve(const double* distance, const double* weights, int t, int m, int32_t* chosen, int n) {
    std::vector<int32_t> nearest(m);
    std::vector<double> first(m), second(m), change(n);
    std::vector<uint8_t> in(t, 0);
    int passes = 0;
    for (;;) {
        passes++;
        for (int j = 0; j < t; j++) {in[j] = 0;}
        for (int s = 0; s < n; s++) {in[chosen[s]] = 1;}
        double current = 0;
        for (int i = 0; i < m; i++) {
            double f = INFINITY, g = INFINITY; int near = 0;
            for (int s = 0; s < n; s++) {
                const double d = distance[size_t(chosen[s]) * m + i];
                if (d < f) {g = f; f = d; near = s;} else if (d < g) {g = d;}
            }
            nearest[i] = near; first[i] = f; second[i] = g; current += weights[i] * f;
        }
        int best_s = -1, best_j = -1;
        double lowest = current * (1 - 1e-9);
        for (int j = 0; j < t; j++) {
            if (in[j]) {continue;}
            const double* row = distance + size_t(j) * m;
            double shared = 0;
            for (int s = 0; s < n; s++) {change[s] = 0;}
            for (int i = 0; i < m; i++) {
                const double d = row[i], w = weights[i], gain = d < first[i] ? w * (d - first[i]) : 0;
                shared += gain;
                change[nearest[i]] += w * ((d < second[i] ? d : second[i]) - first[i]) - gain;
            }
            for (int s = 0; s < n; s++) {
                const double error = current + shared + change[s];
                if (error < lowest) {lowest = error; best_s = s; best_j = j;}
            }
        }
        if (best_s < 0) {return passes;}
        chosen[best_s] = best_j;
    }
}

}
